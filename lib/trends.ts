import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";

export type TrendWeek = { id: string; date: string; label: string };
export type TrendSeries = { key: string; label: string; counts: number[] };
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
      const rows = await fetchAllRows<{ bni_week_id: string | null }>(s.table, "bni_week_id", {
        eq: [["tenant_id", tenantId]],
        in: [["bni_week_id", weekIds]],
        pageSize: 1000,
      });
      const tally = new Map<string, number>();
      for (const r of rows) {
        if (r.bni_week_id) tally.set(r.bni_week_id, (tally.get(r.bni_week_id) ?? 0) + 1);
      }
      return { key: s.key, label: s.label, counts: weeks.map((w) => tally.get(w.id) ?? 0) };
    }),
  );
  return { weeks, series };
}
