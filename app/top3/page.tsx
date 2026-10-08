import Link from "next/link";
import MonthFilter from "@/components/MonthFilter";
import MonthlyTop from "@/components/MonthlyTop";
import NoAccess from "@/components/NoAccess";
import { fetchMonthlyTop } from "@/lib/monthly-top";
import type { MonthTop } from "@/lib/monthly-top-share";
import { requirePageTenant } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const DEFAULT_MONTHS = 6;

export default async function Top3Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const sp = await searchParams;

  let all: MonthTop[] = [];
  try {
    all = await fetchMonthlyTop(guard.tenantId);
  } catch {
    all = [];
  }
  const known = new Set(all.map((m) => m.key));
  const picked = (sp.month ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((k) => known.has(k));
  // Nothing picked = the last 6 months; picked months show exactly those.
  const shown = picked.length > 0 ? all.filter((m) => picked.includes(m.key)) : all.slice(0, DEFAULT_MONTHS);

  return (
    <div>
      <div className="page-head">
        <h1>
          Top 3
          <span className="count-badge">{shown.length} month(s)</span>
        </h1>
        <p className="sub muted">
          {picked.length > 0 ? "Selected months" : `Last ${DEFAULT_MONTHS} months`} — TYFCB · Referrals · Visitors
        </p>
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          <MonthFilter
            basePath="/top3"
            value={picked.join(",")}
            months={all.map((m) => ({ key: m.key, label: m.label }))}
          />
          {picked.length > 0 ? (
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
