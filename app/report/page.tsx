import { defaultWeekId, getCachedWeekOptions } from "@/lib/server-weeks";
import { distinctValues, mergeDistinct } from "@/lib/distinct";
import {
  detailLabelFor,
  fetchReportSections,
  fromToLabelsFor,
  latestImportedWeekId,
  type ReportRow,
  type ReportSectionKey,
} from "@/lib/report-view";
import ImportPanel from "@/components/ImportPanel";
import SectionCollapse from "@/components/SectionCollapse";
import ColumnFilter from "@/components/ColumnFilter";
import Link from "next/link";
import ReportExportButtons from "@/components/ReportExportButtons";
import ReportTabs from "@/components/ReportTabs";
import FilterBar from "@/components/FilterBar";

export const dynamic = "force-dynamic";

function Name({ value, bold }: { value: string; bold: boolean }) {
  return bold ? <strong>{value}</strong> : <>{value}</>;
}

type OptCol = { key: "insideOutside" | "tyfcb" | "ceu" | "detail"; label: string; numeric?: boolean };
const OPTIONAL_COLS: OptCol[] = [
  { key: "insideOutside", label: "Inside/Outside" },
  { key: "tyfcb", label: "TYFCB Amount", numeric: true },
  { key: "ceu", label: "CEU Credits" },
  { key: "detail", label: "Other Member's Chapter" },
];

