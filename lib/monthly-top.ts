import { cachedSwr } from "@/lib/cache";
import { homeChapterNameOf } from "@/lib/new-members";
import { fetchAllRows } from "@/lib/supabase/paged";
import { rankTop, type MonthTop } from "@/lib/monthly-top-share";
import { latestDate, rollingWindow, type PeriodWindow } from "@/lib/period";
import { ALL_MEMBERS, makeNameMatcher, type TopFilter, type TopMember } from "@/lib/top-filter";

type Joined = { meeting_date: string | null } | { meeting_date: string | null }[] | null;
type Ranked = { name: string | null; value: number }[];

const dateOf = (j: Joined | undefined): string | null =>
  (Array.isArray(j) ? j[0]?.meeting_date : j?.meeting_date) ?? null;

type TyfcbRow = { member_name: string; amount: number | string | null; bni_weeks: Joined };
type ReferralRow = { from_name: string; from_is_other_chapter: boolean | null; bni_weeks: Joined };
type VisitorRow = { invited_by_name: string | null; bni_weeks: Joined };

/** Everything the Top 3 screen needs, before any member filter: the raw slips plus the member directory. */
export type TopSource = {
  tyfcb: TyfcbRow[];
  referrals: ReferralRow[];
  visitors: VisitorRow[];
  members: TopMember[];
  /** Chapters that have members (the Chapter filter's options), Home Chapter first. */
  chapters: { id: string; name: string }[];
  /** The Home Chapter's id (null when it has no members yet). */
  homeChapterId: string | null;
};

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

/** Raw slips + members, cached for a minute; the member filter is applied in memory by `buildMonthlyTop`. */
export function fetchTopSource(tenantId: string): Promise<TopSource> {
  return cachedSwr(`top3src:${tenantId}`, 60_000, () => loadTopSource(tenantId));
}

/** The month cards for a member filter (default: everybody — the screen passes the parsed filter). */
export async function fetchMonthlyTop(tenantId: string, filter: TopFilter = ALL_MEMBERS): Promise<MonthlyTopData> {
  return buildMonthlyTop(await fetchTopSource(tenantId), filter);
}

async function loadTopSource(tenantId: string): Promise<TopSource> {
  const filters = { eq: [["tenant_id", tenantId]] as [string, string][] };
  const [tyfcb, referrals, visitors, memberRows, home] = await Promise.all([
    fetchAllRows<TyfcbRow>("slip_tyfcb", "member_name,amount,bni_weeks(meeting_date)", filters),
    fetchAllRows<ReferralRow>("slip_referrals", "from_name,from_is_other_chapter,bni_weeks(meeting_date)", filters),
    fetchAllRows<VisitorRow>("slip_visitors", "invited_by_name,bni_weeks(meeting_date)", filters),
    fetchAllRows<{ name: string; is_inactive: boolean | null; chapter_id: string; chapters: { name: string } | { name: string }[] | null }>(
      "members",
      "name,is_inactive,chapter_id,chapters(name)",
      { ...filters, order: { column: "id" } },
    ),
    homeChapterNameOf(tenantId),
  ]);
  const members: TopMember[] = memberRows.map((m) => ({ name: m.name, inactive: m.is_inactive === true, chapterId: m.chapter_id }));
  const names = new Map<string, string>();
  for (const m of memberRows) {
    const ch = Array.isArray(m.chapters) ? m.chapters[0]?.name : m.chapters?.name;
    if (ch && !names.has(m.chapter_id)) names.set(m.chapter_id, ch);
  }
  const homeKey = home.trim().toLowerCase();
  const homeChapterId = [...names.entries()].find(([, n]) => n.trim().toLowerCase() === homeKey)?.[0] ?? null;
  const chapters = [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.id === homeChapterId ? -1 : b.id === homeChapterId ? 1 : a.name.localeCompare(b.name)));
  return { tyfcb, referrals, visitors, members, chapters, homeChapterId };
}

/** Rank the slips of the members a filter lets through, month by month (and for the last-6-months window). */
export function buildMonthlyTop(src: TopSource, filter: TopFilter): MonthlyTopData {
  // The standard window is anchored on the newest meeting that has a slip (whatever the member filter).
  const win = rollingWindow(latestDate([...src.tyfcb, ...src.referrals, ...src.visitors].map((r) => dateOf(r.bni_weeks))));
  const allow = makeNameMatcher(src.members, filter);

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
    for (const r of src.tyfcb) if (allow(r.member_name)) at(r.bni_weeks)?.tyfcb.push({ name: r.member_name, value: Number(r.amount ?? 0) });
    for (const r of src.referrals) {
      if (r.from_is_other_chapter || !allow(r.from_name)) continue;
      at(r.bni_weeks)?.referral.push({ name: r.from_name, value: 1 });
    }
    for (const r of src.visitors) if (allow(r.invited_by_name)) at(r.bni_weeks)?.visitor.push({ name: r.invited_by_name, value: 1 });
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
