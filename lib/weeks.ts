import { inWindow, latestDate, rollingWindow, windowTitle } from "@/lib/period";

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Chapter meetings are every Wednesday; labels read like "7 January 2026". */

/** Wednesday in JS Date terms (0 = Sunday). Chapter meetings are every Wednesday. */
export const MEETING_WEEKDAY = 3;

export type WeekOption = {
  id: string;
  label: string;
  meeting_date: string | null;
  /** Serial number in ascending meeting-date order (assigned when fetched). */
  week_no?: number | null;
};

/**
 * Special week-filter value meaning "the standard last 6 months" (lib/period.ts). It travels in the URL like a week id
 * and is expanded to the real week ids on the server (`expandWeekToken`), so it always follows the newest import.
 */
export const LAST6_TOKEN = "last6m";

/** The weeks (any order) inside the standard last-6-months window, anchored on the newest week in the list. */
export function lastSixMonthsWeeks(weeks: WeekOption[]): WeekOption[] {
  const win = rollingWindow(latestDate(weeks.map((w) => w.meeting_date)));
  return win ? weeks.filter((w) => inWindow(w.meeting_date, win)) : [];
}

/** The "Last 6 months (27 weeks)" dropdown option — the same entry in EVERY week dropdown; null when no week is in the window. */
export function lastSixMonthsOption(weeks: WeekOption[]): { value: string; label: string } | null {
  const win = rollingWindow(latestDate(weeks.map((w) => w.meeting_date)));
  const n = win ? weeks.filter((w) => inWindow(w.meeting_date, win)).length : 0;
  return win && n > 0 ? { value: LAST6_TOKEN, label: windowTitle(win, n) } : null;
}

/**
 * Date-range week filter value: `range:<from>..<to>` (ISO dates, either end may be empty = open). It travels in the URL
 * in the same parameter as a week id and is expanded to the real week ids on the server (`expandWeekToken`): a week is
 * inside the range when its meeting date is.
 */
export const RANGE_PREFIX = "range:";

/** A UUID that matches no week: a range with no imported week expands to it, so queries return nothing (not everything). */
export const NO_WEEK_ID = "00000000-0000-0000-0000-000000000000";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `range:from..to` for two optional ISO dates (a reversed pair is swapped); "" when neither is a valid date. */
export function rangeToken(from: string | null | undefined, to: string | null | undefined): string {
  let f = ISO_DAY.test((from ?? "").trim()) ? (from ?? "").trim() : "";
  let t = ISO_DAY.test((to ?? "").trim()) ? (to ?? "").trim() : "";
  if (!f && !t) return "";
  if (f && t && f > t) [f, t] = [t, f];
  return `${RANGE_PREFIX}${f}..${t}`;
}

/** The dates of a `range:` token (an end is "" when open); null when the value is not a valid range token. */
export function parseRangeToken(value: string | null | undefined): { from: string; to: string } | null {
  const v = (value ?? "").trim();
  if (!v.startsWith(RANGE_PREFIX)) return null;
  const [f = "", t = ""] = v.slice(RANGE_PREFIX.length).split("..");
  const from = ISO_DAY.test(f) ? f : "";
  const to = ISO_DAY.test(t) ? t : "";
  return from || to ? { from, to } : null;
}

/** The first `range:` token in a (possibly comma-separated) filter value; null when there is none. */
export function findRangeToken(value: string | null | undefined): string | null {
  for (const part of (value ?? "").split(",")) if (parseRangeToken(part)) return part.trim();
  return null;
}

/** The weeks whose meeting date is inside [from, to] (an empty end is open). Weeks without a meeting date never match. */
export function weeksInRange<T extends { meeting_date: string | null }>(weeks: T[], from: string, to: string): T[] {
  return weeks.filter((w) => !!w.meeting_date && (!from || w.meeting_date >= from) && (!to || w.meeting_date <= to));
}

/** "15 Apr 2026", "15 Apr 2026 – 14 Oct 2026", "From 15 Apr 2026", "Until 14 Oct 2026". */
export function rangeTitle(from: string, to: string): string {
  const day = (iso: string): string => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  };
  if (from && to) return from === to ? day(from) : `${day(from)} – ${day(to)}`;
  return from ? `From ${day(from)}` : `Until ${day(to)}`;
}

