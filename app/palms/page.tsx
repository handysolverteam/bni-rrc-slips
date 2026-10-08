import CollapseCard from "@/components/CollapseCard";
import FilterBar from "@/components/FilterBar";
import NoAccess from "@/components/NoAccess";
import PalmsExportButtons from "@/components/PalmsExportButtons";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import PalmsStatsShare from "@/components/PalmsStatsShare";
import { buildPalmsStatsShare } from "@/lib/palms-share";
import { requirePageTenant } from "@/lib/server-auth";
import {
  fetchPalmsAttendanceStats,
  fetchPalmsImportRecord,
  fetchPalmsMatrix,
  fetchPalmsWeekOptions,
  palmsScopeLabel,
  palmsWeekScope,
} from "@/lib/palms-view";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

export default async function PalmsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const tenantId = guard.tenantId;
  const sp = await searchParams;

  const weekIds = palmsWeekScope(sp.week); // default scope = every week with attendance
  const allWeeks = weekIds.length === 0;
  const weekId = allWeeks ? "all" : weekIds.join(",");

  const [weeks, matrix, record, stats] = await Promise.all([
    fetchPalmsWeekOptions(tenantId),
    fetchPalmsMatrix(tenantId, weekIds),
    fetchPalmsImportRecord(tenantId),
    fetchPalmsAttendanceStats(tenantId),
  ]);
  const scopeLabel = palmsScopeLabel(weeks, weekIds, "All weeks");
  const colSpan = 1 + matrix.weeks.length;

  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            PALMS Report
            <span className="count-badge">{matrix.rows.length} member(s)</span>
          </h1>
          <p className="sub muted">{scopeLabel}</p>
        </div>
        <div className="report-head-actions">
          <PalmsExportButtons weekId={weekId} scopeLabel={allWeeks ? "All weeks" : scopeLabel || "palms"} />
        </div>
      </div>

      <PalmsImportPanel hasData={matrix.hasAttendance} record={record} />

      {stats && stats.total > 0 ? (
        <div className="card">
          <div className="palms-stats-head">
            <div>
              <h2 className="palms-stats-title">Last 6 Months rolling period (26 weeks): Active members</h2>
              <p className="sub muted">
                {dayLabel(stats.from)} – {dayLabel(stats.to)} · {stats.meetingCount} meeting(s)
              </p>
            </div>
            <PalmsStatsShare
              text={buildPalmsStatsShare(dayLabel(stats.from), dayLabel(stats.to), stats.meetingCount, stats.groups)}
            />
          </div>
          <div className="palms-stats-groups">
            {stats.groups.map((g) => (
              <div className="palms-stats-group" key={g.key}>
                {g.buckets.map((b) => (
                  <div className="palms-stats-bucket" key={b.label}>
                    <div className="palms-stats-bucket-head">
                      <span>{b.label}</span>
                      <span className="count-badge">{b.count}</span>
                    </div>
                    {b.count > 0 ? <div className="palms-stats-names">{b.names.join(", ")}</div> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card report-controls">
        <div className="report-controls-row">
          <FilterBar
            basePath="/palms"
            q=""
            weekId={weekId}
            weeks={weeks}
            searchPlaceholder=""
            hideSearch
            includeAllOption
          />
          <span className="muted">
            P Present · A Absent · M Medical · S Substitute · L Leave
          </span>
        </div>
      </div>

      <CollapseCard label={`Attendance matrix · ${matrix.rows.length} member(s)`}>
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Member</th>
                  {matrix.weeks.map((w) => (
                    <th key={w.id} title={w.label}>
                      {w.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="muted">
                      No PALMS attendance imported yet — upload a file above.
                    </td>
                  </tr>
                ) : (
                  matrix.rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      {r.cells.map((cell, i) => (
                        <td key={matrix.weeks[i]?.id ?? i} className={cell ? `plm plm-${cell[0].toLowerCase()}` : undefined}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CollapseCard>
    </div>
  );
}
