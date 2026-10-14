import CollapseCard from "@/components/CollapseCard";
import ColumnFilter from "@/components/ColumnFilter";
import MultiSelectToggle from "@/components/MultiSelectToggle";
import { multiParts } from "@/lib/list-filters";
import FilterBar from "@/components/FilterBar";
import NoAccess from "@/components/NoAccess";
import PalmsExportButtons from "@/components/PalmsExportButtons";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import PalmsStatsShare from "@/components/PalmsStatsShare";
import { buildPalmsStatsShare } from "@/lib/palms-share";
import { expandWeekToken, LAST6_TOKEN } from "@/lib/weeks";
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

  const weeks = await fetchPalmsWeekOptions(tenantId);
  // "last6m" = the standard last 6 months (the same entry in every week dropdown): the box keeps the token, queries and
  // exports get the real week ids.
  const last6 = (sp.week ?? "").split(",").map((x) => x.trim()).includes(LAST6_TOKEN);
  const weekIds = palmsWeekScope(expandWeekToken(sp.week, weeks)); // default scope = every week with attendance
  const allWeeks = weekIds.length === 0 && !last6;
  const weekId = last6 ? LAST6_TOKEN : allWeeks ? "all" : weekIds.join(",");
  const exportWeek = allWeeks ? "all" : weekIds.join(",");

  const [matrix, record, stats] = await Promise.all([
    fetchPalmsMatrix(tenantId, weekIds),
    fetchPalmsImportRecord(tenantId),
    fetchPalmsAttendanceStats(tenantId),
  ]);
  const scopeLabel = palmsScopeLabel(weeks, weekIds, "All weeks");
  // Member column filter (dropdown; several names with the Multi-select checkbox): narrows the matrix rows.
  const memberFilter = (sp.c_member ?? "").trim();
  const wantMembers = new Set(multiParts(memberFilter).map((n) => n.toLowerCase()));
  const memberRows = wantMembers.size > 0 ? matrix.rows.filter((r) => wantMembers.has(r.name.toLowerCase())) : matrix.rows;
  const colSpan = 2 + matrix.weeks.length;

  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            Attendance
            <span className="count-badge">{memberRows.length} member(s)</span>
          </h1>
          <p className="sub muted">{scopeLabel}</p>
        </div>
        <div className="report-head-actions">
          <PalmsExportButtons weekId={exportWeek} scopeLabel={allWeeks ? "All weeks" : scopeLabel || "palms"} />
        </div>
      </div>

      <PalmsImportPanel hasData={matrix.hasAttendance} record={record} />

      {stats && stats.total > 0 ? (
        <div className="card">
          <div className="palms-stats-head">
            <div>
              <h2 className="palms-stats-title">Last 6 months ({stats.meetingCount} weeks): Active members</h2>
              <p className="sub muted">
                {dayLabel(stats.from)} – {dayLabel(stats.to)} · {stats.meetingCount} weeks
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

      <CollapseCard label={`Attendance matrix · ${memberRows.length} member(s)`}>
        <MultiSelectToggle />
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th className="idx">Sr. No.</th>
                  <th>
                    <ColumnFilter
                      paramKey="c_member"
                      defaultValue={memberFilter}
                      options={matrix.rows.map((r) => r.name).sort((a, b) => a.localeCompare(b))}
                      label="Member"
                    />
                  </th>
                  {matrix.weeks.map((w) => (
                    <th key={w.id} title={w.label} className="plm-h">
                      {w.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memberRows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="muted">
                      {matrix.rows.length > 0 ? "No member matches this filter." : "No PALMS attendance imported yet — upload a file above."}
                    </td>
                  </tr>
                ) : (
                  memberRows.map((r, ri) => (
                    <tr key={r.name}>
                      <td className="idx">{ri + 1}</td>
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
