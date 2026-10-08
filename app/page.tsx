import { requirePageTenant } from "@/lib/server-auth";
import { fetchAttendanceTrends, fetchHomeActiveMembers, fetchSlipTrends, type SlipTrends } from "@/lib/trends";
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
  // Attendance chart shares the slip chart's weeks so the two graphs align
  // point-for-point; the badge counts active Home Chapter members only.
  const [attendance, activeCount] = await Promise.all([
    fetchAttendanceTrends(guard.tenantId, trends.weeks).catch(() => ({ weeks: [], series: [] }) as SlipTrends),
    fetchHomeActiveMembers(guard.tenantId).then((r) => r.count).catch(() => 0),
  ]);

  return (
    <div>
      <div className="page-head">
        <h1>
          BNI Week Slips
          <span className="count-badge">{activeCount} active members</span>
        </h1>
      </div>

      <div className="card trend-card">
        <div className="import-head">
          <h2>
            Attendance <span className="muted">— last 6 months, weekly (Wednesdays)</span>
          </h2>
        </div>
        <TrendChart weeks={attendance.weeks} series={attendance.series} allLabel="All letters" />
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