/**
 * Pure Wednesday-gap logic for the missing-meeting-file warning —
 * dependency-free on purpose so tests can compile and unit-test it directly
 * (`lib/data-health.ts` re-exports it and adds the DB fetch).
 */

/**
 * Every Wednesday from the earliest imported meeting date up to `todayIso`
 * (inclusive) that has no imported slips file. Weeks before the chapter
 * started are out of range; future Wednesdays are out of range; an empty
 * import history yields no warnings.
 */
export function missingWednesdays(importedDates: string[], todayIso: string): string[] {
  const have = new Set(importedDates.filter(Boolean));
  if (have.size === 0) return [];
  const first = new Date(`${[...have].sort()[0]}T00:00:00Z`);
  const today = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(today.getTime()) || first > today) return [];
  const out: string[] = [];
  for (const cur = new Date(first); cur <= today; cur.setUTCDate(cur.getUTCDate() + 1)) {
    if (cur.getUTCDay() !== 3) continue; // Wednesday
    const iso = cur.toISOString().slice(0, 10);
    if (!have.has(iso)) out.push(iso);
  }
  return out;
}

/** Today as a local YYYY-MM-DD string (server timezone). */
export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