/** Earliest and latest meeting date among the weeks ("" when none) — the bounds of the date pickers. */
export function weekBounds(weeks: WeekOption[]): { min: string; max: string } {
  const dates = weeks.map((w) => w.meeting_date).filter((d): d is string => !!d).sort();
  return { min: dates[0] ?? "", max: dates[dates.length - 1] ?? "" };
}

/**
 * Week ids a filter value stands for: `range:…` -> the ids of the weeks inside that date range (NO_WEEK_ID when there is
 * none); `last6m` -> the window's ids (comma list); anything else is returned unchanged.
 */
export function expandWeekToken(value: string | null | undefined, weeks: WeekOption[]): string {
  const v = (value ?? "").trim();
  const range = parseRangeToken(findRangeToken(v));
  if (range) {
    const ids = weeksInRange(weeks, range.from, range.to).map((w) => w.id);
    return ids.length > 0 ? ids.join(",") : NO_WEEK_ID;
  }
  if (!v.split(",").map((x) => x.trim()).includes(LAST6_TOKEN)) return v;
  return lastSixMonthsWeeks(weeks).map((w) => w.id).join(",");
}

/** Week options for a week dropdown WITHOUT its own "All" entry (the dropdown adds one): "Last 6 months" first, then each week. */
export function weekChoiceOptions(weeks: WeekOption[], activeRange?: string | null): { value: string; label: string }[] {
  const last6 = lastSixMonthsOption(weeks);
  // The date range in use is shown in the dropdown as its own entry (so the box can display it).
  const range = parseRangeToken(activeRange);
  return [
    ...(range && activeRange ? [{ value: activeRange.trim(), label: rangeTitle(range.from, range.to) }] : []),
    ...(last6 ? [last6] : []),
    ...weeks.map((w) => ({ value: w.id, label: w.label })),
  ];
}

/** Header "BNI Week" column-filter options: "All weeks" first, then "Last 6 months (N weeks)", then each week. */
export function weekFilterOptions(
  weeks: WeekOption[],
  activeRange?: string | null,
): { value: string; label: string }[] {
  return [{ value: "all", label: "All weeks" }, ...weekChoiceOptions(weeks, activeRange)];
}

export function buildWeekLabel(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return "";
  const week = isoWeekNumber(isoDate);
  const datePart = `${day} ${MONTHS[month - 1]} ${year}`;
  return week ? `${datePart} (Week ${week})` : datePart;
}

/**
 * ISO-8601 week number of the year (matches Postgres EXTRACT(WEEK FROM d)).
 * E.g. 2026-01-07 -> 2, 2026-12-30 -> 53, 2027-01-06 -> 1.
 */
export function isoWeekNumber(isoDate: string): number | null {
  const ms = parseISODate(isoDate);
  if (ms == null) return null;
  const dayNum = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
  const thursdayMs = ms + (3 - dayNum) * 86_400_000; // Thursday of this week
  const thursday = new Date(thursdayMs);
  const jan4 = Date.UTC(thursday.getUTCFullYear(), 0, 4);
  const jan4DayNum = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4DayNum * 86_400_000;
  return 1 + Math.round((thursdayMs - week1Monday) / 604_800_000);
}

function toISODateUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(isoDate: string): number | null {
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Snap any date to the Wednesday of its Monday–Sunday week
 * (the chapter meeting day). E.g. Sat 2026-05-23 -> Wed 2026-05-20.
 */
export function wednesdayOfWeek(isoDate: string): string {
  const ms = parseISODate(isoDate);
  if (ms == null) return isoDate;
  const dow = new Date(ms).getUTCDay(); // 0 Sun … 6 Sat
  const mondayIndex = (dow + 6) % 7; // Mon = 0 … Sun = 6
  const wednesdayIndex = 2;
  return toISODateUTC(ms + (wednesdayIndex - mondayIndex) * 86_400_000);
}

/** Most recent Wednesday on or before the given local date (defaults to today). */
export function mostRecentWednesday(fromISODate?: string): string {
  let y: number;
  let m: number;
  let d: number;
  if (fromISODate) {
    const ms = parseISODate(fromISODate);
    if (ms == null) return fromISODate;
    const dt = new Date(ms);
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth();
    d = dt.getUTCDate();
  } else {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth();
    d = now.getDate();
  }
  const dow = new Date(y, m, d).getDay();
  const back = (dow - MEETING_WEEKDAY + 7) % 7;
  const target = new Date(y, m, d - back);
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${mm}-${dd}`;
}
