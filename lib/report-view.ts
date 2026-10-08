import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paged";
import { createTtlCache, sharedState } from "@/lib/cache";

export type ReportSectionKey = "one-to-one" | "referral" | "tyfcb" | "visitor" | "ceu";

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
  /** Raw numeric total for the footer sum row (TYFCB/CEU only). */
  totalAmount: number | null;
  rows: ReportRow[];
  /**
   * Metric shown on stat cards/badges: rows.length everywhere except
   * One-to-One, where a bold (other-chapter) side counts 1 and a
   * both-home meeting counts 2 (owner rule).
   */
  metricCount: number;
  /** Override for the stat-card big number (referral: given count only). */
  cardCount: number | null;
  /** Extra line shown only on the stat card (badges/exports keep `stat`). */
  cardStat: string | null;
  /** Big stat-card figures (value + small unit), e.g. CEU: members + credits. */
  cardParts?: { value: number; unit: string }[] | null;
};

export const REPORT_HEADERS = [
  "No.",
  "From",
  "To",
  "Slip Type",
  "Inside/Outside",
  "TYFCB Amount",
  "CEU Credits",
  "Other Member's Chapter",
];

const tierLabel = (v: string | null): string =>
  v === "Inside" ? "Tier 1 (inside)" : v === "Outside" ? "Tier 2 (outside)" : "";

const money = (v: number | string | null): string =>
  v === null || v === undefined || v === ""
    ? ""
    : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Slip rows mapped into the Report's table shape. weekId "all" = every week,
 * or a comma-separated list of week ids for multi-meeting scope;
 * weekOverrides lets one table use its own scope ("all", a week id or a
 * comma-separated list); empty/missing falls back to the universal weekId.
 * Column filters are per-table: col[sectionKey] = { from, to, detail }. */
export type ReportColFilters = Partial<
  Record<ReportSectionKey, { from?: string; to?: string; detail?: string }>
>;

