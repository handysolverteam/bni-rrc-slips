import { lightFor, pointsFor, type LightColor } from "@/lib/traffic-light-score";

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

/** First day of the 6-month window ending in `endMonth` (`YYYY-MM`): Apr–Sep or May–Oct, … */
export function windowStart(endMonth: string): string {
  const [y, m] = endMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - 5, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Last day (inclusive, as a sortable string bound) of `endMonth`. */
export function windowEnd(endMonth: string): string {
  return `${endMonth}-31`;
}

/** The meetings whose date falls in the 6 calendar months ending in `endMonth`. */
export function windowMeetings(all: Meeting[], endMonth: string): Meeting[] {
  const from = windowStart(endMonth);
  const to = windowEnd(endMonth);
  return all.filter((w) => w.date >= from && w.date <= to);
}

export type SlipRows = {
  /** referral GIVER name + whether that name is a member of ANOTHER chapter (bold in the file). */
  referrals: { week: string; from: string; fromOther?: boolean | null }[];
  /** both sides of a 121 + their other-chapter flags. */
  oneToOnes: { week: string; a: string; aOther?: boolean | null; b: string; bOther?: boolean | null }[];
  ceus: { week: string; name: string; credits: number }[];
  tyfcb: { week: string; name: string; amount: number }[];
  visitors: { week: string; inviter: string | null }[];
  /** PALMS attendance cells: one row per (member, week), flags 0/1 (legacy rows may hold counts). */
  attendance: { week: string; name: string; present: number; absent: number; m: number; s: number; l: number }[];
};

/** One member's row in BNI's Traffic Lights Excel (the reference / override source). */
export type BniRow = {
  name: string;
  total: number;
  attendanceRate: number | null;
  attendanceScore: number;
  ceuRate: number | null;
  oneToOneRate: number | null;
  referralsRate: number | null;
  tyfcb: number | null;
  visitors: number;
  sponsors: number;
};

export type Source = "slips" | "palms" | "bni" | "none";

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
  visitors: { count: number; score: number; source: Source; slips: number };
  sponsors: { count: number; score: number; source: Source };
  total: number;
  color: LightColor;
  /** BNI's own total for this member (when a BNI file is imported for the month). */
  bni: { total: number; color: LightColor; matches: boolean } | null;
  /** Plain-language flags such as "attendance not imported". */
  notes: string[];
};

