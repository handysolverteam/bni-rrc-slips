import Link from "next/link";
import MonthFilter from "@/components/MonthFilter";
import MonthlyTop from "@/components/MonthlyTop";
import TopFilters from "@/components/TopFilters";
import NoAccess from "@/components/NoAccess";
import { buildMonthlyTop, fetchTopSource, type MonthlyTopData, type TopSource } from "@/lib/monthly-top";
import { windowRange } from "@/lib/period";
import type { MonthTop } from "@/lib/monthly-top-share";
import { requirePageTenant } from "@/lib/server-auth";
import { describeTopFilter, isDefaultTopFilter, parseTopFilter } from "@/lib/top-filter";

export const dynamic = "force-dynamic";

export default async function Top3Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const sp = await searchParams;

  let all: MonthTop[] = [];
  let windowMonths: MonthTop[] = [];
  let win: MonthlyTopData["window"] = null;
  let source: TopSource | null = null;
  try {
    source = await fetchTopSource(guard.tenantId);
  } catch {
    source = null;
  }
  // Member filters: default = ACTIVE members of the HOME chapter (the chat's rule); "all" lifts a restriction.
  const chapters = source?.chapters ?? [];
  const homeChapterId = source?.homeChapterId ?? null;
  const filter = parseTopFilter({ status: sp.status, chapter: sp.chapter }, homeChapterId, chapters.map((c) => c.id));
  if (source) {
    const data = buildMonthlyTop(source, filter);
    all = data.months;
    windowMonths = data.windowMonths;
    win = data.window;
  }
  const defaultFilter = isDefaultTopFilter(filter, homeChapterId);
  const filterText = describeTopFilter(filter, (id) => chapters.find((c) => c.id === id)?.name ?? "chapter");
  const known = new Set(all.map((m) => m.key));
  const picked = (sp.month ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((k) => known.has(k));
  // Nothing picked = the standard last 6 months (lib/period.ts: 26 or 27 weeks ending on the newest meeting; the first
  // month is clipped to the window start); picked months show those whole months.
  const shown = picked.length > 0 ? all.filter((m) => picked.includes(m.key)) : windowMonths;

  return (
    <div>
      <div className="page-head">
        <h1>
          Top 3
          <span className="count-badge">{shown.length} month(s)</span>
        </h1>
        <p className="sub muted">
          {picked.length > 0 ? "Selected months" : win ? `Last ${win.months} months · ${windowRange(win)}` : "Last 6 months"} — TYFCB · Referrals · Visitors
        </p>
        <p className="sub muted">{filterText}</p>
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          <MonthFilter
            basePath="/top3"
            value={picked.join(",")}
            months={all.map((m) => ({ key: m.key, label: m.label }))}
            keepParams={["status", "chapter"]}
          />
          <TopFilters
            statusValue={filter.statuses ? filter.statuses.join(",") : "all"}
            chapterValue={filter.chapters ? filter.chapters.join(",") : "all"}
            chapters={chapters}
          />
          {picked.length > 0 || !defaultFilter ? (
            <span className="clear-right">
              <Link href="/top3">
                <button type="button">Clear all</button>
              </Link>
            </span>
          ) : null}
        </div>
      </div>

      {shown.length > 0 ? (
        <MonthlyTop months={shown} />
      ) : (
        <div className="card empty-state">
          <p>No TYFCB, referral or visitor slips imported yet.</p>
        </div>
      )}
    </div>
  );
}
