import Link from "next/link";
import ColumnFilter from "@/components/ColumnFilter";
import NoAccess from "@/components/NoAccess";
import TrafficMonthPicker from "@/components/TrafficMonthPicker";
import { multiParts } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";
import { LIGHT_LABEL, type LightColor } from "@/lib/traffic-light-score";
import { fetchTrafficData, trafficView } from "@/lib/traffic-lights";

export const dynamic = "force-dynamic";

const LIGHTS: LightColor[] = ["green", "amber", "red", "grey"];
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10}%`);
const rate = (r: number) => (Math.round(r * 100) / 100).toFixed(2);
const rupees = (v: number) => (v > 0 ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");

export default async function TrafficLightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const sp = await searchParams;

  const data = await fetchTrafficData(guard.tenantId).catch(() => null);
  if (!data) {
    return (
      <div className="card empty-state">
        <p>Could not load the Traffic Lights data. Please refresh.</p>
      </div>
    );
  }
  const view = trafficView(data, sp.month);
  const light = LIGHTS.includes(sp.light as LightColor) ? (sp.light as LightColor) : "";
  const nameFilter = (sp.c_name ?? "").trim();
  const wantNames = new Set(multiParts(nameFilter).map((n) => n.toLowerCase()));

  const counts: Record<LightColor, number> = { green: 0, amber: 0, red: 0, grey: 0 };
  for (const r of view.rows) counts[r.color] += 1;
  const rows = view.rows.filter((r) => (!light || r.color === light) && (wantNames.size === 0 || wantNames.has(r.name.toLowerCase())));
  const filtered = light !== "" || nameFilter !== "";
  const chip = (c: LightColor | "") => {
    const q = new URLSearchParams();
    if (view.month) q.set("month", view.month);
    if (c) q.set("light", c);
    return `/traffic-lights?${q.toString()}`;
  };

  return (
    <div>
      <div className="page-head">
        <h1>
          Traffic Lights
          <span className="count-badge">{rows.length} member(s)</span>
        </h1>
        <p className="sub muted">
          {view.windowLabel} — active members of {data.homeName}, scored out of 100
        </p>
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          {view.months.length > 0 ? <TrafficMonthPicker value={view.month} months={view.months} light={light} /> : null}
        </div>
        <div className="tl-chips">
          <Link href={chip("")} className={`tl-chip${light === "" ? " on" : ""}`}>
            All <strong>{view.rows.length}</strong>
          </Link>
          {LIGHTS.map((c) => (
            <Link key={c} href={chip(c)} className={`tl-chip${light === c ? " on" : ""}`}>
              <span className={`tl-dot tl-${c}`} /> {LIGHT_LABEL[c]} <strong>{counts[c]}</strong>
            </Link>
          ))}
          <span className="muted tl-legend">Green ≥ 70 · Amber 50–69 · Red 30–49 · Grey &lt; 30</span>
          {filtered ? (
            <span className="clear-right">
              <Link href={view.month ? `/traffic-lights?month=${view.month}` : "/traffic-lights"}>
                <button type="button">Clear all</button>
              </Link>
            </span>
          ) : null}
        </div>
      </div>

      {view.missingAttendance > 0 ? (
        <div className="data-alert">
          PALMS attendance is missing for {view.missingAttendance} member(s) in this window (0 points for them) — import the full PALMS
          attendance report on the Attendance screen.
        </div>
      ) : null}
      <p className="sub muted tl-source">
        Attendance comes from the PALMS attendance import; CEU, 121, referrals, TYFCB and visitors from the slip audit report. Sponsors are
        counted from the visitor slips (a visitor who is now a member credits whoever invited them). BNI may credit visitors for whom no
        slip was filed, so visitors and sponsors can be lower than in BNI's own report.
      </p>

      {view.rows.length === 0 ? (
        <div className="card empty-state">
          <p>No active members or no meetings imported yet.</p>
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid tl-table">
              <thead>
                <tr className="tl-groups">
                  <th className="idx" rowSpan={2}>
                    Sr. No.
                  </th>
                  <th rowSpan={2}>
                    <ColumnFilter
                      paramKey="c_name"
                      defaultValue={nameFilter}
                      options={view.rows.map((r) => r.name).sort((a, b) => a.localeCompare(b))}
                      label="Name"
                    />
                  </th>
                  <th rowSpan={2}>Total Score</th>
                  <th colSpan={2}>Attendance</th>
                  <th colSpan={2}>CEU</th>
                  <th colSpan={2}>121</th>
                  <th colSpan={2}>Referrals Given</th>
                  <th colSpan={2}>TYFCB</th>
                  <th colSpan={2}>Visitors</th>
                  <th colSpan={2}>Sponsors</th>
                </tr>
                <tr className="tl-sub">
                  {["Rate", "Score", "Rate", "Score", "Rate", "Score", "Rate", "Score", "Amount", "Score", "Count", "Score", "Count", "Score"].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="muted">
                      No member matches these filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={r.name}>
                      <td className="idx">{i + 1}</td>
                      <td>
                        {r.name}
                        {r.notes.length > 0 ? (
                          <span className="tl-note" title={r.notes.join("\n")}>
                            {" "}
                            ⓘ
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`tl-dot tl-${r.color}`} title={LIGHT_LABEL[r.color]} /> <strong>{r.total}</strong>
                      </td>
                      <td title={r.attendance.source === "none" ? "No PALMS attendance imported" : "From PALMS attendance"}>
                        {pct(r.attendance.rate)}
                      </td>
                      <td>{r.attendance.score}</td>
                      <td>{rate(r.ceu.rate)}</td>
                      <td>{r.ceu.score}</td>
                      <td>{rate(r.oneToOne.rate)}</td>
                      <td>{r.oneToOne.score}</td>
                      <td>{rate(r.referrals.rate)}</td>
                      <td>{r.referrals.score}</td>
                      <td>{rupees(r.tyfcb.amount)}</td>
                      <td>{r.tyfcb.score}</td>
                      <td title="Visitor slips filed by this member">{r.visitors.count}</td>
                      <td>{r.visitors.score}</td>
                      <td title="Visitors of this member who are now members">{r.sponsors.count}</td>
                      <td>{r.sponsors.score}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
