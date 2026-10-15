import { cachedSwr } from "@/lib/cache";
import { homeChapterNameOf } from "@/lib/new-members";
import { fetchAllRows } from "@/lib/supabase/paged";
import { buildTrafficRows, sortTrafficRows, type PalmsLine, type SponsorLine, type TrafficRow } from "@/lib/traffic-light-calc";

/** One imported range: the PALMS summary lines + (when imported) the Sponsor Report lines of the SAME range. */
export type TrafficReport = {
  /** `<from>_<to>` — the value of the `?month=` URL parameter. */
  key: string;
  from: string;
  to: string;
  rows: PalmsLine[];
  sponsors: SponsorLine[] | null;
};

export type TrafficData = {
  homeName: string;
  /** Imported ranges, newest `to` first. */
  reports: TrafficReport[];
  /** migration 010 has not been run yet. */
  needsMigration: boolean;
};

type PalmsDb = {
  period_from: string;
  period_to: string;
  member_name: string;
  p: number;
  a: number;
  l: number;
  m: number;
  s: number;
  rgi: number;
  rgo: number;
  visitors: number;
  one_to_ones: number;
  tyfcb: number | string;
  ceu: number;
};
type SponsorDb = { period_from: string; period_to: string; sponsor_name: string; sponsored_name: string; application_date: string | null };

const keyOf = (from: string, to: string): string => `${from}_${to}`;

/** Everything the screen needs, read once and cached for a minute (writes clear it with the other caches). */
export function fetchTrafficData(tenantId: string): Promise<TrafficData> {
  return cachedSwr(`traffic:${tenantId}`, 60_000, () => load(tenantId));
}

async function load(tenantId: string): Promise<TrafficData> {
  const homeName = await homeChapterNameOf(tenantId);
  const opts = { eq: [["tenant_id", tenantId]] as [string, string][], order: { column: "id" } };
  let palms: PalmsDb[];
  let sponsors: SponsorDb[];
  try {
    [palms, sponsors] = await Promise.all([
      fetchAllRows<PalmsDb>("traffic_palms_rows", "period_from,period_to,member_name,p,a,l,m,s,rgi,rgo,visitors,one_to_ones,tyfcb,ceu", opts),
      fetchAllRows<SponsorDb>("traffic_sponsor_rows", "period_from,period_to,sponsor_name,sponsored_name,application_date", opts),
    ]);
  } catch {
    return { homeName, reports: [], needsMigration: true };
  }

  const reports = new Map<string, TrafficReport>();
  for (const r of palms) {
    const key = keyOf(r.period_from, r.period_to);
    const rep = reports.get(key) ?? { key, from: r.period_from, to: r.period_to, rows: [], sponsors: null };
    rep.rows.push({
      name: r.member_name,
      p: r.p,
      a: r.a,
      l: r.l,
      m: r.m,
      s: r.s,
      rgi: r.rgi,
      rgo: r.rgo,
      visitors: r.visitors,
      oneToOnes: r.one_to_ones,
      tyfcb: Number(r.tyfcb ?? 0),
      ceu: r.ceu,
    });
    reports.set(key, rep);
  }
  // A Sponsor Report counts only for the PALMS range it was run for; a range with no sponsor lines of its own but a
  // Sponsor Report imported (nobody sponsored) is told apart from "never imported" by the empty-range marker row.
  for (const s of sponsors) {
    const rep = reports.get(keyOf(s.period_from, s.period_to));
    if (!rep) continue;
    rep.sponsors = rep.sponsors ?? [];
    if (s.sponsor_name) rep.sponsors.push({ sponsor: s.sponsor_name, sponsored: s.sponsored_name, applicationDate: s.application_date });
  }
  const list = [...reports.values()].sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : a.from < b.from ? 1 : -1));
  return { homeName, reports: list, needsMigration: false };
}

export type TrafficView = {
  /** Key of the range shown (`<from>_<to>`), "" when nothing is imported. */
  month: string;
  /** Imported ranges, newest first. */
  months: { key: string; label: string }[];
  /** Meetings in the range (Wednesdays) — shown in the heading. */
  windowLabel: string;
  rows: TrafficRow[];
  /** false when no Sponsor Report is imported for the range shown (sponsors score 0). */
  hasSponsorReport: boolean;
  needsMigration: boolean;
};

const dayLabel = (iso: string, withYear: boolean): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** "31 Mar – 14 Oct 2026" (the year is shown on both ends only when the range crosses a year). */
export const rangeLabel = (from: string, to: string): string =>
  from.slice(0, 4) === to.slice(0, 4) ? `${dayLabel(from, false)} – ${dayLabel(to, true)}` : `${dayLabel(from, true)} – ${dayLabel(to, true)}`;

/** Rows for the imported range `wanted` (default: the newest). */
export function trafficView(data: TrafficData, wanted: string | undefined): TrafficView {
  const months = data.reports.map((r) => ({ key: r.key, label: rangeLabel(r.from, r.to) }));
  const rep = data.reports.find((r) => r.key === wanted) ?? data.reports[0];
  if (!rep) {
    return { month: "", months, windowLabel: "No Traffic Lights reports imported yet", rows: [], hasSponsorReport: false, needsMigration: data.needsMigration };
  }
  const rows = sortTrafficRows(buildTrafficRows({ rows: rep.rows, sponsors: rep.sponsors, from: rep.from, to: rep.to }));
  return {
    month: rep.key,
    months,
    windowLabel: `BNI reports · ${rangeLabel(rep.from, rep.to)}`,
    rows,
    hasSponsorReport: rep.sponsors !== null,
    needsMigration: false,
  };
}
