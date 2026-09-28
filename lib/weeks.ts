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
