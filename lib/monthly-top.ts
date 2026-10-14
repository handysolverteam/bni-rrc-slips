import { cachedSwr } from "@/lib/cache";
import { fetchAllRows } from "@/lib/supabase/paged";
import { rankTop, type MonthTop } from "@/lib/monthly-top-share";
import { latestDate, rollingWindow, type PeriodWindow } from "@/lib/period";

type Joined = { meeting_date: string | null } | { meeting_date: string | null }[] | null;
type Ranked = { name: string | null; value: number }[];

const dateOf = (j: Joined | undefined): string | null =>
  (Array.isArray(j) ? j[0]?.meeting_date : j?.meeting_date) ?? null;

/**
 * Month-wise top 3 for the Top 3 screen: TYFCB (summed ₹ per thanked member),
 * Referrals (referrals given per member) and Visitors (visitors brought per
 * inviter), grouped by the meeting month of each slip, over every imported
 * week of the tenant (the screen filters the months). Referral givers from
 * another chapter (bold outsiders) are skipped. Newest month first.
 */
/** The month cards plus the standard last-6-months view of them. */
export type MonthlyTopData = {
  /** Every month with slips, newest first (full months — what a picked month shows). */
  months: MonthTop[];
  /** The standard window (lib/period.ts: ends on the newest slip's meeting, 6 months by date); null without slips. */
  window: PeriodWindow | null;
  /** The months touched by the window, newest first, the first one CLIPPED to the window's start (label "April 2026 (from 8 April)"). */
  windowMonths: MonthTop[];
};

export function fetchMonthlyTop(tenantId: string): Promise<MonthlyTopData> {
  return cachedSwr(`top3:${tenantId}`, 60_000, () => computeMonthlyTop(tenantId));
}

async function computeMonthlyTop(tenantId: string): Promise<MonthlyTopData> {
  const filters = { eq: [["tenant_id", tenantId]] as [string, string][] };
  const [tyfcb, ref, vis] = await Promise.all([
    fetchAllRows<{ member_name: string; amount: number | string | null; bni_weeks: Joined }>(
      "slip_tyfcb",
      "member_name,amount,bni_weeks(meeting_date)",
      filters,
    ),
    fetchAllRows<{ from_name: string; from_is_other_chapter: boolean | null; bni_weeks: Joined }>(
      "slip_referrals",
      "from_name,from_is_other_chapter,bni_weeks(meeting_date)",
      filters,
    ),
    fetchAllRows<{ invited_by_name: string | null; bni_weeks: Joined }>(
      "slip_visitors",
      "invited_by_name,bni_weeks(meeting_date)",
      filters,
    ),
  ]);

  // The standard window is anchored on the newest meeting that has a slip.
  const win = rollingWindow(latestDate([...tyfcb, ...ref, ...vis].map((r) => dateOf(r.bni_weeks))));

  type Bucket = { tyfcb: Ranked; referral: Ranked; visitor: Ranked };
  const build = (notBefore: string | null): Map<string, Bucket> => {
    const buckets = new Map<string, Bucket>();
    const at = (j: Joined | undefined): Bucket | null => {
      const d = dateOf(j);
      if (!d || (notBefore && d < notBefore)) return null;
      const key = d.slice(0, 7);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { tyfcb: [], referral: [], visitor: [] }));
      return b;
    };
    for (const r of tyfcb) at(r.bni_weeks)?.tyfcb.push({ name: r.member_name, value: Number(r.amount ?? 0) });
    for (const r of ref) {
      if (r.from_is_other_chapter) continue;
      at(r.bni_weeks)?.referral.push({ name: r.from_name, value: 1 });
    }
    for (const r of vis) at(r.bni_weeks)?.visitor.push({ name: r.invited_by_name, value: 1 });
    return buckets;
  };
  const labelOf = (key: string): string =>
    new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const toMonths = (buckets: Map<string, Bucket>, firstKey: string | null, firstNote: string): MonthTop[] =>
    [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, b]) => ({
        key,
        label: key === firstKey ? `${labelOf(key)} (${firstNote})` : labelOf(key),
        tyfcb: rankTop(b.tyfcb),
        referral: rankTop(b.referral),
        visitor: rankTop(b.visitor),
      }));

  const months = toMonths(build(null), null, "");
  // The window view: only slips inside the window, so its first (partial) month is clipped to the start date.
  const startKey = win ? win.from.slice(0, 7) : null;
  const dayName = win ? new Date(`${win.from}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : "";
  const windowMonths = win ? toMonths(build(win.from), win.from.slice(8) === "01" ? null : startKey, `from ${dayName}`) : [];
  return { months, window: win, windowMonths: windowMonths.filter((m) => !win || m.key <= win.to.slice(0, 7)) };
}
