import Link from "next/link";
import ColumnFilter from "@/components/ColumnFilter";
import NoAccess from "@/components/NoAccess";
import TrafficExportButtons from "@/components/TrafficExportButtons";
import TrafficImportPanel from "@/components/TrafficImportPanel";
import TrafficMonthPicker from "@/components/TrafficMonthPicker";
import { multiParts } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";
import { LIGHT_LABEL, type LightColor } from "@/lib/traffic-light-score";
import { fetchTrafficData, trafficView } from "@/lib/traffic-lights";

export const dynamic = "force-dynamic";

const LIGHTS: LightColor[] = ["green", "amber", "red", "grey"];
// Rates show up to 4 decimals, trailing zeros trimmed — exactly like BNI's sheet (1, 0.963, 0.9565, 2.0741).
const dec4 = (r: number): string => String(Math.round(r * 10000) / 10000);
const pct = (r: number | null) => (r === null ? "—" : dec4(r));
const rate = (r: number) => dec4(r);
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
      <div className="report-top tl-top">
        <div className="page-head">
          <h1>
            Traffic Lights
            <span className="count-badge">{rows.length} member(s)</span>
          </h1>
          <p className="sub muted">
            {view.windowLabel} — {data.homeName}, scored out of 100
          </p>
        </div>
        <div className="report-head-actions">
          {view.rows.length > 0 ? <TrafficExportButtons month={view.month} light={light} nameFilter={nameFilter} /> : null}
        </div>
      </div>

      {view.rows.length === 0 ? (
        <TrafficImportPanel />
      ) : (
        <details className="tl-import">
          <summary>Import or replace the BNI reports</summary>
          <TrafficImportPanel />
        </details>
      )}

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
          <span className="muted tl-legend">
            <b className="tl-lg tl-lg-green">Green</b> ≥ 70 · <b className="tl-lg tl-lg-amber">Amber</b> 50–69 · <b className="tl-lg tl-lg-red">Red</b> 30–49 ·{" "}
            <b className="tl-lg tl-lg-grey">Grey</b> &lt; 30
          </span>
          {filtered ? (
            <span className="clear-right">
              <Link href={view.month ? `/traffic-lights?month=${view.month}` : "/traffic-lights"}>
                <button type="button">Clear all</button>
              </Link>
            </span>
          ) : null}
        </div>
      </div>

      {view.rows.length > 0 && !view.hasSponsorReport ? (
        <div className="data-alert">
          No Chapter Sponsor Report is imported for this range, so every member shows 0 sponsors — import it on the Import screen.
        </div>
      ) : null}
      <p className="sub muted tl-source">
        Everything on this screen comes from BNI&apos;s own reports, imported on the Import screen: the Chapter Summary PALMS Report
        (attendance, CEU, 121, referrals, TYFCB, visitors) and the Chapter Sponsor Report (sponsors).
      </p>

      {view.rows.length === 0 ? (
        <div className="card empty-state">
          <p>
            {view.needsMigration
              ? "Run supabase/migrations/010_traffic_reports.sql in the Supabase SQL editor, then import the two BNI reports."
              : "No Traffic Lights reports imported yet — import the Chapter Summary PALMS Report and the Chapter Sponsor Report on the Import screen."}
          </p>
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
                  <th colSpan={2} data-g="att">Attendance</th>
                  <th colSpan={2} data-g="ceu">CEU</th>
                  <th colSpan={2} data-g="oto">121</th>
                  <th colSpan={2} data-g="ref">Referrals Given</th>
                  <th colSpan={2} data-g="tyf">TYFCB</th>
                  <th colSpan={2} data-g="vis">Visitors</th>
                  <th colSpan={2} data-g="spo">Sponsors</th>
                </tr>
                <tr className="tl-sub">
                  {["Rate", "Score", "Rate", "Score", "Rate", "Score", "Rate", "Score", "Amount", "Score", "Count", "Score", "Count", "Score"].map((h, i) => (
                    <th key={i} data-g={["att", "ceu", "oto", "ref", "tyf", "vis", "spo"][Math.floor(i / 2)]}>
                      {h}
                    </th>
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
                      <td title={r.weeks + " lettered weeks"}>
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
                      <td title="V column of the PALMS report">{r.visitors.count}</td>
                      <td>{r.visitors.score}</td>
                      <td title="Members sponsored (Sponsor Report)">{r.sponsors.count}</td>
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
