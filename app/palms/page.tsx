import { Suspense } from "react";
import CollapseCard from "@/components/CollapseCard";
import FilterBar from "@/components/FilterBar";
import NoAccess from "@/components/NoAccess";
import PalmsExportButtons from "@/components/PalmsExportButtons";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import { PalmsMatrixSection, PalmsMemberCount, PalmsStatsCard } from "@/components/PalmsAsync";
import { PalmsMatrixSkeleton, PalmsStatsSkeleton } from "@/components/Skeletons";
import DateRangeFilter from "@/components/DateRangeFilter";
import { expandWeekToken, findRangeToken, LAST6_TOKEN, parseRangeToken, rangeTitle, weekBounds } from "@/lib/weeks";
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
  const rangeTok = findRangeToken(sp.week); // a From / To date range (expanded to the weeks inside it above)
  const allWeeks = weekIds.length === 0 && !last6;
  const weekId = last6 ? LAST6_TOKEN : rangeTok ? rangeTok : allWeeks ? "all" : weekIds.join(",");
  const exportWeek = allWeeks ? "all" : weekIds.join(",");

  // The two slow queries START here but are not awaited: the matrix, the member count and the summary card are streamed in
  // by <Suspense> (components/PalmsAsync.tsx) while everything else is already on screen. The no-op catch only keeps an
  // early rejection from being "unhandled" before a Suspense child reads the promise (which still throws for the error boundary).
  const matrixPromise = fetchPalmsMatrix(tenantId, weekIds);
  const statsPromise = fetchPalmsAttendanceStats(tenantId);
  matrixPromise.catch(() => undefined);
  statsPromise.catch(() => undefined);
  const record = await fetchPalmsImportRecord(tenantId);
  const dateRange = parseRangeToken(rangeTok);
  const inRangeWeeks = dateRange ? weekIds.filter((id) => weeks.some((w) => w.id === id)).length : 0;
  const scopeLabel = dateRange
    ? `${rangeTitle(dateRange.from, dateRange.to)} · ${inRangeWeeks} meeting${inRangeWeeks === 1 ? "" : "s"}`
    : palmsScopeLabel(weeks, weekIds, "All weeks");
  const bounds = weekBounds(weeks);
  // Member column filter (dropdown; several names with the Multi-select checkbox): narrows the matrix rows.
  const memberFilter = (sp.c_member ?? "").trim();

  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            Attendance
            <Suspense fallback={<span className="count-badge">…</span>}>
              <PalmsMemberCount promise={matrixPromise} memberFilter={memberFilter} />
            </Suspense>
          </h1>
          <p className="sub muted">{scopeLabel}</p>
        </div>
        <div className="report-head-actions">
          <PalmsExportButtons weekId={exportWeek} scopeLabel={allWeeks ? "All weeks" : scopeLabel || "palms"} />
        </div>
      </div>

      <PalmsImportPanel hasData={weeks.length > 0} record={record} />

      <Suspense fallback={<PalmsStatsSkeleton />}>
        <PalmsStatsCard promise={statsPromise} />
      </Suspense>

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
          <DateRangeFilter paramKey="week" min={bounds.min} max={bounds.max} />
          <span className="muted">
            P Present · A Absent · M Medical · S Substitute · L Leave
          </span>
        </div>
      </div>

      <CollapseCard label="Attendance matrix">
        <Suspense fallback={<PalmsMatrixSkeleton />}>
          <PalmsMatrixSection promise={matrixPromise} memberFilter={memberFilter} />
        </Suspense>
      </CollapseCard>
    </div>
  );
}
