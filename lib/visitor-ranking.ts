import { cachedSwr } from "@/lib/cache";
import { fetchAllRows } from "@/lib/supabase/paged";
import { homeChapterNameOf } from "@/lib/new-members";
import type { MonthCounts } from "@/lib/visitor-ranking-share";

type Joined = { meeting_date: string | null } | { meeting_date: string | null }[] | null;

const dateOf = (j: Joined | undefined): string | null =>
  (Array.isArray(j) ? j[0]?.meeting_date : j?.meeting_date) ?? null;

export type VisitorRankingData = {
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
  const [vis, members, home] = await Promise.all([
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
  return { counts, pool };
}
