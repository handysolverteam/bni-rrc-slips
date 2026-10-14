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

/** Week ids a filter value stands for: `last6m` -> the window's ids (comma list); anything else is returned unchanged. */
export function expandWeekToken(value: string | null | undefined, weeks: WeekOption[]): string {
  const v = (value ?? "").trim();
  if (!v.split(",").map((x) => x.trim()).includes(LAST6_TOKEN)) return v;
  return lastSixMonthsWeeks(weeks).map((w) => w.id).join(",");
}

/** Week options for a week dropdown WITHOUT its own "All" entry (the dropdown adds one): "Last 6 months" first, then each week. */
export function weekChoiceOptions(weeks: WeekOption[]): { value: string; label: string }[] {
  const last6 = lastSixMonthsOption(weeks);
  return [...(last6 ? [last6] : []), ...weeks.map((w) => ({ value: w.id, label: w.label }))];
}

/** Header "BNI Week" column-filter options: "All weeks" first, then "Last 6 months (N weeks)", then each week. */
export function weekFilterOptions(
  weeks: WeekOption[],
): { value: string; label: string }[] {
  return [{ value: "all", label: "All weeks" }, ...weekChoiceOptions(weeks)];
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
