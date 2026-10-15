import { attendancePoints, lightFor, pointsFor, type LightColor } from "@/lib/traffic-light-score";

/** Collapse spaces + lower-case: the key every other screen uses for a member name. */
export const nameKey = (n: string | null | undefined): string => String(n ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** "Ranjan K Sapra" and "Ranjan  Sapra" (BNI prints no middle initial) share the key "ranjan sapra". */
export const firstLastKey = (n: string | null | undefined): string => {
  const t = nameKey(n).replace(/\./g, "").split(" ").filter(Boolean);
  return t.length > 1 ? `${t[0]} ${t[t.length - 1]}` : (t[0] ?? "");
};

/**
 * Sponsor Report names and PALMS names are spelled differently ("Ranjan Sapra" / "Ranjan K Sapra"): a name resolves to
 * the PALMS member whose key is identical, else to the UNIQUE member sharing first + last name (null when ambiguous
 * or unknown, so two namesakes are never merged).
 */
export function makeResolver(members: string[]): (name: string) => string | null {
  const memberKeys = new Set(members.map(nameKey));
  const byFirstLast = new Map<string, string[]>();
  for (const name of members) byFirstLast.set(firstLastKey(name), [...(byFirstLast.get(firstLastKey(name)) ?? []), nameKey(name)]);
  return (name) => {
    const k = nameKey(name);
    if (memberKeys.has(k)) return k;
    const cand = byFirstLast.get(firstLastKey(name));
    return cand && cand.length === 1 ? cand[0] : null;
  };
}

/** One member's line of the imported Chapter Summary PALMS Report (totals for the whole range). */
export type PalmsLine = {
  name: string;
  p: number;
  a: number;
  l: number;
  m: number;
  s: number;
  rgi: number;
  rgo: number;
  visitors: number;
  oneToOnes: number;
  tyfcb: number;
  ceu: number;
};

/** One line of the imported Chapter Sponsor Report. */
export type SponsorLine = { sponsor: string; sponsored: string; applicationDate: string | null };

export type TrafficRow = {
  name: string;
  /** Meetings the rates are divided by: the member's own lettered meetings (P + A + L + M + S). */
  weeks: number;
  attendance: { rate: number | null; score: number };
  ceu: { rate: number; score: number };
  oneToOne: { rate: number; score: number };
  referrals: { rate: number; score: number };
  tyfcb: { amount: number; score: number };
  visitors: { count: number; score: number };
  sponsors: { count: number; score: number };
  total: number;
  color: LightColor;
  /** Plain-language flags such as "no letters in the PALMS report". */
  notes: string[];
};

export type TrafficInput = {
  rows: PalmsLine[];
  /** Sponsor Report lines of the SAME range; null = no Sponsor Report imported for it. */
  sponsors: SponsorLine[] | null;
  from: string;
  to: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Wednesdays from `from` to `to` inclusive (a fallback divisor for a member with no letters at all). */
export function wednesdaysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  let n = 0;
  for (let t = start; t <= end; t += 86400000) if (new Date(t).getUTCDay() === 3) n++;
  return n;
}

/**
 * Score every member of the imported PALMS summary, from BNI's own reports only: weeks = P + A + L + M + S (the member's
 * lettered meetings), attendance = (weeks − A) / weeks, CEU / 1-2-1 / (RGI + RGO) per week, TYFCB amount, visitors = V,
 * sponsors = Sponsor Report rows of the member whose application date falls inside the range.
 */
export function buildTrafficRows(input: TrafficInput): TrafficRow[] {
  const resolve = makeResolver(input.rows.map((r) => r.name));
  const sponsored = new Map<string, number>();
  for (const s of input.sponsors ?? []) {
    const who = resolve(s.sponsor);
    if (!who) continue;
    if (s.applicationDate && (s.applicationDate < input.from || s.applicationDate > input.to)) continue;
    sponsored.set(who, (sponsored.get(who) ?? 0) + 1);
  }
  const fallbackWeeks = wednesdaysBetween(input.from, input.to);

  return input.rows.map((r) => {
    const notes: string[] = [];
    const lettered = num(r.p) + num(r.a) + num(r.l) + num(r.m) + num(r.s);
    const weeks = lettered > 0 ? lettered : Math.max(1, fallbackWeeks);
    if (lettered === 0) notes.push("no attendance letters in the PALMS report — attendance 0 points");
    else if (fallbackWeeks > 0 && lettered < fallbackWeeks) notes.push(`${lettered} lettered weeks of ${fallbackWeeks} in the range (joined part-way or blank weeks)`);

    // BNI's rule: (weeks − absents) / weeks — present, medical, substitute AND leave all count as attended.
    const attRate = lettered > 0 ? (lettered - num(r.a)) / lettered : null;
    const attScore = attRate === null ? 0 : attendancePoints(attRate);
    const ceuRate = num(r.ceu) / weeks;
    const otoRate = num(r.oneToOnes) / weeks;
    const refRate = (num(r.rgi) + num(r.rgo)) / weeks;
    const amount = num(r.tyfcb);
    const visitorCount = num(r.visitors);
    const sponsorCount = sponsored.get(nameKey(r.name)) ?? 0;

    const parts = {
      attendance: attScore,
      ceu: pointsFor("ceu", ceuRate),
      oneToOne: pointsFor("oneToOne", otoRate),
      referrals: pointsFor("referrals", refRate),
      tyfcb: pointsFor("tyfcb", amount),
      visitors: pointsFor("visitors", visitorCount),
      sponsors: pointsFor("sponsors", sponsorCount),
    };
    const total = Object.values(parts).reduce((s, v) => s + v, 0);

    return {
      name: r.name,
      weeks,
      attendance: { rate: attRate, score: attScore },
      ceu: { rate: ceuRate, score: parts.ceu },
      oneToOne: { rate: otoRate, score: parts.oneToOne },
      referrals: { rate: refRate, score: parts.referrals },
      tyfcb: { amount, score: parts.tyfcb },
      visitors: { count: visitorCount, score: parts.visitors },
      sponsors: { count: sponsorCount, score: parts.sponsors },
      total,
      color: lightFor(total),
      notes,
    };
  });
}

/** Highest score first (ties by name), like BNI's sheet. */
export function sortTrafficRows(rows: TrafficRow[]): TrafficRow[] {
  return [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
