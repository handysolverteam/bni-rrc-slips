import Link from "next/link";
import { requirePageTenant } from "@/lib/server-auth";
import { fetchSlipTrends, type SlipTrends } from "@/lib/trends";
import NoAccess from "@/components/NoAccess";
import TrendChart from "@/components/TrendChart";

export const dynamic = "force-dynamic";

export default async function Home() {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  let trends: SlipTrends = { weeks: [], series: [] };
  try {
    trends = await fetchSlipTrends(guard.tenantId);
  } catch {
    trends = { weeks: [], series: [] };
  }

  return (
    <div>
      <div className="card hero">
        <h1>BNI Week Slips</h1>
        <p className="muted">
          Import the weekly Report XLS (From, To, Slip Type, Inside/Outside, TYFCB, CEU Credits,
          Detail) — then track every slip type as a weekly trend for the last 6 months.
        </p>
        <div className="hero-actions">
          <Link href="/import">
            <button type="button" className="primary">
              Import Report XLS
            </button>
          </Link>
        </div>
      </div>

      <div className="card trend-card">
        <div className="import-head">
          <h2>
            Slip trends <span className="muted">— last 6 months, weekly (Wednesdays)</span>
          </h2>
        </div>
        <TrendChart weeks={trends.weeks} series={trends.series} />
      </div>
    </div>
  );
}
