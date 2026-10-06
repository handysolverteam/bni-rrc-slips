import FilterBar from "@/components/FilterBar";
import NoAccess from "@/components/NoAccess";
import DataWarnings from "@/components/DataWarnings";
import PalmsComparisonTable from "@/components/PalmsComparisonTable";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import SummaryExportButtons from "@/components/SummaryExportButtons";
import { requirePageTenant } from "@/lib/server-auth";
import { defaultWeekId, getCachedWeekOptions } from "@/lib/server-weeks";
import { latestImportedWeekId } from "@/lib/report-view";
import { fetchMissingMeetingFiles, fetchUnimportedData } from "@/lib/data-health";
import { fetchPalmsComparisons } from "@/lib/palms-compare";
import {
  fetchChapterSummary,
  fetchPalmsImportRecord,
  SUMMARY_COLS as COLS,
  summaryCell as cell,
} from "@/lib/summary-view";

export const dynamic = "force-dynamic";

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

  const [summary, missing, comparisons, unimported] = await Promise.all([
    fetchChapterSummary(tenantId, weekIds),
    fetchMissingMeetingFiles(tenantId),
    fetchPalmsComparisons(tenantId, weekIds),
    fetchUnimportedData(tenantId, weekIds),
  ]);
  const colSpan = 1 + COLS.length;
  // Single-week scope with attendance → the panel can show the imported file
  // and offer "Remove PALMS summary" for exactly that week.
  const singleWeek = weekIds.length === 1 ? weekIds[0] : null;
  const palmsRecord =
    singleWeek && summary.hasAttendance ? await fetchPalmsImportRecord(tenantId, singleWeek) : null;

  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            Chapter Summary
            <span className="count-badge">{summary.rows.length} member(s)</span>
          </h1>
          <p className="sub muted">
            {allWeeks ? "All weeks" : weeksLabel || "No week selected"}
          </p>
        </div>
        <div className="report-head-actions">
          <SummaryExportButtons
            weekId={weekId}
            scopeLabel={allWeeks ? "All weeks" : weeksLabel || "chapter-summary"}
          />
        </div>
      </div>

        <DataWarnings missing={missing} comparisons={comparisons} unimported={unimported} />

      <PalmsImportPanel
        removeWeekId={singleWeek && summary.hasAttendance ? singleWeek : null}
        record={palmsRecord}
      />

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
      </div>

      {comparisons.length > 0 ? (
        <div className="card">
          <PalmsComparisonTable comparisons={comparisons} />
        </div>
      ) : null}
    </div>
  );
}
