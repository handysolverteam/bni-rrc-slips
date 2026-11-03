import { Suspense } from "react";
import CollapseCard from "@/components/CollapseCard";
import NoAccess from "@/components/NoAccess";
import {
  PalmsControls,
  PalmsExportSection,
  PalmsImportSection,
  PalmsMatrixSection,
  PalmsMemberCount,
  PalmsScopeLine,
  PalmsStatsCard,
  resolvePalmsScope,
} from "@/components/PalmsAsync";
import {
  PalmsControlsSkeleton,
  PalmsImportSkeleton,
  PalmsMatrixSkeleton,
  PalmsScopeLineSkeleton,
  PalmsStatsSkeleton,
} from "@/components/Skeletons";
import { requirePageTenant } from "@/lib/server-auth";
import {
  fetchPalmsAttendanceStats,
  fetchPalmsImportRecord,
  fetchPalmsMatrix,
  fetchPalmsWeekOptions,
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

  // Only sign-in is awaited. Every query STARTS here and is read by its own <Suspense> section (components/PalmsAsync.tsx),
  // so the slow matrix can never delay the title, filters, export buttons, import panel or summary card. The no-op catches
  // only keep an early rejection from being "unhandled" before a section reads the promise (which still throws for the
  // error boundary).
  const weeksPromise = fetchPalmsWeekOptions(tenantId);
  const recordPromise = fetchPalmsImportRecord(tenantId);
  const statsPromise = fetchPalmsAttendanceStats(tenantId);
  const scopePromise = weeksPromise.then((weeks) => resolvePalmsScope(sp.week, weeks));
  const matrixPromise = scopePromise.then((s) => fetchPalmsMatrix(tenantId, s.weekIds));
  for (const p of [weeksPromise, recordPromise, statsPromise, scopePromise, matrixPromise]) p.catch(() => undefined);
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
          <Suspense fallback={<PalmsScopeLineSkeleton />}>
            <PalmsScopeLine scopePromise={scopePromise} />
          </Suspense>
        </div>
        <div className="report-head-actions">
          <Suspense fallback={null}>
            <PalmsExportSection scopePromise={scopePromise} />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<PalmsImportSkeleton />}>
        <PalmsImportSection recordPromise={recordPromise} weeksPromise={weeksPromise} />
      </Suspense>

      <Suspense fallback={<PalmsStatsSkeleton />}>
        <PalmsStatsCard promise={statsPromise} />
      </Suspense>

      <Suspense fallback={<PalmsControlsSkeleton />}>
        <PalmsControls scopePromise={scopePromise} />
      </Suspense>

      <CollapseCard label="Attendance matrix">
        <Suspense fallback={<PalmsMatrixSkeleton />}>
          <PalmsMatrixSection promise={matrixPromise} memberFilter={memberFilter} />
        </Suspense>
      </CollapseCard>
    </div>
  );
}
