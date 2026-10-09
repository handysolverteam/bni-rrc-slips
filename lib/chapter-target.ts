import { clearCached } from "@/lib/cache";
import { chapterKey, normalizeChapterName } from "@/lib/file-chapter";
import { getSupabaseServer } from "@/lib/supabase/server";

export type ChapterOption = { id: string; name: string };

/** What the import UI needs to know about the chapter a file belongs to. */
export type ChapterCheck = {
  /** Raw chapter text found in the file ("Influencers"), or null. */
  detected: string | null;
  /** App-style name ("BNI Influencers"), "" when nothing was detected. */
  normalized: string;
  /**
   * match      — the file's chapter is the active chapter: import straight in.
   * undetected — the file names no chapter: import into the active chapter.
   * choose     — the file names a different/unknown chapter: the user picks an
   *              existing chapter or types a new one before importing.
   */
  status: "match" | "undetected" | "choose";
  active: ChapterOption;
  /** Chapters (tenants) the caller may import into. */
  options: ChapterOption[];
  /** Option whose name matches the detected chapter, if any. */
  suggestedId: string | null;
};

type Caller = { uid: string | null; tenantId: string };

/** Tenants the caller can import into (service callers: only the active one). */
export async function listImportTargets(caller: Caller): Promise<ChapterOption[]> {
  const sb = getSupabaseServer();
  if (!caller.uid) {
    const { data } = await sb.from("tenants").select("id,name").eq("id", caller.tenantId).maybeSingle();
    return data ? [data as ChapterOption] : [];
  }
  const { data: rows } = await sb.from("tenant_members").select("tenants(id,name)").eq("uid", caller.uid);
  return (rows ?? [])
    .map((r) => r.tenants as ChapterOption | ChapterOption[] | null)
    .flatMap((t) => (Array.isArray(t) ? t : t ? [t] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Compare the chapter named in an uploaded file with the active chapter. */
export async function checkFileChapter(caller: Caller, detected: string | null): Promise<ChapterCheck> {
  const options = await listImportTargets(caller);
  const active = options.find((o) => o.id === caller.tenantId) ?? { id: caller.tenantId, name: "" };
  const raw = (detected ?? "").trim();
  const normalized = raw ? normalizeChapterName(raw) : "";
  if (!raw) return { detected: null, normalized: "", status: "undetected", active, options, suggestedId: null };
  const suggested = options.find((o) => chapterKey(o.name) === chapterKey(raw)) ?? null;
  const status = suggested && suggested.id === active.id ? "match" : "choose";
  return { detected: raw, normalized, status, active, options, suggestedId: suggested?.id ?? null };
}

/**
 * Create a chapter (tenant) with its own home chapter row and make `uid` a
 * member. A name that already exists is reused when the caller is a member of
 * it; otherwise it is refused (nobody joins someone else's chapter by typing
 * its name).
 */
export async function createChapterTenant(
  uid: string,
  rawName: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const name = rawName.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Chapter name is required." };
  if (name.length > 120) return { error: "Chapter name is too long." };
  const sb = getSupabaseServer();
  const { data: existing } = await sb.from("tenants").select("id,name").ilike("name", name).maybeSingle();
  if (existing) {
    const { data: membership } = await sb
      .from("tenant_members")
      .select("tenant_id")
      .eq("tenant_id", existing.id)
      .eq("uid", uid)
      .maybeSingle();
    return membership
      ? (existing as ChapterOption)
      : { error: `A chapter named "${existing.name}" already exists and you are not a member of it.` };
  }
  const { data: tenant, error } = await sb
    .from("tenants")
    .insert({ name, home_chapter_name: name })
    .select("id,name")
    .single();
  if (error || !tenant) return { error: error?.message ?? "Could not create the chapter." };
  const tid = (tenant as ChapterOption).id;
  const { error: chapterError } = await sb.from("chapters").insert({ tenant_id: tid, name });
  if (chapterError) return { error: chapterError.message };
  const { error: memberError } = await sb.from("tenant_members").insert({ tenant_id: tid, uid });
  if (memberError) return { error: memberError.message };
  clearCached("memb:"); // memberships are cached per user for 30s
  return tenant as ChapterOption;
}

/**
 * Preview-only twin of resolveImportTarget: never creates anything. A typed
 * new chapter has no data yet (`tenantId` null → every row/member is new).
 */
export async function previewTarget(
  caller: Caller,
  field: FormDataEntryValue | null,
): Promise<{ tenantId: string | null; homeName: string }> {
  const { homeChapterNameOf } = await import("@/lib/new-members");
  let parsed: { tenantId?: unknown; newName?: unknown } = {};
  if (typeof field === "string" && field.trim()) {
    try {
      parsed = JSON.parse(field) as typeof parsed;
    } catch {
      parsed = {};
    }
  }
  if (typeof parsed.newName === "string" && parsed.newName.trim()) {
    return { tenantId: null, homeName: parsed.newName.replace(/\s+/g, " ").trim() };
  }
  let tenantId = caller.tenantId;
  if (typeof parsed.tenantId === "string" && parsed.tenantId && parsed.tenantId !== caller.tenantId) {
    const allowed = await listImportTargets(caller);
    if (allowed.some((t) => t.id === parsed.tenantId)) tenantId = parsed.tenantId;
  }
  return { tenantId, homeName: await homeChapterNameOf(tenantId) };
}

/**
 * The tenant an import should write to. `field` is the optional `chapter`
 * form value: `{"tenantId": "..."}` (an existing chapter the caller belongs
 * to) or `{"newName": "..."}` (create it). Anything else = the active chapter.
 */
export async function resolveImportTarget(
  caller: Caller,
  field: FormDataEntryValue | null,
): Promise<{ tenantId: string; created?: boolean } | { error: string; status: number }> {
  let parsed: { tenantId?: unknown; newName?: unknown } = {};
  if (typeof field === "string" && field.trim()) {
    try {
      parsed = JSON.parse(field) as typeof parsed;
    } catch {
      return { error: "Invalid chapter choice.", status: 400 };
    }
  }
  if (typeof parsed.newName === "string" && parsed.newName.trim()) {
    if (!caller.uid) return { error: "Creating a chapter needs a signed-in user.", status: 403 };
    const made = await createChapterTenant(caller.uid, parsed.newName);
    if ("error" in made) return { error: made.error, status: 400 };
    return { tenantId: made.id, created: made.id !== caller.tenantId };
  }
  if (typeof parsed.tenantId === "string" && parsed.tenantId && parsed.tenantId !== caller.tenantId) {
    const allowed = await listImportTargets(caller);
    if (!allowed.some((t) => t.id === parsed.tenantId)) {
      return { error: "You are not a member of that chapter.", status: 403 };
    }
    return { tenantId: parsed.tenantId, created: false };
  }
  return { tenantId: caller.tenantId };
}