export type TrafficInput = {
  /** Active members of the home chapter. */
  members: string[];
  meetings: Meeting[];
  slips: SlipRows;
  bni: BniRow[];
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Score every member for the window. Sourcing (hybrid): attendance from PALMS attendance, CEU / 121 /
 * referrals / TYFCB from the slips, VISITORS and SPONSORS from BNI's Excel when one is imported for the
 * month (else visitors from the slips, sponsors 0). Rows flagged "other chapter" in the slips are another
 * person with the same name and are not counted.
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

  type Att = { p: number; a: number; m: number; s: number; first: string };
  const dateOf = new Map(input.meetings.map((m) => [m.id, m.date]));
  const att = new Map<string, Att>();
  for (const r of slips.attendance) {
    if (!inWin.has(r.week)) continue;
    const k = nameKey(r.name);
    const date = dateOf.get(r.week) ?? "9999";
    const c = att.get(k) ?? { p: 0, a: 0, m: 0, s: 0, first: date };
    c.p += num(r.present);
    c.a += num(r.absent);
    c.m += num(r.m);
    c.s += num(r.s);
    if (date < c.first) c.first = date;
    att.set(k, c);
  }

  const resolve = makeResolver(input.members);
  const bni = new Map<string, BniRow>();
  for (const r of input.bni) {
    const k = resolve(r.name);
    if (k) bni.set(k, r);
  }
  const attByMember = new Map<string, Att>();
  for (const [k, v] of att) {
    const mk = resolve(k);
    if (!mk) continue;
    const c = attByMember.get(mk) ?? { p: 0, a: 0, m: 0, s: 0, first: v.first };
    c.p += v.p;
    c.a += v.a;
    c.m += v.m;
    c.s += v.s;
    if (v.first < c.first) c.first = v.first;
    attByMember.set(mk, c);
  }
  const haveBni = bni.size > 0;

  return input.members.map((name) => {
    const k = nameKey(name);
    const notes: string[] = [];
    const a = attByMember.get(k);
    const observed = a ? a.p + a.a + a.m + a.s : 0;
    const bniRow = bni.get(k) ?? null;

    // Weeks the rates are divided by (BNI prorates a member who joined part-way through the window):
    //  1. BNI's file present -> the weeks its own rates imply (count / rate), the most faithful source;
    //  2. else from the member's first PALMS attendance onward;
    //  3. else the window's meetings.
    const ref = refs.get(k) ?? 0;
    const oto = otos.get(k) ?? 0;
    const ceu = ceus.get(k) ?? 0;
    const implied: number[] = [];
    if (bniRow) {
      for (const [count, r] of [[ref, bniRow.referralsRate], [oto, bniRow.oneToOneRate], [ceu, bniRow.ceuRate]] as [number, number | null][]) {
        if (r && r > 0.0001 && count > 0) implied.push(Math.round(count / r));
      }
    }
    implied.sort((x, y) => x - y);
    const impliedWeeks = implied.length > 0 ? implied[Math.floor(implied.length / 2)] : null;
    let weeks = reportWeeks;
    if (impliedWeeks !== null && impliedWeeks >= 1 && impliedWeeks <= reportWeeks) {
      weeks = impliedWeeks;
      if (weeks < reportWeeks) notes.push(`part-year member: ${weeks} weeks (from BNI's rates)`);
    } else if (a && observed > 0) {
      weeks = Math.max(1, input.meetings.filter((m) => m.date >= a.first).length);
      if (weeks < reportWeeks) notes.push(`part-year member: ${weeks} weeks since first attendance`);
    }
    weeks = Math.max(1, weeks);
    const prorated = weeks < reportWeeks;

    // PALMS attendance is used when it covers (nearly) every week; otherwise BNI's attendance if we have it.
    const attComplete = !!a && observed > 0 && observed >= Math.floor(weeks * 0.9);
    let attendance: TrafficRow["attendance"];
    if (a && observed > 0 && (attComplete || !bniRow || bniRow.attendanceRate === null)) {
      const attended = a.p + a.m + a.s;
      const rate = attended + a.a > 0 ? attended / (attended + a.a) : 0;
      attendance = { rate, score: pointsFor("attendance", rate), source: "palms" };
      if (!attComplete) notes.push(`PALMS attendance covers ${observed} of ${weeks} weeks`);
    } else if (bniRow && bniRow.attendanceRate !== null) {
      // BNI's own attendance score is taken as printed (it rounds a hair differently at the 96% line).
      attendance = { rate: bniRow.attendanceRate, score: bniRow.attendanceScore, source: "bni" };
      notes.push("attendance from BNI's file (PALMS attendance not imported for this member)");
    } else {
      attendance = { rate: null, score: 0, source: "none" };
      notes.push("attendance not imported — 0 points");
    }

    const rate = (n: number) => n / weeks;
    const ceuRate = rate(ceus.get(k) ?? 0);
    const otoRate = rate(otos.get(k) ?? 0);
    const refRate = rate(refs.get(k) ?? 0);
    const amount = tyfcb.get(k) ?? 0;

    const slipVisitors = visits.get(k) ?? 0;
    const useBniVisitors = !!bniRow;
    const visitorCount = useBniVisitors ? bniRow!.visitors : slipVisitors;
    if (useBniVisitors && bniRow!.visitors !== slipVisitors) notes.push(`visitors from BNI (${bniRow!.visitors}); slips show ${slipVisitors}`);
    if (!useBniVisitors && haveBni) notes.push("not found in BNI's file");

    const sponsorCount = bniRow ? bniRow.sponsors : 0;
    const sponsorSource: Source = bniRow ? "bni" : "none";

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
      visitors: { count: visitorCount, score: parts.visitors, source: useBniVisitors ? "bni" : "slips", slips: slipVisitors },
      sponsors: { count: sponsorCount, score: parts.sponsors, source: sponsorSource },
      total,
      color: lightFor(total),
      bni: bniRow ? { total: bniRow.total, color: lightFor(bniRow.total), matches: bniRow.total === total } : null,
      notes,
    };
  });
}

/** Highest score first (ties by name), like BNI's sheet. */
export function sortTrafficRows(rows: TrafficRow[]): TrafficRow[] {
  return [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