/** Report-shaped table: No + From/To/Type always; other columns only when used. */
function SectionTable({
  rows,
  sectionKey,
  weekValue,
  totalAmount,
  colFilters,
  colOptions,
  weeks,
}: {
  rows: ReportRow[];
  sectionKey: ReportSectionKey;
  weekValue: string;
  totalAmount?: number | null;
  colFilters: { from: string; to: string; detail: string };
  colOptions: { from: string[]; to: string[]; detail: string[] };
  weeks: { id: string; label: string }[];
}) {
  const cols = OPTIONAL_COLS.filter((c) => rows.some((r) => r[c.key].trim() !== ""));
  const baseCount = 5; // No, BNI Week, From, To, Type
  const fromTo = fromToLabelsFor(sectionKey);
  // Sum column: TYFCB Amount for money sections, CEU Credits for the CEU section.
  const sumKey = cols.some((c) => c.key === "tyfcb")
    ? ("tyfcb" as const)
    : cols.some((c) => c.key === "ceu")
      ? ("ceu" as const)
      : null;
  const amtIdx = sumKey ? cols.findIndex((c) => c.key === sumKey) : -1;
  const headFilter = (key: "from" | "to" | "detail", label: string) => (
    <ColumnFilter
      paramKey={`cf_${sectionKey}_${key}`}
      defaultValue={colFilters[key]}
      options={colOptions[key]}
      label={label}
    />
  );
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>No.</th>
              <th>
                <ColumnFilter
                  paramKey={`w_${sectionKey}`}
                  defaultValue={weekValue}
                  options={[{ value: "all", label: "All weeks" }, ...weeks.map((w) => ({ value: w.id, label: w.label }))]}
                  label="BNI Week"
                  allLabel="Universal"
                />
              </th>
              <th>{headFilter("from", fromTo.from)}</th>
              <th>{headFilter("to", fromTo.to)}</th>
              <th>Slip Type</th>
              {cols.map((c) => (
                <th key={c.key}>
                  {c.key === "detail" ? (
                    headFilter("detail", detailLabelFor(sectionKey))
                  ) : (
                    <span className="th-label">{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.slipType}-${r.count}`}>
                <td>{r.count}</td>
                <td>{r.week}</td>
                <td><Name value={r.from} bold={r.fromBold} /></td>
                <td><Name value={r.to} bold={r.toBold} /></td>
                <td>{r.slipType}</td>
                {cols.map((c) => (
                  <td key={c.key} className={c.numeric ? "num" : undefined}>{r[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {totalAmount != null && rows.length > 0 ? (
            <tfoot>
              <tr className="sum-row">
                <td colSpan={baseCount + (amtIdx < 0 ? cols.length : amtIdx)}>
                  <strong>Total</strong>
                </td>
                {amtIdx >= 0 ? (
                  <td className="num">
                    <strong>{totalAmount.toLocaleString("en-IN")}</strong>
                  </td>
                ) : null}
                {cols.slice(amtIdx + 1).map((c) => (
                  <td key={c.key} />
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {rows.length === 0 ? <div className="empty-state">No rows in this section.</div> : null}
    </div>
  );
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const [weeks, latest, defaultId] = await Promise.all([
    getCachedWeekOptions(),
    latestImportedWeekId(),
    sp.week ? Promise.resolve(null) : defaultWeekId(),
  ]);
  const weekId = sp.week || defaultId || latest || weeks[0]?.id || "";
  const tab = (sp.tab as ReportSectionKey | "all" | undefined) || "all";
  const q = sp.q || "";
  const colFor = (key: ReportSectionKey) => ({
    from: sp[`cf_${key}_from`] || "",
    to: sp[`cf_${key}_to`] || "",
    detail: sp[`cf_${key}_detail`] || "",
  });
  const allWeeks = weekId === "all";
  const activeWeek = weeks.find((w) => w.id === weekId);

  const sectionsPromise = weekId
    ? fetchReportSections(weekId, q, {
        "one-to-one": colFor("one-to-one"),
        referral: colFor("referral"),
        tyfcb: colFor("tyfcb"),
        visitor: colFor("visitor"),
        ceu: colFor("ceu"),
      }, {
        "one-to-one": sp["w_one-to-one"] || "",
        referral: sp["w_referral"] || "",
        tyfcb: sp["w_tyfcb"] || "",
        visitor: sp["w_visitor"] || "",
        ceu: sp["w_ceu"] || "",
      })
    : Promise.resolve([]);
  const [sections, [fromOptions, toOptions, detailOptions]] = await Promise.all([
    sectionsPromise,
    Promise.all([
    Promise.all([
      distinctValues("slip_referrals", "from_name"),
      distinctValues("slip_one_to_ones", "initiated_by_name"),
      distinctValues("slip_visitors", "invited_by_name"),
      distinctValues("slip_ceus", "member_name"),
    ]).then((lists) => mergeDistinct(...lists)),
    Promise.all([
      distinctValues("slip_referrals", "to_name"),
      distinctValues("slip_one_to_ones", "met_with_name"),
      distinctValues("slip_tyfcb", "member_name"),
      distinctValues("slip_visitors", "full_name"),
    ]).then((lists) => mergeDistinct(...lists)),
    Promise.all([
      distinctValues("slip_referrals", "other_chapter_member"),
      distinctValues("slip_one_to_ones", "other_chapter_member"),
      distinctValues("slip_tyfcb", "other_chapter_member"),
    ]).then((lists) => mergeDistinct(...lists)),
    ]),
  ]);
  const colOptions = { from: fromOptions, to: toOptions, detail: detailOptions };
  const visible = tab === "all" ? sections : sections.filter((s) => s.key === tab);
  const total = sections.reduce((n, s) => n + s.metricCount, 0);
  const hasFilters =
    q.trim() !== "" ||
    ["one-to-one", "referral", "tyfcb", "visitor", "ceu"].some(
      (k) =>
        (sp[`w_${k}`] || "").trim() !== "" ||
        ["from", "to", "detail"].some((f) => (sp[`cf_${k}_${f}`] || "").trim() !== ""),
    );
  const clearHref = `/report?week=all&tab=all`;

  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            Week Report
            <span className="count-badge">{total} slip(s)</span>
          </h1>
          {allWeeks ? <p className="sub muted">All weeks</p> : activeWeek ? <p className="sub muted">{activeWeek.label}</p> : null}
        </div>
        <div className="report-head-actions">
          <ImportPanel variant="toolbar" defaultCollapsed />
          <ReportExportButtons
            weekId={weekId}
            tab={tab}
            scopeLabel={allWeeks ? "all-weeks" : (activeWeek?.label ?? "week")}
          />
        </div>
      </div>

      <div className="cards stat-cards">
        {sections.map((s) => (
          <div key={s.key} className="section-card" data-stat={s.key}>
            <div className="num">{s.metricCount}</div>
            <div className="label">{s.title}</div>
            <div className="go">{s.stat ?? s.totalLabel}</div>
          </div>
        ))}
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          <FilterBar
            basePath="/report"
            q=""
            weekId={weekId}
            weeks={weeks}
            searchPlaceholder=""
            hiddenParams={{ tab }}
            includeAllOption
            hideSearch
          />
          {hasFilters || !allWeeks ? (
            <span className="clear-right">
              <Link href={clearHref}>
                <button type="button">Clear all</button>
              </Link>
            </span>
          ) : null}
        </div>
      </div>

      <ReportTabs weekId={weekId} activeTab={tab} />

      {visible.map((s) => (
        <SectionCollapse
          key={s.key}
          kind={s.key}
          title={s.title}
          rowCount={s.rows.length}
          badge={
            <span className="count-badge">
              {s.metricCount} {s.totalLabel}
            </span>
          }
        >
          <SectionTable rows={s.rows} sectionKey={s.key} weekValue={(sp[`w_${s.key}`] || "").trim()} totalAmount={s.totalAmount} colFilters={colFor(s.key)} colOptions={colOptions} weeks={weeks} />
        </SectionCollapse>
      ))}
    </div>
  );
}
