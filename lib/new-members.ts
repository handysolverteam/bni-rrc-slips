import { cachedSwr } from "@/lib/cache";
import { resolveHomeChapter } from "@/lib/member-chapters";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";

/** Same normalisation as everywhere else: collapse spaces, lower-case. */
export const memberKey = (n: string): string => n.replace(/\s+/g, " ").trim().toLowerCase();

/** The tenant's Home Chapter name — configured name, else the tenant's own name
 *  (the .env chapter name is no longer consulted). */
export function homeChapterNameOf(tenantId: string): Promise<string> {
  return cachedSwr(`homename:${tenantId}`, 60_000, () => lookupHomeChapterName(tenantId));
}

async function lookupHomeChapterName(tenantId: string): Promise<string> {
  const { data } = await getSupabaseServer()
    .from("tenants")
    .select("id,name,home_chapter_name")
    .eq("id", tenantId)
    .maybeSingle();
  return resolveHomeChapter(data ?? { id: tenantId });
}

async function homeChapterId(tenantId: string, homeName: string): Promise<string | null> {
  const { data } = await getSupabaseServer()
    .from("chapters")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", homeName)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Create the Home Chapter row on first use; returns its id. */
export async function ensureHomeChapter(tenantId: string, homeName: string): Promise<string | null> {
  const existing = await homeChapterId(tenantId, homeName);
  if (existing) return existing;
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("chapters")
    .insert({ tenant_id: tenantId, name: homeName })
    .select("id")
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? (await homeChapterId(tenantId, homeName));
}

/** Names of the tenant's existing Home Chapter members. */
export async function listHomeMemberNames(tenantId: string, homeName: string): Promise<string[]> {
  const chapterId = await homeChapterId(tenantId, homeName);
  if (!chapterId) return [];
  const rows = await fetchAllRows<{ name: string }>("members", "name", {
    eq: [
      ["tenant_id", tenantId],
      ["chapter_id", chapterId],
    ],
    pageSize: 1000,
  });
  return rows.map((r) => r.name);
}

/**
 * Names (de-duplicated, file order) that are NOT yet members of the tenant's
 * Home Chapter — the people an import would add. Drives the "add to home
 * chapter" checkboxes (all ticked by default).
 */
export async function findNewHomeNames(tenantId: string, homeName: string, names: string[]): Promise<string[]> {
  const chapterId = await homeChapterId(tenantId, homeName);
  const have = new Set<string>();
  if (chapterId) {
    const rows = await fetchAllRows<{ name: string }>("members", "name", {
      eq: [
        ["tenant_id", tenantId],
        ["chapter_id", chapterId],
      ],
      pageSize: 1000,
    });
    for (const r of rows) have.add(memberKey(r.name));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    const k = memberKey(name);
    if (!k || have.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Add members to the tenant's Home Chapter; returns how many were created. */
export async function createHomeMembers(tenantId: string, homeName: string, names: string[]): Promise<number> {
  if (names.length === 0) return 0;
  const chapterId = await ensureHomeChapter(tenantId, homeName);
  if (!chapterId) return 0;
  const sb = getSupabaseServer();
  let created = 0;
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500).map((name) => ({ name, chapter_id: chapterId, tenant_id: tenantId }));
    const { error } = await sb.from("members").insert(chunk);
    if (!error) {
      created += chunk.length;
      continue;
    }
    // One clash must not sink the batch: retry row-by-row, ignore duplicates.
    for (const row of chunk) {
      const { error: rowError } = await sb.from("members").insert(row);
      if (!rowError) created++;
    }
  }
  return created;
}

/** The `skipMembers` form field: a JSON array of names the user un-ticked. */
export function parseSkipMembers(field: FormDataEntryValue | null): Set<string> {
  if (typeof field !== "string" || !field.trim()) return new Set();
  try {
    const arr = JSON.parse(field) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((n): n is string => typeof n === "string").map(memberKey) : []);
  } catch {
    return new Set();
  }
}
