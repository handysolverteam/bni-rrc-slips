import ColumnFilter from "@/components/ColumnFilter";
import MultiSelectToggle from "@/components/MultiSelectToggle";
import PalmsStatsShare from "@/components/PalmsStatsShare";
import { multiParts } from "@/lib/list-filters";
import { buildPalmsStatsShare } from "@/lib/palms-share";
import type { PalmsAttendanceStats, PalmsMatrix } from "@/lib/palms-view";

/**
 * The slow parts of the Attendance screen, as async server components. The page starts their queries WITHOUT awaiting them
 * and wraps each in <Suspense>, so the title, filters, export buttons and import panel are drawn at once and these stream
 * in when their data is ready.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** The matrix rows left after the Member column filter (names, several with the Multi-select checkbox). */
function visibleRows(matrix: PalmsMatrix, memberFilter: string) {
  const want = new Set(multiParts(memberFilter).map((n) => n.toLowerCase()));
  return want.size > 0 ? matrix.rows.filter((r) => want.has(r.name.toLowerCase())) : matrix.rows;
}

/** "N member(s)" badge of the page title. */
export async function PalmsMemberCount({ promise, memberFilter }: { promise: Promise<PalmsMatrix>; memberFilter: string }) {
  const matrix = await promise;
  return <span className="count-badge">{visibleRows(matrix, memberFilter).length} member(s)</span>;
}

/** The "Last 6 months: Active members" breakdown card (nothing when there is no attendance). */
export async function PalmsStatsCard({ promise }: { promise: Promise<PalmsAttendanceStats | null> }) {
  const stats = await promise;
  if (!stats || stats.total <= 0) return null;
  return (
    <div className="card">
      <div className="palms-stats-head">
        <div>
          <h2 className="palms-stats-title">Last 6 months ({stats.meetingCount} weeks): Active members</h2>
          <p className="sub muted">
            {dayLabel(stats.from)} – {dayLabel(stats.to)} · {stats.meetingCount} weeks
          </p>
        </div>
        <PalmsStatsShare text={buildPalmsStatsShare(dayLabel(stats.from), dayLabel(stats.to), stats.meetingCount, stats.groups)} />
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
  );
}

/** The attendance matrix itself (Member filter in its header). */
export async function PalmsMatrixSection({ promise, memberFilter }: { promise: Promise<PalmsMatrix>; memberFilter: string }) {
  const matrix = await promise;
  const memberRows = visibleRows(matrix, memberFilter);
  const colSpan = 2 + matrix.weeks.length;
  return (
    <>
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
    </>
  );
}
