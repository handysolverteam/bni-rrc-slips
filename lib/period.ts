/**
 * THE application-wide reporting window: "Last 6 months".
 *
 * BNI — and the bni-go-green-app (`performance-window.ts: getPerformanceWindow`, `scoringEngine.ts: reportWeeks`)
 * — measure performance over the last 6 MONTHS by DATE, not over a fixed 26 weeks: the window ends on an anchor
 * date and starts the day after the same date 6 months earlier. That holds 26 or 27 Wednesdays depending on the
 * dates (Mar 31 – Sep 30 '26 = 27 meetings, Apr 8 – Oct 7 '26 = 27), and every rate is divided by the meetings the
 * window actually holds. So "last 6 months", "last 26 weeks" and BNI's monthly traffic-light window are ONE thing.
 *
 * The anchor is the newest meeting date (a report for a past month anchors on that month's last day).
 */
export const WINDOW_MONTHS = 6;

export type PeriodWindow = {
  /** First day of the window, `YYYY-MM-DD`. */
  from: string;
  /** Anchor (last day) of the window, `YYYY-MM-DD`. */
  to: string;
  months: number;
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** Valid `YYYY-MM-DD` -> ms (UTC midnight); null otherwise. */
function parseDay(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}

const isoOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/**
 * The `months`-month window ending on `anchor` (go-green's rule): start = the day AFTER the anchor's day-of-month,
 * `months` months earlier (clamped to that month's length). Null for an invalid anchor.
 */
export function rollingWindow(anchor: string | null | undefined, months: number = WINDOW_MONTHS): PeriodWindow | null {
  const ms = parseDay(anchor);
  if (ms === null || months < 1) return null;
  const a = new Date(ms);
  const first = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - months, 1);
  const f = new Date(first);
  const lastDay = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  const prior = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), Math.min(a.getUTCDate(), lastDay));
  return { from: isoOf(prior + 86_400_000), to: isoOf(ms), months };
}

/** Newest date among the meeting dates; null when there are none. */
export function latestDate(dates: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    const k = parseDay(d) === null ? null : String(d).slice(0, 10);
    if (k && (best === null || k > best)) best = k;
  }
  return best;
}

/** The standard window for a set of meeting dates (anchored on the newest one); null without meetings. */
export function windowForDates(dates: Iterable<string | null | undefined>, months: number = WINDOW_MONTHS): PeriodWindow | null {
  const list = [...dates];
  return rollingWindow(latestDate(list), months);
}

/**
 * Anchor for a "report month" (`YYYY-MM`): the month's last day, but never later than the newest meeting — so a
 * finished month (September) anchors on 30 Sep (BNI's monthly report) and the running month on the latest meeting.
 */
export function anchorForMonth(month: string, newestMeeting: string | null | undefined): string {
  const [y, m] = month.split("-").map(Number);
  const end = isoOf(Date.UTC(y, m, 0));
  const newest = latestDate([newestMeeting]);
  return newest && newest < end && newest >= `${month}-01` ? newest : end;
}

export const inWindow = (date: string | null | undefined, w: PeriodWindow): boolean => !!date && date.slice(0, 10) >= w.from && date.slice(0, 10) <= w.to;

/** `YYYY-MM` of an ISO date; null for anything else. */
export function monthKeyOf(date: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(date ?? ""));
  return m ? `${m[1]}-${m[2]}` : null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayLabel = (iso: string, withYear: boolean): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}${withYear ? ` ${y}` : ""}`;
};

/** "8 April – 7 October 2026" (both years when the window crosses a year end). */
export function windowRange(w: PeriodWindow): string {
  const sameYear = w.from.slice(0, 4) === w.to.slice(0, 4);
  return `${dayLabel(w.from, !sameYear)} – ${dayLabel(w.to, true)}`;
}

/** "8 April – 7 October 2026 · 27 weeks". */
export function windowLabel(w: PeriodWindow, meetings: number): string {
  return `${windowRange(w)} · ${meetings} week${meetings === 1 ? "" : "s"}`;
}

/** Short title for headings: "Last 6 months (27 weeks)". */
export const windowTitle = (w: PeriodWindow, meetings: number): string =>
  `Last ${w.months} months (${meetings} week${meetings === 1 ? "" : "s"})`;
