import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";

export type ReportSectionKey = "one-to-one" | "referral" | "tyfcb" | "visitor";

export type ReportRow = {
  count: number;
  week: string;
  from: string;
  to: string;
  slipType: string;
  insideOutside: string;
  tyfcb: string;
  ceu: string;
  detail: string;
  fromBold: boolean;
  toBold: boolean;
};

export type SectionData = {
  key: ReportSectionKey;
  title: string;
  totalLabel: string;
  /** Extra summary line, e.g. total TYFCB amount. */
  stat: string | null;
  /** Raw numeric total for the footer sum row (TYFCB only). */
  totalAmount: number | null;
  rows: ReportRow[];
};

export const REPORT_HEADERS = [
  "Count",
  "From",
  "To",
  "Slip Type",
  "Inside/Outside",
  "TYFCB Amount",
  "CEU Credits",
  "Detail",
];

const tierLabel = (v: string | null): string =>
  v === "Inside" ? "Tier 1 (inside)" : v === "Outside" ? "Tier 2 (outside)" : "";

const money = (v: number | string | null): string =>
  v === null || v === undefined || v === ""
    ? ""
    : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Slip rows mapped into the Report's table shape. weekId "all" = every week.
 * weekOverrides lets one table use its own scope ("all" or a week id);
 * empty/missing falls back to the universal weekId.
 * Column filters are per-table: col[sectionKey] = { from, to, detail }. */
export type ReportColFilters = Partial<
  Record<ReportSectionKey, { from?: string; to?: string; detail?: string }>
>;

