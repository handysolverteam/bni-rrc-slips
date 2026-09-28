type Col = { key: string; label: string };

function Cell({ columnKey, value }: { columnKey: string; value: unknown }) {
  if (columnKey === "inside_outside" && (value === "Inside" || value === "Outside")) {
    return <span className={`pill ${String(value).toLowerCase()}`}>{String(value)}</span>;
  }
  if (columnKey === "amount" && typeof value === "number") {
    return <>{value.toLocaleString("en-IN")}</>;
  }
  return <>{value == null ? "" : String(value)}</>;
}

export default function SlipsTable({
  columns,
  rows,
  emptyHint = "No records yet — import a Report XLS to get started.",
}: {
  columns: Col[];
  rows: Record<string, unknown>[];
  emptyHint?: string;
}) {
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={(r.id as string) ?? i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <Cell columnKey={c.key} value={r[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <div className="empty-state">{emptyHint}</div> : null}
    </div>
  );
}