export async function fetchReportSections(
  tenantId: string,
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
  const ceuScope = scopeOf("ceu");

  const scopedFilters = (
    scope: string,
  ): { eq?: [string, string][]; in?: [string, string[]][] } => {
    // Every section query is tenant-scoped first; the week scope narrows it.
    const eq: [string, string][] = [["tenant_id", tenantId]];
    if (scope !== "all") {
      const ids = scope
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 1) return { eq, in: [["bni_week_id", ids]] };
      // Single id; an empty scope still matches nothing (as before).
      eq.push(["bni_week_id", ids[0] ?? ""]);
    }
    return { eq };
  };

  type R = Record<string, string | boolean | number | null | { label?: string } | { label?: string }[]>;
  const [oto, ref, tyfcb, vis, ceu] = await Promise.all([
    fetchAllRows<R>("slip_one_to_ones", "initiated_by_name,met_with_name,other_chapter_member,initiated_by_is_other_chapter,met_with_is_other_chapter,bni_weeks(label)", {
      ...scopedFilters(otoScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_referrals", "from_name,to_name,inside_outside,other_chapter_member,from_is_other_chapter,to_is_other_chapter,bni_weeks(label)", {
      ...scopedFilters(refScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_tyfcb", "member_name,amount,other_chapter_member,thanker_name,bni_weeks(label)", {
      ...scopedFilters(tyfcbScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_visitors", "full_name,invited_by_name,bni_weeks(label)", {
      ...scopedFilters(visScope),
      order: { column: "created_at" },
    }),
    fetchAllRows<R>("slip_ceus", "member_name,credits,bni_weeks(label)", {
      ...scopedFilters(ceuScope),
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

  const ceuRows: ReportRow[] = ceu.map((r, i) => ({
    count: i + 1,
    week: weekOf(r),
    from: String(r.member_name ?? ""),
    to: "",
    slipType: "CEU",
    insideOutside: "",
    tyfcb: "",
    ceu: String(r.credits ?? ""),
    detail: "",
    fromBold: false,
    toBold: false,
  }));

  // Optional text filter: global q matches From/To/Detail; per-table
  // column filters narrow only their own table. Counts re-number.
  const needle = q.trim().toLowerCase();
  // Multi-select cell filter: "a" keeps rows containing "a"; "a,b" keeps a
  // row matching ANY value (OR). Picks come from the distinct-value dropdown.
  const terms = (v: string | undefined): string[] =>
    (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const matchAny = (hay: string, list: string[]): boolean =>
    list.length === 0 || list.some((t) => hay.toLowerCase().includes(t));
  const applyFilter = (key: ReportSectionKey, rows: ReportRow[]): ReportRow[] => {
    const cf = {
      from: terms(col[key]?.from),
      to: terms(col[key]?.to),
      detail: terms(col[key]?.detail),
    };
    const kept = rows.filter((r) => {
      if (needle && !`${r.from} ${r.to} ${r.detail}`.toLowerCase().includes(needle)) return false;
      if (!matchAny(r.from, cf.from)) return false;
      if (!matchAny(r.to, cf.to)) return false;
      if (!matchAny(r.detail, cf.detail)) return false;
      return true;
    });
    return kept.map((r, i) => ({ ...r, count: i + 1 }));
  };

  const fOto = applyFilter("one-to-one", otoRows);
  const fRef = applyFilter("referral", refRows);
  const fTyfcb = applyFilter("tyfcb", tyfcbRows);
  const fVis = applyFilter("visitor", visRows);
  const fCeu = applyFilter("ceu", ceuRows);
  const fTyfcbSum = fTyfcb.reduce(
    (n, r) => n + (Number(r.tyfcb.replace(/[^0-9.]/g, "")) || 0),
    0,
  );
  const fCeuSum = fCeu.reduce((n, r) => n + (Number(r.ceu) || 0), 0);
  // Owner counting rule: a 121 with a bold (other-chapter) side is 1,
  // a meeting between two home members is 2.
  const otoMetric = fOto.reduce((n, r) => n + (r.fromBold || r.toBold ? 1 : 2), 0);

  const ceuStat = fCeu.length > 0 ? `${Math.round(fCeuSum).toLocaleString("en-IN")} CEU credits` : null;
  const ceuMembers = new Set(fCeu.map((r) => r.from.trim().toLowerCase()).filter(Boolean)).size;
  // PALMS referral split (confirmed against the PALMS totals row): "given" is
  // a row whose From side is home (not bold); RGI/RRI are Tier 1, RGO/RRO Tier 2.
  const tier1 = (r: ReportRow) => r.insideOutside === "Tier 1 (inside)";
  const refGiven = fRef.filter((r) => !r.fromBold);
  const rgi = refGiven.filter(tier1).length;
  const rgo = refGiven.length - rgi;
  const refReceived = fRef.filter((r) => !r.toBold);
  const rri = refReceived.filter(tier1).length;
  const rro = refReceived.length - rri;
  const refChips =
    fRef.length > 0 ? `RGI ${rgi} · RGO ${rgo} · RRI ${rri} · RRO ${rro}` : null;

  return [
    { key: "one-to-one", title: "One-to-One", totalLabel: "121s", stat: null, totalAmount: null, rows: fOto, metricCount: otoMetric, cardCount: null, cardStat: null },
    { key: "referral", title: "Referral", totalLabel: "Referrals", stat: null, totalAmount: null, rows: fRef, metricCount: fRef.length, cardCount: refGiven.length, cardStat: refChips },
    {
      key: "tyfcb",
      title: "TYFCB",
      totalLabel: "Slips",
      stat: fTyfcb.length > 0 ? `₹${Math.round(fTyfcbSum).toLocaleString("en-IN")} total` : null,
      totalAmount: fTyfcb.length > 0 ? Math.round(fTyfcbSum) : null,
      rows: fTyfcb,
      metricCount: fTyfcb.length,
      cardCount: null,
      cardStat: null,
    },
    { key: "visitor", title: "Visitor", totalLabel: "Visitors", stat: null, totalAmount: null, rows: fVis, metricCount: fVis.length, cardCount: null, cardStat: null },
    {
      key: "ceu",
      title: "CEU",
      totalLabel: "CEUs",
      stat: ceuStat,
      totalAmount: fCeu.length > 0 ? Math.round(fCeuSum) : null,
      rows: fCeu,
      metricCount: fCeu.length,
      cardCount: null,
      cardStat: ceuStat ? `${ceuMembers} ${ceuMembers === 1 ? "Member" : "Members"} · ${ceuStat}` : null,
      cardParts: fCeu.length > 0
        ? [
            { value: ceuMembers, unit: ceuMembers === 1 ? "Member" : "Members" },
            { value: Math.round(fCeuSum), unit: "CEU credits" },
          ]
        : null,
    },
  ];
}

/** Latest week this tenant actually imported (drives the default view). Null-week batches (multi-week PALMS files) never count. */
async function fetchLatestImportedWeekId(tenantId: string): Promise<string | null> {
  const sb = getSupabaseServer();
  const { data } = await sb
    .from("import_batches")
    .select("bni_week_id")
    .eq("tenant_id", tenantId)
    .not("bni_week_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { bni_week_id: string | null } | null)?.bni_week_id ?? null;
}

// Changes only on import: cache per process for 5 minutes, keyed by tenant.
const latestCache = sharedState(
  "reportView.latestWeekByTenant",
  () => new Map<string, ReturnType<typeof createTtlCache<string | null>>>(),
);

function latestCacheFor(tenantId: string): ReturnType<typeof createTtlCache<string | null>> {
  let c = latestCache.get(tenantId);
  if (!c) {
    c = createTtlCache<string | null>(5 * 60 * 1000);
    latestCache.set(tenantId, c);
  }
  return c;
}

export const latestImportedWeekId = (tenantId: string): Promise<string | null> =>
  latestCacheFor(tenantId).get(() => fetchLatestImportedWeekId(tenantId));

/** Drop the cached latest-week pointer (call on import). */
export const clearLatestImportedWeekCache = (): void => latestCache.clear();

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
  withWeek ? ["No.", "BNI Week", ...REPORT_HEADERS.slice(1)] : REPORT_HEADERS;

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
  { key: "count", label: "No." },
  { key: "week", label: "BNI Week" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "slipType", label: "Slip Type" },
  { key: "insideOutside", label: "Inside/Outside" },
  { key: "tyfcb", label: "TYFCB Amount", numeric: true },
  { key: "ceu", label: "CEU Credits" },
  { key: "detail", label: "Other Member's Chapter" },
];

/** Detail header: on TYFCB rows the Detail text is the thanking member's chapter. */
export const detailLabelFor = (key: ReportSectionKey): string =>
  key === "tyfcb" ? "Thanking Member's Chapter" : "Other Member's Chapter";

/** From/To header per section: each slip type names its two sides. */
export function fromToLabelsFor(key: ReportSectionKey): { from: string; to: string } {
  switch (key) {
    case "one-to-one":
      return { from: "Initiated By", to: "Met With" };
    case "referral":
      return { from: "Referral From", to: "Referral To" };
    case "tyfcb":
      return { from: "Thanker", to: "BNI Member" };
    case "visitor":
      return { from: "Invited By", to: "Visitor" };
    case "ceu":
      // CEU rows carry only the attendee (From); To stays empty.
      return { from: "BNI Member", to: "To" };
  }
}

const cellOf = (r: ReportRow, key: ReportColumnKey): string =>
  key === "count" ? String(r.count) : key === "week" ? r.week : r[key];

/**
 * Columns for export: Count + From/To/Type always (+ BNI Week in wide
 * scope); any other column only when at least one row fills it —
 * exactly what the screen shows.
 */
export function visibleColumns(
  rows: ReportRow[],
  withWeek: boolean,
  sectionKey?: ReportSectionKey,
): ReportColumn[] {
  return ALL_COLUMNS.filter((c) => {
    if (c.key === "week") return withWeek;
    if (["count", "from", "to", "slipType"].includes(c.key)) return true;
    return rows.some((r) => cellOf(r, c.key).trim() !== "");
  }).map((c) => {
    if (c.key === "detail" && sectionKey) return { ...c, label: detailLabelFor(sectionKey) };
    if ((c.key === "from" || c.key === "to") && sectionKey)
      return { ...c, label: fromToLabelsFor(sectionKey)[c.key] };
    return c;
  });
}

export function rowCells(r: ReportRow, cols: ReportColumn[]): string[] {
  return cols.map((c) => cellOf(r, c.key));
}

/** Total footer row for screens and exports ("Total" under From, sum under TYFCB/CEU). */
export function totalRowCells(cols: ReportColumn[], totalAmount: number): string[] {
  const amt = totalAmount.toLocaleString("en-IN");
  return cols.map((c) =>
    c.key === "from" ? "Total" : c.key === "tyfcb" ? `₹${amt}` : c.key === "ceu" ? amt : "",
  );
}
