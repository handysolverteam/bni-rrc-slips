import FilterBar from "@/components/FilterBar";
import NoAccess from "@/components/NoAccess";
import DataWarnings from "@/components/DataWarnings";
import PalmsComparisonTable from "@/components/PalmsComparisonTable";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import { requirePageTenant } from "@/lib/server-auth";
import { defaultWeekId, getCachedWeekOptions } from "@/lib/server-weeks";
import { latestImportedWeekId } from "@/lib/report-view";
import { fetchMissingMeetingFiles } from "@/lib/data-health";
import { fetchPalmsComparisons } from "@/lib/palms-compare";
import {
  fetchChapterSummary,
  type SummaryRow,
  type SummaryTotals,
} from "@/lib/summary-view";

export const dynamic = "force-dynamic";

type Col = {
  label: string;
  get: (r: SummaryRow) => number | null;
  total: (t: SummaryTotals) => number | null;
  money?: boolean;
};

/** Column order mirrors the PALMS Chapter Summary export (raw P/A/L/M/S letters). */
const COLS: Col[] = [
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

function cell(v: number | null, money?: boolean): string {
  if (v === null || v === undefined) return "\u2013";
  return money ? Math.round(v).toLocaleString("en-IN") : String(v);
}

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const tenantId = guard.tenantId;
  const sp = await searchParams;

  const [weeks, latest, defaultId] = await Promise.all([
    getCachedWeekOptions(tenantId),
    latestImportedWeekId(tenantId),
    sp.week ? Promise.resolve(null) : defaultWeekId(tenantId),
  ]);
  const weekId = sp.week || defaultId || latest || weeks[0]?.id || "";
  const allWeeks = weekId === "all";
  const weekIds = allWeeks
    ? []
    : weekId.split(",").map((s) => s.trim()).filter(Boolean);
  const activeWeeks = weekIds
    .map((id) => weeks.find((w) => w.id === id))
    .filter((w): w is (typeof weeks)[number] => w !== undefined);
  const weeksLabel =
    activeWeeks.length > 3
      ? `${activeWeeks.length} meetings`
      : activeWeeks.map((w) => w.label).join(" + ");

  const [summary, missing, comparisons] = await Promise.all([
    fetchChapterSummary(tenantId, weekIds),
    fetchMissingMeetingFiles(tenantId),
    fetchPalmsComparisons(tenantId, weekIds),
  ]);
  const colSpan = 1 + COLS.length;

  return (
    <div>
      <div className="page-head">
        <h1>
          Chapter Summary
          <span className="count-badge">{summary.rows.length} member(s)</span>
        </h1>
        <p className="sub muted">
          {allWeeks ? "All weeks" : weeksLabel || "No week selected"}
        </p>
      </div>

      <DataWarnings missing={missing} comparisons={comparisons} />

      <PalmsImportPanel />

      <div className="card report-controls">
        <div className="report-controls-row">
          <FilterBar
            basePath="/summary"
            q=""
            weekId={weekId}
            weeks={weeks}
            searchPlaceholder=""
            hideSearch
            includeAllOption
            multiSelect
          />
        </div>
      </div>

      <div className="card">
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Member</th>
                  {COLS.map((c) => (
                    <th key={c.label}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.rows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="muted">
                      No rows in this scope.
                    </td>
                  </tr>
                ) : (
                  summary.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      {COLS.map((c) => (
                        <td key={c.label}>{cell(c.get(r), c.money)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {summary.rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.label}>
                        <strong>{cell(c.total(summary.totals), c.money)}</strong>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
        {!summary.hasAttendance ? (
          <p className="muted">
            No PALMS attendance imported for this scope — upload the Chapter
            Summary PALMS Report on the Import screen.
          </p>
        ) : null}
      </div>

      {comparisons.length > 0 ? (
        <div className="card">
          <PalmsComparisonTable comparisons={comparisons} />
        </div>
      ) : null}
    </div>
  );
}
