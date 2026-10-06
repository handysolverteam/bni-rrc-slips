import { fetchAllRows } from "@/lib/supabase/paged";
import { getSupabaseServer } from "@/lib/supabase/server";

export type SummaryRow = {
  /** Display name — PALMS "First Last" when attendance exists, else the slip name. */
  name: string;
  /** Attendance columns from `member_attendance` (null = no PALMS row in scope). */
  present: number | null;
  absent: number | null;
  l: number | null;
  m: number | null;
  s: number | null;
  t: number | null;
  /** Slip-derived (home side only), same rules as the report cards. */
  rgi: number;
  rgo: number;
  rri: number;
  rro: number;
  visitors: number;
  oneToOnes: number;
  tyfcb: number;
  ceu: number;
};

export type SummaryTotals = {
  present: number | null;
  absent: number | null;
  l: number | null;
  m: number | null;
  s: number | null;
  t: number | null;
  rgi: number;
  rgo: number;
  rri: number;
  rro: number;
  visitors: number;
  oneToOnes: number;
  tyfcb: number;
  ceu: number;
};

export type ChapterSummary = {
  rows: SummaryRow[];
  totals: SummaryTotals;
  /** True when at least one row in scope has PALMS attendance. */
  hasAttendance: boolean;
};

export type SummaryCol = {
  label: string;
  get: (r: SummaryRow) => number | null;
  total: (t: SummaryTotals) => number | null;
  money?: boolean;
};

/** Column order mirrors the PALMS Chapter Summary export (raw P/A/L/M/S letters). Shared by the screen and the export. */
export const SUMMARY_COLS: SummaryCol[] = [
  { label: "P", get: (r) => r.present, total: (t) => t.present },
  { label: "A", get: (r) => r.absent, total: (t) => t.absent },
  { label: "L", get: (r) => r.l, total: (t) => t.l },
  { label: "M", get: (r) => r.m, total: (t) => t.m },
  { label: "S", get: (r) => r.s, total: (t) => t.s },
  { label: "RGI", get: (r) => r.rgi, total: (t) => t.rgi },
  { label: "RGO", get: (r) => r.rgo, total: (t) => t.rgo },
  { label: "RRI", get: (r) => r.rri, total: (t) => t.rri },
  { label: "RRO", get: (r) => r.rro, total: (t) => t.rro },
  { label: "V", get: (r) => r.visitors, total: (t) => t.visitors },
  { label: "1-2-1", get: (r) => r.oneToOnes, total: (t) => t.oneToOnes },
  { label: "TYFCB", get: (r) => r.tyfcb, total: (t) => t.tyfcb, money: true },
  { label: "CEU", get: (r) => r.ceu, total: (t) => t.ceu },
  { label: "T", get: (r) => r.t, total: (t) => t.t },
];

/** Display value for a cell — screen and every export format use this. */
export function summaryCell(v: number | null, money?: boolean): string {
  if (v === null || v === undefined) return "\u2013";
  return money ? Math.round(v).toLocaleString("en-IN") : String(v);
}

type AttendanceRow = {
  member_name: string;
  present: number | null;
  absent: number | null;
  l: number | null;
  m: number | null;
  s: number | null;
  t: number | null;
};
type RefRow = {
  from_name: string;
  to_name: string;
  inside_outside: string | null;
  from_is_other_chapter: boolean | null;
  to_is_other_chapter: boolean | null;
};
type OtoRow = {
  initiated_by_name: string;
  met_with_name: string;
  initiated_by_is_other_chapter: boolean | null;
  met_with_is_other_chapter: boolean | null;
};

const nameKey = (n: string): string => n.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Member-wise Chapter Summary for the given scope.
 *
 * - `weekIds`: the selected meetings ([] = all weeks), same scope syntax as
 *   the report page.
 * - Attendance (P A L M S T) comes from `member_attendance` (PALMS import);
 *   a member without an attendance row shows null ("–").
 * - Slip columns are computed live with the report's rules so the Total row
 *   always agrees with the stat cards: referral given/received = home side
 *   (bold flags) split by Tier 1/2; 1-2-1 = owner count (each non-bold
 *   participant counts 1 per meeting); V = invited-by; TYFCB/CEU = sums by
 *   member name.
 * - Row set = attendance roster ∪ home-side slip participants, so bold
 *   (other-chapter) counterparties never become member rows.
 */
