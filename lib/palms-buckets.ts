// Rolling 26-week attendance breakdown for the `/palms` "Active members"
// card — pure functions (no I/O), unit-tested standalone in
// tests/unit-palms-stats.mjs.

export type AttendanceFlagRow = {
  member_name: string;
  absent: number | null;
  m: number | null;
  s: number | null;
};

export type PalmsBucket = { label: string; count: number; names: string[] };
export type PalmsBucketGroup = {
  key: "absent" | "medical" | "substitute";
  buckets: PalmsBucket[];
};

/** The rolling window is 26 weeks = 182 days, ending on (and including) today. */
export const ROLLING_WEEKS = 26;

/** Inclusive `[from, to]` day window: the last 26 weeks ending at `todayIso`. */
export function rollingWindow(todayIso: string): { from: string; to: string } {
  const t = Date.parse(`${todayIso}T00:00:00Z`);
  const from = new Date(t - (ROLLING_WEEKS * 7 - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(new Date(t)) };
}

/** Display-normalised member name key (same rule as the matrix). */
export const attendanceNameKey = (n: string): string =>
  n.replace(/\s+/g, " ").trim().toLowerCase();

const GROUPS: { key: PalmsBucketGroup["key"]; labels: [string, string, string] }[] = [
  { key: "absent", labels: ["3+ Absents", "2 Absents", "1 Absent"] },
  { key: "medical", labels: ["3+ Medicals", "2 Medicals", "1 Medical"] },
  { key: "substitute", labels: ["3+ Substitutes", "2 Substitutes", "1 Substitute"] },
];

/** Which of the three mutually exclusive buckets a total lands in (−1 = none). */
export function bucketIndexFor(total: number): number {
  if (total >= 3) return 0;
  if (total === 2) return 1;
  if (total === 1) return 2;
  return -1;
}

/**
 * Bucket the members of a rolling window by how many A / M / S letters they
 * collected across `rows` (attendance rows already restricted to the window):
 * - names in `inactiveKeys` (lowercase name keys) are excluded entirely;
 * - buckets per letter are mutually exclusive (4 absents → only "3+ Absents");
 * - the three letters count independently (one member may sit in several);
 * - `names` are alphabetical; `total` = distinct members in at least one bucket.
 */
export function bucketAttendance(
  rows: AttendanceFlagRow[],
  inactiveKeys: string[],
): { groups: PalmsBucketGroup[]; total: number } {
  const inactive = new Set(inactiveKeys);
  const byName = new Map<string, { name: string; a: number; m: number; s: number }>();
  for (const r of rows) {
    const key = attendanceNameKey(r.member_name ?? "");
    if (!key || inactive.has(key)) continue;
    let agg = byName.get(key);
    if (!agg) {
      agg = { name: r.member_name.replace(/\s+/g, " ").trim(), a: 0, m: 0, s: 0 };
      byName.set(key, agg);
    }
    agg.a += r.absent ?? 0;
    agg.m += r.m ?? 0;
    agg.s += r.s ?? 0;
  }
  const members = [...byName.values()];
  const totals = {
    absent: (m: (typeof members)[number]) => m.a,
    medical: (m: (typeof members)[number]) => m.m,
    substitute: (m: (typeof members)[number]) => m.s,
  };
  const groups: PalmsBucketGroup[] = GROUPS.map((g) => {
    const buckets: PalmsBucket[] = g.labels.map((label) => ({ label, count: 0, names: [] }));
    for (const m of members) {
      const bi = bucketIndexFor(totals[g.key](m));
      if (bi >= 0) {
        buckets[bi].count += 1;
        buckets[bi].names.push(m.name);
      }
    }
    for (const b of buckets) b.names.sort((x, y) => x.localeCompare(y));
    return { key: g.key, buckets };
  });
  const total = members.filter((m) => m.a > 0 || m.m > 0 || m.s > 0).length;
  return { groups, total };
}
