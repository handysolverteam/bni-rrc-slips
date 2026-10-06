import { fetchAllRows } from "@/lib/supabase/paged";

/** Metrics PALMS reports that must equal our own slip-derived counts. */
export const COMPARE_METRICS = [
  { key: "rgi", label: "RGI" },
  { key: "rgo", label: "RGO" },
  { key: "rri", label: "RRI" },
  { key: "rro", label: "RRO" },
  { key: "visitors", label: "V" },
  { key: "oneToOnes", label: "1-2-1" },
  { key: "tyfcb", label: "TYFCB" },
  { key: "ceu", label: "CEU" },
] as const;

export type MetricKey = (typeof COMPARE_METRICS)[number]["key"];

export type SlipTotals = Record<MetricKey, number>;

export type ComparisonRow = {
  key: MetricKey;
  label: string;
  palms: number;
  slips: number;
  match: boolean;
};

export type WeekComparison = {
  weekId: string;
  weekLabel: string;
  /** Every compared metric with both values (drives the side-by-side table). */
  rows: ComparisonRow[];
  allMatch: boolean;
};

type StatsRow = {
  bni_week_id: string;
  rgi: number;
  rgo: number;
  rri: number;
  rro: number;
  visitors: number;
  one_to_ones: number;
  tyfcb: number;
  ceu: number;
  bni_weeks: { label: string; meeting_date: string | null } | null;
};

/** Same rules as the report cards / summary totals — computed from raw rows. */
export function emptyTotals(): SlipTotals {
  return { rgi: 0, rgo: 0, rri: 0, rro: 0, visitors: 0, oneToOnes: 0, tyfcb: 0, ceu: 0 };
}

/**
 * The app's own slip counts per week (raw rows, not page-truncated — every
 * query is range-paged), using the report's home/bold + owner-count rules.
 * `weekIds` empty = every week of the tenant.
 */
export async function fetchSlipTotalsByWeek(
  tenantId: string,
  weekIds: string[],
): Promise<Map<string, SlipTotals>> {
  const opts = {
    eq: [["tenant_id", tenantId]] as [string, unknown][],
    in: weekIds.length > 0 ? ([["bni_week_id", weekIds]] as [string, string[]][]) : [],
    pageSize: 1000,
  };
  const [refs, otos, visitors, tyfcbs, ceus] = await Promise.all([
    fetchAllRows<{ bni_week_id: string; inside_outside: string | null; from_is_other_chapter: boolean | null; to_is_other_chapter: boolean | null }>(
      "slip_referrals", "bni_week_id,inside_outside,from_is_other_chapter,to_is_other_chapter", opts),
    fetchAllRows<{ bni_week_id: string; initiated_by_is_other_chapter: boolean | null; met_with_is_other_chapter: boolean | null }>(
      "slip_one_to_ones", "bni_week_id,initiated_by_is_other_chapter,met_with_is_other_chapter", opts),
    fetchAllRows<{ bni_week_id: string; invited_by_name: string | null }>(
      "slip_visitors", "bni_week_id,invited_by_name", opts),
    fetchAllRows<{ bni_week_id: string; amount: number | string }>(
      "slip_tyfcb", "bni_week_id,amount", opts),
    fetchAllRows<{ bni_week_id: string; credits: number | string }>(
      "slip_ceus", "bni_week_id,credits", opts),
  ]);

  const map = new Map<string, SlipTotals>();
  const ensure = (weekId: string): SlipTotals => {
    let t = map.get(weekId);
    if (!t) {
      t = emptyTotals();
      map.set(weekId, t);
    }
    return t;
  };

  for (const r of refs) {
    const t = ensure(r.bni_week_id);
    const tier1 = r.inside_outside === "Inside";
    if (!r.from_is_other_chapter) (tier1 ? t.rgi++ : t.rgo++);
    if (!r.to_is_other_chapter) (tier1 ? t.rri++ : t.rro++);
  }
  for (const r of otos) {
    const t = ensure(r.bni_week_id);
    if (!r.initiated_by_is_other_chapter) t.oneToOnes++;
    if (!r.met_with_is_other_chapter) t.oneToOnes++;
  }
  for (const r of visitors) {
    if (r.invited_by_name) ensure(r.bni_week_id).visitors++;
  }
  for (const r of tyfcbs) ensure(r.bni_week_id).tyfcb += Number(r.amount) || 0;
  for (const r of ceus) ensure(r.bni_week_id).ceu += Number(r.credits) || 0;
  return map;
}

/**
 * For every selected week that has a stored PALMS `Total` row (`palms_stats`),
 * compare it with the app's live slip counts. Weeks without PALMS data are
 * simply not part of the result (the screens note that separately).
 */
export async function fetchPalmsComparisons(
  tenantId: string,
  weekIds: string[],
): Promise<WeekComparison[]> {
  const [stats, slips] = await Promise.all([
    fetchAllRows<StatsRow>("palms_stats",
      "bni_week_id,rgi,rgo,rri,rro,visitors,one_to_ones,tyfcb,ceu,bni_weeks(label,meeting_date)", {
        eq: [["tenant_id", tenantId]],
        in: weekIds.length > 0 ? [["bni_week_id", weekIds]] : [],
        pageSize: 1000,
      }),
    fetchSlipTotalsByWeek(tenantId, weekIds),
  ]);

  const comparisons = stats.map((s) => {
    const palms: SlipTotals = {
      rgi: s.rgi,
      rgo: s.rgo,
      rri: s.rri,
      rro: s.rro,
      visitors: s.visitors,
      oneToOnes: s.one_to_ones,
      tyfcb: s.tyfcb,
      ceu: s.ceu,
    };
    const ours = slips.get(s.bni_week_id) ?? emptyTotals();
    const rows: ComparisonRow[] = COMPARE_METRICS.map((m) => ({
      key: m.key as MetricKey,
      label: m.label,
      palms: palms[m.key],
      slips: ours[m.key],
      match: palms[m.key] === ours[m.key],
    }));
    return {
      weekId: s.bni_week_id,
      weekLabel: s.bni_weeks?.label ?? "",
      meetingDate: s.bni_weeks?.meeting_date ?? "",
      rows,
      allMatch: rows.every((r) => r.match),
    };
  });
  return comparisons.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));
}
