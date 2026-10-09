import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";
import { resolveHomeChapter } from "@/lib/member-chapters";

export type TrendWeek = { id: string; date: string; label: string };
/** `amounts` (TYFCB only): weekly rupee totals — plotted on the series' own tab,
 *  while `counts` keeps the slip-row count used by the All view. */
export type TrendSeries = { key: string; label: string; counts: number[]; amounts?: number[] };
export type SlipTrends = { weeks: TrendWeek[]; series: TrendSeries[] };

/** The 5 slip types shown on the home dashboard, in display order. */
const SERIES = [
  { key: "one-to-one", label: "Slip 121", table: "slip_one_to_ones" },
  { key: "referral", label: "Referrals", table: "slip_referrals" },
  { key: "tyfcb", label: "TYFCB", table: "slip_tyfcb" },
  { key: "visitor", label: "Visitors", table: "slip_visitors" },
  { key: "ceu", label: "CEU", table: "slip_ceus" },
] as const;

/**
 * Weekly trend counts for the home dashboard: every Wednesday meeting of the
 * global `bni_weeks` calendar in the last `months` months (ascending), and
 * one `counts` array per slip type aligned with those weeks (0 = no import
 * for that week). Counts are raw slip rows — no owner weighting — so the
 * five series stay comparable.
 */
export async function fetchSlipTrends(tenantId: string, months = 6): Promise<SlipTrends> {
  const sb = getSupabaseServer();
  const today = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("bni_weeks")
    .select("id,label,meeting_date")
    .gte("meeting_date", iso(from))
    .lte("meeting_date", iso(today))
    .order("meeting_date", { ascending: true })
    .limit(40);
  if (error) throw new Error(error.message);
  const weeks = ((data ?? []) as { id: string; label: string; meeting_date: string | null }[])
    .filter((w) => w.meeting_date && new Date(`${w.meeting_date}T12:00:00Z`).getUTCDay() === 3)
    .map((w) => ({ id: w.id, date: w.meeting_date as string, label: w.label }));
  if (weeks.length === 0) return { weeks: [], series: [] };
  const weekIds = weeks.map((w) => w.id);
  const series = await Promise.all(
    SERIES.map(async (s) => {
      const money = s.key === "tyfcb";
      const rows = await fetchAllRows<{ bni_week_id: string | null; amount?: number | null }>(
        s.table,
        money ? "bni_week_id,amount" : "bni_week_id",
        {
          eq: [["tenant_id", tenantId]],
          in: [["bni_week_id", weekIds]],
          pageSize: 1000,
        },
      );
      const tally = new Map<string, number>();
      const sums = new Map<string, number>();
      for (const r of rows) {
        if (!r.bni_week_id) continue;
        tally.set(r.bni_week_id, (tally.get(r.bni_week_id) ?? 0) + 1);
        if (money) sums.set(r.bni_week_id, (sums.get(r.bni_week_id) ?? 0) + Number(r.amount ?? 0));
      }
      return {
        key: s.key,
        label: s.label,
        counts: weeks.map((w) => tally.get(w.id) ?? 0),
        ...(money ? { amounts: weeks.map((w) => sums.get(w.id) ?? 0) } : {}),
      };
    }),
  );
  return { weeks, series };
}

/** The 5 attendance letters shown on the home dashboard's upper chart. */
const ATTENDANCE_SERIES = [
  { key: "present", label: "Present", flag: "present" },
  { key: "absent", label: "Absent", flag: "absent" },
  { key: "medical", label: "Medical", flag: "m" },
  { key: "substitute", label: "Substitute", flag: "s" },
  { key: "leave", label: "Leave", flag: "l" },
] as const;

export type AttendanceRow = {
  member_name: string;
  bni_week_id: string | null;
  present: number | null;
  absent: number | null;
  m: number | null;
  s: number | null;
  l: number | null;
};

/**
 * Weekly attendance sums for the home dashboard: the same `weeks` array as
 * the slip chart and one `counts` array per PALMS letter (Present/Absent/
 * Medical/Substitute/Leave), each the sum of that flag over the tenant's
 * `member_attendance` rows per week (0 = no attendance imported that week).
 */
export async function fetchAttendanceTrends(tenantId: string, weeks: TrendWeek[]): Promise<SlipTrends> {
  if (weeks.length === 0) return { weeks: [], series: [] };
  const { activeKeys } = await fetchHomeActiveMembers(tenantId);
  const rows = await fetchAllRows<AttendanceRow>("member_attendance", "member_name,bni_week_id,present,absent,m,s,l", {
    eq: [["tenant_id", tenantId]],
    in: [["bni_week_id", weeks.map((w) => w.id)]],
    pageSize: 1000,
  });
  const tally = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.bni_week_id || !activeKeys.has(nameKey(r.member_name))) continue;
    for (const s of ATTENDANCE_SERIES) {
      const v = Number(r[s.flag] ?? 0);
      if (v === 0) continue;
      const byWeek = tally.get(s.key) ?? new Map<string, number>();
      byWeek.set(r.bni_week_id, (byWeek.get(r.bni_week_id) ?? 0) + v);
      tally.set(s.key, byWeek);
    }
  }
  return {
    weeks,
    series: ATTENDANCE_SERIES.map((s) => ({
      key: s.key,
      label: s.label,
      counts: weeks.map((w) => tally.get(s.key)?.get(w.id) ?? 0),
    })),
  };
}

const nameKey = (n: string): string => n.replace(/\s+/g, " ").trim().toLowerCase();

/** Id of the tenant's HOME chapter row: configured home chapter first, then
 *  the tenant's own name, then the env name (a stray "BNI Influencer" row once
 *  made the env name unreliable). null when none of them exists. */
export async function fetchHomeChapterId(tenantId: string): Promise<string | null> {
  const sb = getSupabaseServer();
  const { data: tenant } = await sb
    .from("tenants")
    .select("id,name,home_chapter_name")
    .eq("id", tenantId)
    .maybeSingle();
  const home = resolveHomeChapter(tenant ?? { id: tenantId });
  for (const name of [tenant?.home_chapter_name ?? "", tenant?.name ?? "", home]) {
    if (!name) continue;
    const { data } = await sb
      .from("chapters")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  return null;
}

/**
 * Active members of the tenant's HOME chapter only (members the import filed
 * under another chapter are excluded). `activeKeys` are the lower-cased names
 * the attendance chart filters on.
 */
export async function fetchHomeActiveMembers(
  tenantId: string,
): Promise<{ count: number; activeKeys: Set<string> }> {
  const chapterId = await fetchHomeChapterId(tenantId);
  if (!chapterId) return { count: 0, activeKeys: new Set() };
  const rows = await fetchAllRows<{ name: string }>("members", "name", {
    eq: [
      ["tenant_id", tenantId],
      ["chapter_id", chapterId],
      ["is_inactive", false],
    ],
    pageSize: 1000,
  });
  return { count: rows.length, activeKeys: new Set(rows.map((r) => nameKey(r.name))) };
}
