import { Suspense } from "react";
import PalmsMatrixCard from "@/components/PalmsMatrixCard";
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
  // The matrix is the heavy part and starts collapsed: it is only read once the card is expanded (?matrix=1).
  const matrixOpen = sp.matrix === "1";
  const matrixPromise = matrixOpen ? scopePromise.then((s) => fetchPalmsMatrix(tenantId, s.weekIds)) : null;
  for (const p of [weeksPromise, recordPromise, statsPromise, scopePromise, matrixPromise]) p?.catch(() => undefined);
  // Member column filter (dropdown; several names with the Multi-select checkbox): narrows the matrix rows.
  const memberFilter = (sp.c_member ?? "").trim();

  return (
    <div>
      <div className="report-top">
        <div className="page-head">
          <h1>
            Attendance
            {matrixPromise ? (
              <Suspense fallback={<span className="count-badge">…</span>}>
                <PalmsMemberCount promise={matrixPromise} memberFilter={memberFilter} />
              </Suspense>
            ) : null}
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

      <PalmsMatrixCard label="Attendance matrix" open={matrixOpen}>
        {matrixPromise ? (
          <Suspense fallback={<PalmsMatrixSkeleton />}>
            <PalmsMatrixSection promise={matrixPromise} memberFilter={memberFilter} />
          </Suspense>
        ) : null}
      </PalmsMatrixCard>
    </div>
  );
}