export async function fetchReportSections(
  weekId: string,
  q = "",
  col: ReportColFilters = {},
  weekOverrides: Partial<Record<ReportSectionKey, string>> = {},
): Promise<SectionData[]> {
  const scopeOf = (key: ReportSectionKey): string => {
    const ov = (weekOverrides[key] || "").trim();
    return ov || weekId;
  };
  const otoScope = scopeOf("one-to-one");
  const refScope = scopeOf("referral");
  const tyfcbScope = scopeOf("tyfcb");
  const visScope = scopeOf("visitor");

  const scopedEq = (scope: string): [string, string][] =>
    scope === "all" ? [] : [["bni_week_id", scope]];

  type R = Record<string, string | boolean | number | null | { label?: string } | { label?: string }[]>;
  const [oto, ref, tyfcb, vis] = await Promise.all([
    fetchAllRows<R>("slip_one_to_ones", "initiated_by_name,met_with_name,other_chapter_member,initiated_by_is_other_chapter,met_with_is_other_chapter,bni_weeks(label)", {
      eq: scopedEq(otoScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_referrals", "from_name,to_name,inside_outside,other_chapter_member,from_is_other_chapter,to_is_other_chapter,bni_weeks(label)", {
      eq: scopedEq(refScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_tyfcb", "member_name,amount,other_chapter_member,thanker_name,bni_weeks(label)", {
      eq: scopedEq(tyfcbScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_visitors", "full_name,invited_by_name,bni_weeks(label)", {
      eq: scopedEq(visScope),
      order: { column: "created_at" },
    }),
  ]);
  const weekOf = (r: R): string => {
    const j = r.bni_weeks as { label?: string } | { label?: string }[] | null | undefined;
    const label = Array.isArray(j) ? j[0]?.label : j?.label;
    return typeof label === "string" ? label : "";
  };

  const otoRows: ReportRow[] = oto.map((r, i) => ({
    count: i + 1,
    week: weekOf(r),
    from: String(r.initiated_by_name ?? ""),
    to: String(r.met_with_name ?? ""),
    slipType: "One-to-One",
    insideOutside: "",
    tyfcb: "",
    ceu: "",
    detail: String(r.other_chapter_member ?? ""),
    fromBold: r.initiated_by_is_other_chapter === true,
    toBold: r.met_with_is_other_chapter === true,
  }));

  const refRows: ReportRow[] = ref.map((r, i) => ({
    count: i + 1,
    week: weekOf(r),
    from: String(r.from_name ?? ""),
    to: String(r.to_name ?? ""),
    slipType: "Referral",
    insideOutside: tierLabel(typeof r.inside_outside === "string" ? r.inside_outside : null),
    tyfcb: "",
    ceu: "",
    detail: String(r.other_chapter_member ?? ""),
    fromBold: r.from_is_other_chapter === true,
    toBold: r.to_is_other_chapter === true,
  }));

  const tyfcbRaw = tyfcb;
  const tyfcbRows: ReportRow[] = tyfcbRaw.map((r, i) => {
    return {
      count: i + 1,
      week: weekOf(r),
      from: String(r.thanker_name ?? ""),
      to: String(r.member_name ?? ""),
      slipType: "TYFCB",
      insideOutside: "",
      tyfcb: money(typeof r.amount === "number" || typeof r.amount === "string" ? r.amount : null),
      ceu: "",
      detail: String(r.other_chapter_member ?? ""),
      fromBold: false,
      toBold: false,
    };
  });

  const visRows: ReportRow[] = vis.map((r, i) => ({
    count: i + 1,
    week: weekOf(r),
    from: String(r.invited_by_name ?? ""),
    to: String(r.full_name ?? ""),
    slipType: "Visitor",
    insideOutside: "",
    tyfcb: "",
    ceu: "",
    detail: "",
    fromBold: false,
    toBold: false,
  }));

  // Optional text filter: global q matches From/To/Detail; per-table
  // column filters narrow only their own table. Counts re-number.
  const needle = q.trim().toLowerCase();
  const clean = (v: string | undefined): string => (v ?? "").trim().toLowerCase();
  const applyFilter = (key: ReportSectionKey, rows: ReportRow[]): ReportRow[] => {
    const cf = {
      from: clean(col[key]?.from),
      to: clean(col[key]?.to),
      detail: clean(col[key]?.detail),
    };
    const kept = rows.filter((r) => {
      if (needle && !`${r.from} ${r.to} ${r.detail}`.toLowerCase().includes(needle)) return false;
      if (cf.from && !r.from.toLowerCase().includes(cf.from)) return false;
      if (cf.to && !r.to.toLowerCase().includes(cf.to)) return false;
      if (cf.detail && !r.detail.toLowerCase().includes(cf.detail)) return false;
      return true;
    });
    return kept.map((r, i) => ({ ...r, count: i + 1 }));
  };

  const fOto = applyFilter("one-to-one", otoRows);
  const fRef = applyFilter("referral", refRows);
  const fTyfcb = applyFilter("tyfcb", tyfcbRows);
  const fVis = applyFilter("visitor", visRows);
  const fTyfcbSum = fTyfcb.reduce(
    (n, r) => n + (Number(r.tyfcb.replace(/[^0-9.]/g, "")) || 0),
    0,
  );

  return [
    { key: "one-to-one", title: "One-to-One", totalLabel: "121s", stat: null, totalAmount: null, rows: fOto },
    { key: "referral", title: "Referral", totalLabel: "Referrals", stat: null, totalAmount: null, rows: fRef },
    {
      key: "tyfcb",
      title: "TYFCB",
      totalLabel: "Slips",
      stat: fTyfcb.length > 0 ? `${Math.round(fTyfcbSum).toLocaleString("en-IN")} total` : null,
      totalAmount: fTyfcb.length > 0 ? Math.round(fTyfcbSum) : null,
      rows: fTyfcb,
    },
    { key: "visitor", title: "Visitor", totalLabel: "Visitors", stat: null, totalAmount: null, rows: fVis },
  ];
}

/** Latest week that actually has imported slips (drives the default view). */
export async function latestImportedWeekId(): Promise<string | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("import_batches")
    .select("bni_week_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { bni_week_id: string | null } | null)?.bni_week_id ?? null;
}

export const rowToArray = (r: ReportRow, withWeek = false): (string | number)[] => {
  const rest: (string | number)[] = [
    r.from,
    r.to,
    r.slipType,
    r.insideOutside,
    r.tyfcb,
    r.ceu,
    r.detail,
  ];
  return withWeek ? [r.count, r.week, ...rest] : [r.count, ...rest];
};

export const reportHeaders = (withWeek = false): string[] =>
  withWeek ? ["Count", "BNI Week", ...REPORT_HEADERS.slice(1)] : REPORT_HEADERS;

export type ReportColumnKey =
  | "count"
  | "week"
  | "from"
  | "to"
  | "slipType"
  | "insideOutside"
  | "tyfcb"
  | "ceu"
  | "detail";

export type ReportColumn = { key: ReportColumnKey; label: string; numeric?: boolean };

const ALL_COLUMNS: ReportColumn[] = [
  { key: "count", label: "Count" },
  { key: "week", label: "BNI Week" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "slipType", label: "Slip Type" },
  { key: "insideOutside", label: "Inside/Outside" },
  { key: "tyfcb", label: "TYFCB Amount", numeric: true },
  { key: "ceu", label: "CEU Credits" },
  { key: "detail", label: "Detail" },
];

const cellOf = (r: ReportRow, key: ReportColumnKey): string =>
  key === "count" ? String(r.count) : key === "week" ? r.week : r[key];

/**
 * Columns for export: Count + From/To/Type always (+ BNI Week in wide
 * scope); any other column only when at least one row fills it —
 * exactly what the screen shows.
 */
export function visibleColumns(rows: ReportRow[], withWeek: boolean): ReportColumn[] {
  return ALL_COLUMNS.filter((c) => {
    if (c.key === "week") return withWeek;
    if (["count", "from", "to", "slipType"].includes(c.key)) return true;
    return rows.some((r) => cellOf(r, c.key).trim() !== "");
  });
}

export function rowCells(r: ReportRow, cols: ReportColumn[]): string[] {
  return cols.map((c) => cellOf(r, c.key));
}

/** Screen-style Total footer row for exports ("Total" under From, sum under TYFCB Amount). */
export function totalRowCells(cols: ReportColumn[], totalAmount: number): string[] {
  const amt = totalAmount.toLocaleString("en-IN");
  return cols.map((c) => (c.key === "from" ? "Total" : c.key === "tyfcb" ? amt : ""));
}
