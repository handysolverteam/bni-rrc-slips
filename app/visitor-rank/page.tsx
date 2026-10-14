import Link from "next/link";
import ColumnFilter from "@/components/ColumnFilter";
import MonthFilter from "@/components/MonthFilter";
import MultiSelectToggle from "@/components/MultiSelectToggle";
import NoAccess from "@/components/NoAccess";
import VisitorRankShare from "@/components/VisitorRankShare";
import { multiParts } from "@/lib/list-filters";
import { requirePageTenant } from "@/lib/server-auth";
import { fetchVisitorRanking } from "@/lib/visitor-ranking";
import { buildRankingShare, filterRanking, mergeRanking, namesWithNone } from "@/lib/visitor-ranking-share";

export const dynamic = "force-dynamic";

const DEFAULT_MONTHS = 6;

export default async function VisitorRankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const guard = await requirePageTenant();
  if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
  const sp = await searchParams;

  const data = await fetchVisitorRanking(guard.tenantId).catch(() => ({
    months: [] as { key: string; label: string }[],
    counts: {},
    pool: [] as string[],
  }));
  const months = data.months;
  const known = new Set(months.map((m) => m.key));
  const picked = (sp.month ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((k) => known.has(k));
  // Nothing picked = the last 6 months; picked months are summed exactly.
  const shown = picked.length > 0 ? months.filter((m) => picked.includes(m.key)) : months.slice(0, DEFAULT_MONTHS);
  const keys = shown.map((m) => m.key);
  const label =
    picked.length > 0
      ? shown.length === 1
        ? shown[0].label
        : `${shown.length} months`
      : `Last ${DEFAULT_MONTHS} months`;

  // Column filters: Member (dropdown, one or several names) and Visitors (typed: 3, >2, 2-4, …).
  const memberFilter = (sp.c_member ?? "").trim();
  const countFilter = (sp.c_visitors ?? "").trim();
  const filtered = memberFilter !== "" || countFilter !== "";

  const all = mergeRanking(data.counts, keys);
  const ranking = filterRanking(all, multiParts(memberFilter), multiParts(countFilter).join(" "));
  // "Brought none" is about the whole window, so it only shows when no column filter narrows the table.
  const none = filtered ? [] : namesWithNone(data.pool, all);
  const total = ranking.reduce((s, r) => s + r.count, 0);
  const shareText = buildRankingShare(filtered ? `${label} (filtered)` : label, ranking, none);

  return (
    <div>
      <div className="page-head">
        <h1>
          Visitor Rank
          <span className="count-badge">{ranking.length} member(s)</span>
        </h1>
        <p className="sub muted">
          {picked.length > 0 ? "Selected months" : `Last ${DEFAULT_MONTHS} months`} — visitors brought, least to most
        </p>
      </div>

      <div className="card report-controls">
        <div className="report-controls-row">
          <MonthFilter basePath="/visitor-rank" value={picked.join(",")} months={months.map((m) => ({ key: m.key, label: m.label }))} />
          {ranking.length > 0 ? <VisitorRankShare text={shareText} /> : null}
          {picked.length > 0 || filtered ? (
            <span className="clear-right">
              <Link href="/visitor-rank">
                <button type="button">Clear all</button>
              </Link>
            </span>
          ) : null}
        </div>
      </div>

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
                    options={all.map((r) => r.name).sort((a, b) => a.localeCompare(b))}
                    label="Member"
                  />
                </th>
                <th>
                  <ColumnFilter paramKey="c_visitors" defaultValue={countFilter} options={[]} label="Visitors" text />
                </th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    {filtered ? "No member matches these filters." : `No visitors recorded for ${label.toLowerCase()}.`}
                  </td>
                </tr>
              ) : (
                ranking.map((r, i) => (
                  <tr key={r.name}>
                    <td className="idx">{i + 1}</td>
                    <td>{r.name}</td>
                    <td>{r.count}</td>
                  </tr>
                ))
              )}
            </tbody>
            {ranking.length > 0 ? (
              <tfoot>
                <tr className="sum-row">
                  <td className="idx" />
                  <td>Total · {ranking.length} member(s)</td>
                  <td>{total}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {none.length > 0 ? (
        <p className="sub muted" style={{ marginTop: 14 }}>
          <strong>Brought none ({none.length} active member{none.length === 1 ? "" : "s"}):</strong> {none.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
