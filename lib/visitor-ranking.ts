import { cachedSwr } from "@/lib/cache";
import { fetchAllRows } from "@/lib/supabase/paged";
import { homeChapterNameOf } from "@/lib/new-members";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { MonthCounts } from "@/lib/visitor-ranking-share";

type Joined = { meeting_date: string | null } | { meeting_date: string | null }[] | null;

const dateOf = (j: Joined | undefined): string | null =>
  (Array.isArray(j) ? j[0]?.meeting_date : j?.meeting_date) ?? null;

export type VisitorRankingData = {
  /** Months that have imported meetings, newest first (the Months filter + the "last 6 months" window). */
  months: { key: string; label: string }[];
  /** inviter -> visitors, per meeting month. */
  counts: MonthCounts;
  /** Active members of the home chapter (the pool for "brought none"). */
  pool: string[];
};

/** Visitors brought per inviter per meeting month + the active home roster. Cached like Top 3. */
export function fetchVisitorRanking(tenantId: string): Promise<VisitorRankingData> {
  return cachedSwr(`visrank:${tenantId}`, 60_000, () => compute(tenantId));
}

async function compute(tenantId: string): Promise<VisitorRankingData> {
  const eq = { eq: [["tenant_id", tenantId]] as [string, string][] };
  const [vis, members, home, months] = await Promise.all([
    fetchAllRows<{ invited_by_name: string | null; bni_weeks: Joined }>(
      "slip_visitors",
      "invited_by_name,bni_weeks(meeting_date)",
      eq,
    ),
    fetchAllRows<{ name: string; is_inactive: boolean | null; chapters: { name: string } | { name: string }[] | null }>(
      "members",
      "name,is_inactive,chapters(name)",
      { ...eq, order: { column: "id" } },
    ),
    homeChapterNameOf(tenantId),
    importedMonths(tenantId),
  ]);
  const counts: MonthCounts = {};
  for (const v of vis) {
    const d = dateOf(v.bni_weeks);
    const name = (v.invited_by_name ?? "").replace(/\s+/g, " ").trim();
    if (!d || !name) continue;
    const key = d.slice(0, 7);
    const m = (counts[key] ??= {});
    m[name] = (m[name] ?? 0) + 1;
  }
  const homeKey = home.trim().toLowerCase();
  const pool = members
    .filter((m) => {
      const ch = Array.isArray(m.chapters) ? m.chapters[0]?.name : m.chapters?.name;
      return m.is_inactive !== true && !!ch && ch.trim().toLowerCase() === homeKey;
    })
    .map((m) => m.name.replace(/\s+/g, " ").trim());
  return { months, counts, pool };
}

/**
 * Months of this tenant's imported slip weeks (import_batches -> bni_weeks), newest first — the same months the
 * Top 3 screen lists, from two tiny queries instead of reading every TYFCB / referral / visitor slip.
 */
async function importedMonths(tenantId: string): Promise<{ key: string; label: string }[]> {
  const sb = getSupabaseServer();
  const { data: batches, error } = await sb.from("import_batches").select("bni_week_id").eq("tenant_id", tenantId).not("bni_week_id", "is", null);
  if (error) throw new Error(`import_batches: ${error.message}`);
  const ids = [...new Set((batches ?? []).map((b) => b.bni_week_id as string))];
  if (ids.length === 0) return [];
  const { data: weeks, error: wErr } = await sb.from("bni_weeks").select("meeting_date").in("id", ids);
  if (wErr) throw new Error(`bni_weeks: ${wErr.message}`);
  const keys = [...new Set((weeks ?? []).map((w) => String(w.meeting_date ?? "").slice(0, 7)).filter((k) => /^\d{4}-\d{2}$/.test(k)))];
  return keys
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({
      key,
      label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
    }));
}