export async function fetchChapterSummary(
  tenantId: string,
  weekIds: string[],
): Promise<ChapterSummary> {
  const opts = {
    eq: [["tenant_id", tenantId]] as [string, unknown][],
    in: weekIds.length > 0 ? ([["bni_week_id", weekIds]] as [string, string[]][]) : [],
    pageSize: 1000,
  };
  const [attendance, refs, otos, visitors, tyfcbs, ceus] = await Promise.all([
    fetchAllRows<AttendanceRow>("member_attendance", "member_name,present,absent,l,m,s,t", opts),
    fetchAllRows<RefRow>("slip_referrals", "from_name,to_name,inside_outside,from_is_other_chapter,to_is_other_chapter", opts),
    fetchAllRows<OtoRow>("slip_one_to_ones", "initiated_by_name,met_with_name,initiated_by_is_other_chapter,met_with_is_other_chapter", opts),
    fetchAllRows<{ invited_by_name: string | null }>("slip_visitors", "invited_by_name", opts),
    fetchAllRows<{ member_name: string; amount: number | string }>("slip_tyfcb", "member_name,amount", opts),
    fetchAllRows<{ member_name: string; credits: number | string }>("slip_ceus", "member_name,credits", opts),
  ]);

  const map = new Map<string, SummaryRow>();
  const ensure = (raw: string): SummaryRow | null => {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) return null;
    const k = nameKey(name);
    let row = map.get(k);
    if (!row) {
      row = {
        name,
        present: null,
        absent: null,
        l: null,
        m: null,
        s: null,
        t: null,
        rgi: 0,
        rgo: 0,
        rri: 0,
        rro: 0,
        visitors: 0,
        oneToOnes: 0,
        tyfcb: 0,
        ceu: 0,
      };
      map.set(k, row);
    }
    return row;
  };

  // Attendance first: its "First Last" formatting wins for display.
  for (const a of attendance) {
    const row = ensure(a.member_name);
    if (!row) continue;
    row.present = a.present ?? 0;
    row.absent = a.absent ?? 0;
    row.l = a.l ?? 0;
    row.m = a.m ?? 0;
    row.s = a.s ?? 0;
    row.t = a.t ?? 0;
  }

  const tier1 = (r: RefRow) => r.inside_outside === "Inside";
  for (const r of refs) {
    if (!r.from_is_other_chapter) {
      const row = ensure(r.from_name);
      if (row) (tier1(r) ? row.rgi++ : row.rgo++);
    }
    if (!r.to_is_other_chapter) {
      const row = ensure(r.to_name);
      if (row) (tier1(r) ? row.rri++ : row.rro++);
    }
  }

  // Owner rule: every non-bold participant counts this meeting once.
  for (const r of otos) {
    if (!r.initiated_by_is_other_chapter) {
      const row = ensure(r.initiated_by_name);
      if (row) row.oneToOnes++;
    }
    if (!r.met_with_is_other_chapter) {
      const row = ensure(r.met_with_name);
      if (row) row.oneToOnes++;
    }
  }

  for (const r of visitors) {
    const row = r.invited_by_name ? ensure(r.invited_by_name) : null;
    if (row) row.visitors++;
  }
  for (const r of tyfcbs) {
    const row = ensure(r.member_name);
    if (row) row.tyfcb += Number(r.amount) || 0;
  }
  for (const r of ceus) {
    const row = ensure(r.member_name);
    if (row) row.ceu += Number(r.credits) || 0;
  }

  const rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  const hasAttendance = rows.some((r) => r.present !== null);
  const sum = (get: (r: SummaryRow) => number): number =>
    rows.reduce((n, r) => n + get(r), 0);
  const attSum = (get: (r: SummaryRow) => number | null): number | null =>
    hasAttendance ? rows.reduce((n, r) => n + (get(r) ?? 0), 0) : null;

  return {
    rows,
    totals: {
      present: attSum((r) => r.present),
      absent: attSum((r) => r.absent),
      l: attSum((r) => r.l),
      m: attSum((r) => r.m),
      s: attSum((r) => r.s),
      t: attSum((r) => r.t),
      rgi: sum((r) => r.rgi),
      rgo: sum((r) => r.rgo),
      rri: sum((r) => r.rri),
      rro: sum((r) => r.rro),
      visitors: sum((r) => r.visitors),
      oneToOnes: sum((r) => r.oneToOnes),
      tyfcb: sum((r) => r.tyfcb),
      ceu: sum((r) => r.ceu),
    },
    hasAttendance,
  };
}

/**
 * The import behind a week's PALMS attendance: batch filename + date, shown
 * in the summary screen's panel ("Imported …"). Null when the week has no
 * attendance or its batch row was already deleted.
 */
export async function fetchPalmsImportRecord(
  tenantId: string,
  weekId: string,
): Promise<{ filename: string; importedAt: string } | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("member_attendance")
    .select("import_batch_id, import_batches(filename, created_at)")
    .eq("tenant_id", tenantId)
    .eq("bni_week_id", weekId)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const embedded = (data as { import_batches?: { filename?: string; created_at?: string } | null })
    .import_batches;
  if (!embedded?.filename) return null;
  return { filename: embedded.filename, importedAt: embedded.created_at ?? "" };
}
