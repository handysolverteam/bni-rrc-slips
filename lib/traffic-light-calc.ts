import { anchorForMonth, inWindow, latestDate, rollingWindow } from "@/lib/period";
import { attendancePoints, lightFor, pointsFor, type LightColor } from "@/lib/traffic-light-score";

/** Collapse spaces + lower-case: the key every other screen uses for a member name. */
export const nameKey = (n: string | null | undefined): string => String(n ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** "Ranjan K Sapra" and "Ranjan  Sapra" (BNI prints no middle initial) share the key "ranjan sapra". */
export const firstLastKey = (n: string | null | undefined): string => {
  const t = nameKey(n).replace(/\./g, "").split(" ").filter(Boolean);
  return t.length > 1 ? `${t[0]} ${t[t.length - 1]}` : (t[0] ?? "");
};

/**
 * BNI / PALMS names carry no middle initial ("Ranjan  Sapra" for "Ranjan K Sapra"): a name resolves to the
 * member whose key is identical, else to the UNIQUE member sharing first + last name (null when ambiguous
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

export type Meeting = { id: string; date: string };

/**
 * The meetings in the standard "last 6 months" window (lib/period.ts: ends on the report's anchor date, starts the
 * day after the same date 6 months earlier) for the report month `endMonth` (`YYYY-MM`). A finished month anchors on
 * its last day (BNI's September report = 31 Mar – 30 Sep = 27 meetings); the running month on the newest meeting.
 */
export function windowMeetings(all: Meeting[], endMonth: string): Meeting[] {
  const anchor = anchorForMonth(endMonth, latestDate(all.map((m) => m.date)));
  const w = rollingWindow(anchor);
  return w ? all.filter((m) => inWindow(m.date, w)) : [];
}

export type SlipRows = {
  /** referral GIVER name + whether that name is a member of ANOTHER chapter (bold in the file). */
  referrals: { week: string; from: string; fromOther?: boolean | null }[];
  /** both sides of a 121 + their other-chapter flags. */
  oneToOnes: { week: string; a: string; aOther?: boolean | null; b: string; bOther?: boolean | null }[];
  ceus: { week: string; name: string; credits: number }[];
  tyfcb: { week: string; name: string; amount: number }[];
  visitors: { week: string; inviter: string | null; /** the visitor's own name */ name?: string | null }[];
  /** PALMS attendance cells: one row per (member, week), flags 0/1 (legacy rows may hold counts). */
  attendance: { week: string; name: string; present: number; absent: number; m: number; s: number; l: number }[];
};

export type Source = "slips" | "palms" | "none";

export type TrafficRow = {
  name: string;
  /** Meetings the rates are divided by: the window's meetings, or the member's attended weeks when fewer. */
  weeks: number;
  /** true when `weeks` is the member's own attended weeks (joined part-way). */
  prorated: boolean;
  attendance: { rate: number | null; score: number; source: Source };
  ceu: { rate: number; score: number };
  oneToOne: { rate: number; score: number };
  referrals: { rate: number; score: number };
  tyfcb: { amount: number; score: number };
  visitors: { count: number; score: number; source: Source };
  sponsors: { count: number; score: number; source: Source };
  total: number;
  color: LightColor;
  /** Plain-language flags such as "attendance not imported". */
  notes: string[];
};

export type TrafficInput = {
  /** Active members of the home chapter. */
  members: string[];
  /** EVERY member of the home chapter (active or not): a visitor who is one of them was sponsored by their inviter. */
  homeAll?: string[];
  meetings: Meeting[];
  slips: SlipRows;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Score every member for the window, from OUR data only: attendance from the PALMS attendance import,
 * CEU / 121 / referrals / TYFCB / visitors from the slip audit report, sponsors from the visitor slips (a
 * visitor who is now a home-chapter member was sponsored by whoever invited them). Rows flagged "other
 * chapter" in the slips are another person with the same name and are not counted.
 */
export function buildTrafficRows(input: TrafficInput): TrafficRow[] {
  const inWin = new Set(input.meetings.map((m) => m.id));
  const reportWeeks = input.meetings.length;
  const { slips } = input;

  const bump = (m: Map<string, number>, key: string, by: number) => m.set(key, (m.get(key) ?? 0) + by);
  const refs = new Map<string, number>();
  for (const r of slips.referrals) if (inWin.has(r.week) && !r.fromOther) bump(refs, nameKey(r.from), 1);
  const otos = new Map<string, number>();
  for (const r of slips.oneToOnes) {
    if (!inWin.has(r.week)) continue;
    if (!r.aOther) bump(otos, nameKey(r.a), 1);
    if (!r.bOther) bump(otos, nameKey(r.b), 1);
  }
  const ceus = new Map<string, number>();
  for (const r of slips.ceus) if (inWin.has(r.week)) bump(ceus, nameKey(r.name), num(r.credits));
  const tyfcb = new Map<string, number>();
  for (const r of slips.tyfcb) if (inWin.has(r.week)) bump(tyfcb, nameKey(r.name), num(r.amount));
  const visits = new Map<string, number>();
  for (const r of slips.visitors) if (inWin.has(r.week) && r.inviter) bump(visits, nameKey(r.inviter), 1);
  // SPONSORS from the slips: a visitor in the window who is (now) a member of the home chapter was sponsored by
  // the member who invited them; each sponsored member counts once.
  const resolveHome = makeResolver(input.homeAll ?? input.members);
  const sponsored = new Map<string, Set<string>>();
  for (const r of slips.visitors) {
    if (!inWin.has(r.week) || !r.inviter || !r.name) continue;
    const who = resolveHome(r.name);
    if (!who || who === nameKey(r.inviter)) continue;
    const set = sponsored.get(nameKey(r.inviter)) ?? new Set<string>();
    set.add(who);
    sponsored.set(nameKey(r.inviter), set);
  }

  type Att = { p: number; a: number; m: number; s: number; l: number; first: string; dates: Set<string> };
  const dateOf = new Map(input.meetings.map((m) => [m.id, m.date]));
  const att = new Map<string, Att>();
  for (const r of slips.attendance) {
    if (!inWin.has(r.week)) continue;
    const k = nameKey(r.name);
    const date = dateOf.get(r.week) ?? "9999";
    const c = att.get(k) ?? { p: 0, a: 0, m: 0, s: 0, l: 0, first: date, dates: new Set<string>() };
    c.dates.add(date);
    c.p += num(r.present);
    c.a += num(r.absent);
    c.m += num(r.m);
    c.s += num(r.s);
    c.l += num(r.l);
    if (date < c.first) c.first = date;
    att.set(k, c);
  }

  const resolve = makeResolver(input.members);
  const attByMember = new Map<string, Att>();
  for (const [k, v] of att) {
    const mk = resolve(k);
    if (!mk) continue;
    const c = attByMember.get(mk) ?? { p: 0, a: 0, m: 0, s: 0, l: 0, first: v.first, dates: new Set<string>() };
    for (const d of v.dates) c.dates.add(d);
    c.p += v.p;
    c.a += v.a;
    c.m += v.m;
    c.s += v.s;
    c.l += v.l;
    if (v.first < c.first) c.first = v.first;
    attByMember.set(mk, c);
  }

  return input.members.map((name) => {
    const k = nameKey(name);
    const notes: string[] = [];
    const a = attByMember.get(k);
    // Every meeting with a letter (P, A, M, S or L).
    const observed = a ? a.p + a.a + a.m + a.s + a.l : 0;

    // Weeks the rates are divided by: BNI uses the member's own LETTERED meetings (P, A, M, S, L) — so a member who
    // joined part-way, or has a blank week, is divided by fewer weeks; no attendance at all = every meeting in the window.
    let weeks = reportWeeks;
    if (a && observed > 0) {
      weeks = Math.max(1, observed);
      if (weeks < reportWeeks) {
        // Why are some meetings of the window without a letter? Before the first one = joined part-way; after the last
        // one = the newest meeting(s) are not in the PALMS file yet; otherwise a blank week in between.
        const missing = input.meetings.map((m) => m.date).filter((d) => !a.dates.has(d)).sort();
        const last = [...a.dates].sort().at(-1) ?? "";
        const before = missing.filter((d) => d < a.first).length;
        const after = missing.filter((d) => d > last).length;
        const between = missing.length - before - after;
        const parts: string[] = [];
        if (before > 0) parts.push(`joined part-way (first PALMS letter ${a.first})`);
        if (after > 0) parts.push(`PALMS has no letter yet for the newest ${after} meeting${after === 1 ? "" : "s"} (${missing.filter((d) => d > last).join(", ")})`);
        if (between > 0) parts.push(`${between} blank week${between === 1 ? "" : "s"} in between`);
        notes.push(`${weeks} lettered weeks of ${reportWeeks}: ${parts.join("; ")}`);
      }
    }
    const prorated = weeks < reportWeeks;

    let attendance: TrafficRow["attendance"];
    if (a && observed > 0) {
      // BNI's rule: (weeks − absents) / weeks — present, medical, substitute AND leave all count as attended.
      const rate = (observed - a.a) / observed;
      attendance = { rate, score: attendancePoints(rate), source: "palms" };
      if (observed < Math.floor(reportWeeks * 0.5)) notes.push(`PALMS attendance covers only ${observed} of ${reportWeeks} weeks — import the full attendance`);
    } else {
      attendance = { rate: null, score: 0, source: "none" };
      notes.push("no PALMS attendance imported — 0 points");
    }

    const rate = (n: number) => n / weeks;
    const ceuRate = rate(ceus.get(k) ?? 0);
    const otoRate = rate(otos.get(k) ?? 0);
    const refRate = rate(refs.get(k) ?? 0);
    const amount = tyfcb.get(k) ?? 0;

    const visitorCount = visits.get(k) ?? 0;
    const sponsorCount = sponsored.get(k)?.size ?? 0;

    const parts = {
      attendance: attendance.score,
      ceu: pointsFor("ceu", ceuRate),
      oneToOne: pointsFor("oneToOne", otoRate),
      referrals: pointsFor("referrals", refRate),
      tyfcb: pointsFor("tyfcb", amount),
      visitors: pointsFor("visitors", visitorCount),
      sponsors: pointsFor("sponsors", sponsorCount),
    };
    const total = Object.values(parts).reduce((s, v) => s + v, 0);

    return {
      name,
      weeks,
      prorated,
      attendance,
      ceu: { rate: ceuRate, score: parts.ceu },
      oneToOne: { rate: otoRate, score: parts.oneToOne },
      referrals: { rate: refRate, score: parts.referrals },
      tyfcb: { amount, score: parts.tyfcb },
      visitors: { count: visitorCount, score: parts.visitors, source: "slips" },
      sponsors: { count: sponsorCount, score: parts.sponsors, source: "slips" },
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
