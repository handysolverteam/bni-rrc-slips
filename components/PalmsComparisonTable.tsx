import { COMPARE_METRICS, type WeekComparison } from "@/lib/palms-compare";

const fmt = (key: string, v: number): string =>
  key === "tyfcb" ? v.toLocaleString("en-IN") : String(v);

/**
 * Side-by-side PALMS vs slips table for the selected week scope (one block of
 * metric rows per week) — `/summary` only; `/report` shows the banner instead.
 */
export default function PalmsComparisonTable({ comparisons }: { comparisons: WeekComparison[] }) {
  if (comparisons.length === 0) return null;
  return (
    <>
      <div className="import-head">
        <h2>PALMS vs slips{comparisons.length > 1 ? ` — ${comparisons.length} weeks` : ""}</h2>
      </div>
      <div className="table-card">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                {comparisons.length > 1 ? <th>Week</th> : null}
                <th>Metric</th>
                <th>PALMS</th>
                <th>Slips</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.flatMap((c) =>
                COMPARE_METRICS.map((m) => {
                  const row = c.rows.find((r) => r.key === m.key);
                  const match = row?.match ?? true;
                  return (
                    <tr key={`${c.weekId}-${m.key}`}>
                      {comparisons.length > 1 ? (
                        <td>{c.weekLabel}</td>
                      ) : null}
                      <td>{m.label}</td>
                      <td>{fmt(m.key, row?.palms ?? 0)}</td>
                      <td>{fmt(m.key, row?.slips ?? 0)}</td>
                      <td>{match ? "Match" : <strong>MISMATCH</strong>}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
