import ColumnFilter from "@/components/ColumnFilter";
import DateRangeFilter from "@/components/DateRangeFilter";
import FilterBar from "@/components/FilterBar";
import MultiSelectToggle from "@/components/MultiSelectToggle";
import PalmsExportButtons from "@/components/PalmsExportButtons";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import PalmsStatsShare from "@/components/PalmsStatsShare";
import { multiParts } from "@/lib/list-filters";
import { buildPalmsStatsShare } from "@/lib/palms-share";
import { palmsScopeLabel, palmsWeekScope, type PalmsAttendanceStats, type PalmsMatrix } from "@/lib/palms-view";
import { expandWeekToken, findRangeToken, LAST6_TOKEN, parseRangeToken, rangeTitle, weekBounds, type WeekOption } from "@/lib/weeks";

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

/** What the `?week=` value stands for, resolved against the weeks that have attendance. */
export type PalmsScope = {
  weeks: WeekOption[];
  /** Real week ids ([] = every week). */
  weekIds: string[];
  /** What the week dropdown shows ("all", "last6m", a range token or the ids). */
  weekId: string;
  /** What the export gets ("all" or the ids). */
  exportWeek: string;
  allWeeks: boolean;
  scopeLabel: string;
  bounds: { min: string; max: string };
};

export function resolvePalmsScope(weekParam: string | undefined, weeks: WeekOption[]): PalmsScope {
  // "last6m" = the standard last 6 months (the same entry in every week dropdown): the box keeps the token, queries and
  // exports get the real week ids.
  const last6 = (weekParam ?? "").split(",").map((x) => x.trim()).includes(LAST6_TOKEN);
  const weekIds = palmsWeekScope(expandWeekToken(weekParam, weeks)); // default scope = every week with attendance
  const rangeTok = findRangeToken(weekParam); // a From / To date range (expanded to the weeks inside it above)
  const allWeeks = weekIds.length === 0 && !last6;
  const dateRange = parseRangeToken(rangeTok);
  const inRange = dateRange ? weekIds.filter((id) => weeks.some((w) => w.id === id)).length : 0;
  return {
    weeks,
    weekIds,
    weekId: last6 ? LAST6_TOKEN : rangeTok ? rangeTok : allWeeks ? "all" : weekIds.join(","),
    exportWeek: allWeeks ? "all" : weekIds.join(","),
    allWeeks,
    scopeLabel: dateRange ? `${rangeTitle(dateRange.from, dateRange.to)} · ${inRange} meeting${inRange === 1 ? "" : "s"}` : palmsScopeLabel(weeks, weekIds, "All weeks"),
    bounds: weekBounds(weeks),
  };
}

/** The scope line under the title. */
export async function PalmsScopeLine({ scopePromise }: { scopePromise: Promise<PalmsScope> }) {
  return <p className="sub muted">{(await scopePromise).scopeLabel}</p>;
}

/** XLSX / CSV / PDF buttons of the scope on screen. */
export async function PalmsExportSection({ scopePromise }: { scopePromise: Promise<PalmsScope> }) {
  const s = await scopePromise;
  return <PalmsExportButtons weekId={s.exportWeek} scopeLabel={s.allWeeks ? "All weeks" : s.scopeLabel || "palms"} />;
}

/** The PALMS import panel (needs the last import record and whether any attendance exists). */
export async function PalmsImportSection({
  recordPromise,
  weeksPromise,
}: {
  recordPromise: Promise<{ filename: string; importedAt: string } | null>;
  weeksPromise: Promise<WeekOption[]>;
}) {
  const [record, weeks] = await Promise.all([recordPromise, weeksPromise]);
  return <PalmsImportPanel hasData={weeks.length > 0} record={record} />;
}

/** The week dropdown + From / To calendars card. */
export async function PalmsControls({ scopePromise }: { scopePromise: Promise<PalmsScope> }) {
  const s = await scopePromise;
  return (
    <div className="card report-controls">
      <div className="report-controls-row">
        <FilterBar basePath="/palms" q="" weekId={s.weekId} weeks={s.weeks} searchPlaceholder="" hideSearch includeAllOption />
        <DateRangeFilter paramKey="week" min={s.bounds.min} max={s.bounds.max} />
        <span className="muted">P Present · A Absent · M Medical · S Substitute · L Leave</span>
      </div>
    </div>
  );
}

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
