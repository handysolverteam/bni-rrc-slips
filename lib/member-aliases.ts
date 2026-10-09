import { clearSlipsSnapshotCache } from "@/lib/chat/snapshot-cache";
import { clearDistinctCache } from "@/lib/distinct";
import { nameKey, resolveAlias, type AliasMap } from "@/lib/alias-map";
import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";

/** Remembered merges for a tenant. An empty map when none exist — or when
 *  migration 008 has not been run yet (the app keeps working without it). */
export async function loadAliasMap(tenantId: string): Promise<AliasMap> {
  const map: AliasMap = new Map();
  try {
    const rows = await fetchAllRows<{ alias_key: string; canonical_name: string }>(
      "member_aliases",
      "alias_key,canonical_name",
      { eq: [["tenant_id", tenantId]], pageSize: 1000 },
    );
    for (const r of rows) map.set(r.alias_key, r.canonical_name);
  } catch {
    // table missing → no remembered merges yet
  }
  return map;
}

/**
 * Remember { alias spelling -> canonical name }. The canonical side is
 * resolved through existing merges first, and merges that pointed at the
 * alias are re-pointed, so chains collapse to one name.
 */
export async function saveAliases(
  tenantId: string,
  picks: Record<string, string>,
): Promise<{ saved: number; error?: string }> {
  const entries = Object.entries(picks);
  if (entries.length === 0) return { saved: 0 };
  const sb = getSupabaseServer();
  const map = await loadAliasMap(tenantId);
  let saved = 0;
  for (const [aliasRaw, canonRaw] of entries) {
    const alias = aliasRaw.replace(/\s+/g, " ").trim();
    const canonical = resolveAlias(map, canonRaw);
    if (!alias || nameKey(alias) === nameKey(canonical)) continue;
    const { error } = await sb
      .from("member_aliases")
      .upsert(
        { tenant_id: tenantId, alias_key: nameKey(alias), alias_name: alias, canonical_name: canonical },
        { onConflict: "tenant_id,alias_key" },
      );
    if (error) return { saved, error: error.message };
    // Anything that pointed at the alias now points at the canonical name.
    await sb
      .from("member_aliases")
      .update({ canonical_name: canonical })
      .eq("tenant_id", tenantId)
      .ilike("canonical_name", escapeLike(alias));
    map.set(nameKey(alias), canonical);
    saved++;
  }
  return { saved };
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Name columns holding a MEMBER's name (visitor guests are not members). */
const NAME_COLUMNS: [string, string][] = [
  ["slip_referrals", "from_name"],
  ["slip_referrals", "to_name"],
  ["slip_one_to_ones", "initiated_by_name"],
  ["slip_one_to_ones", "met_with_name"],
  ["slip_tyfcb", "member_name"],
  ["slip_tyfcb", "thanker_name"],
  ["slip_visitors", "invited_by_name"],
  ["slip_ceus", "member_name"],
];

/** Member-id columns that must follow a merged member row. */
const ID_COLUMNS: [string, string][] = [
  ["slip_referrals", "from_member_id"],
  ["slip_referrals", "to_member_id"],
  ["slip_one_to_ones", "initiated_by_member_id"],
  ["slip_one_to_ones", "met_with_member_id"],
  ["slip_tyfcb", "member_id"],
  ["slip_visitors", "invited_by_member_id"],
  ["slip_ceus", "member_id"],
];

export type MergeResult = {
  membersMerged: number;
  namesRewritten: number;
  attendanceMoved: number;
  attendanceDropped: number;
  remembered: boolean;
  warning?: string;
};

/**
 * Merge the spelling `fromName` into `intoName` for one tenant: member rows,
 * every stored slip name, attendance — then remember the merge so imports map
 * it automatically. Attendance that exists under both spellings for the same
 * week keeps the canonical one.
 */
export async function mergeMembers(tenantId: string, fromName: string, intoName: string): Promise<MergeResult> {
  const sb = getSupabaseServer();
  const from = fromName.replace(/\s+/g, " ").trim();
  const into = resolveAlias(await loadAliasMap(tenantId), intoName);
  const result: MergeResult = { membersMerged: 0, namesRewritten: 0, attendanceMoved: 0, attendanceDropped: 0, remembered: false };
  if (!from || nameKey(from) === nameKey(into)) return result;

  // 1) member rows
  type M = { id: string; name: string; chapter_id: string };
  const fromRows = ((await sb.from("members").select("id,name,chapter_id").eq("tenant_id", tenantId).ilike("name", escapeLike(from))).data ?? []) as M[];
  const intoRows = ((await sb.from("members").select("id,name,chapter_id").eq("tenant_id", tenantId).ilike("name", escapeLike(into))).data ?? []) as M[];
  for (const f of fromRows) {
    const target = intoRows.find((i) => i.chapter_id === f.chapter_id);
    if (!target) {
      // The canonical spelling has no row in this chapter yet: just rename.
      await sb.from("members").update({ name: into }).eq("id", f.id);
      intoRows.push({ ...f, name: into });
      result.membersMerged++;
      continue;
    }
    for (const [table, col] of ID_COLUMNS) {
      await sb.from(table).update({ [col]: target.id }).eq("tenant_id", tenantId).eq(col, f.id);
    }
    await sb.from("members").delete().eq("id", f.id);
    result.membersMerged++;
  }

  // 2) stored names on the slips
  for (const [table, col] of NAME_COLUMNS) {
    const { data } = await sb
      .from(table)
      .update({ [col]: into })
      .eq("tenant_id", tenantId)
      .ilike(col, escapeLike(from))
      .select("id");
    result.namesRewritten += data?.length ?? 0;
  }

  // 3) attendance (unique per tenant + week + lower(name))
  const attFrom = ((await sb.from("member_attendance").select("id,bni_week_id").eq("tenant_id", tenantId).ilike("member_name", escapeLike(from))).data ?? []) as { id: string; bni_week_id: string }[];
  if (attFrom.length > 0) {
    const attInto = ((await sb.from("member_attendance").select("bni_week_id").eq("tenant_id", tenantId).ilike("member_name", escapeLike(into))).data ?? []) as { bni_week_id: string }[];
    const have = new Set(attInto.map((r) => r.bni_week_id));
    for (const r of attFrom) {
      if (have.has(r.bni_week_id)) {
        await sb.from("member_attendance").delete().eq("id", r.id);
        result.attendanceDropped++;
      } else {
        await sb.from("member_attendance").update({ member_name: into }).eq("id", r.id);
        result.attendanceMoved++;
      }
    }
  }

  // 4) remember it
  const saved = await saveAliases(tenantId, { [from]: into });
  result.remembered = !saved.error && saved.saved > 0;
  if (saved.error) {
    result.warning = `Merged, but the merge could not be remembered (${saved.error}). Run supabase/migrations/008_member_aliases.sql.`;
  }
  clearDistinctCache();
  clearSlipsSnapshotCache();
  return result;
}
