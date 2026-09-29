import ColumnFilter from "@/components/ColumnFilter";

type Col = { key: string; label: string };
// Name column -> its "belongs to another chapter" flag (set from .xlsx bold).
const OTHER_CHAPTER_FLAG: Record<string, string> = {
  from_name: "from_is_other_chapter",
  to_name: "to_is_other_chapter",
  initiated_by_name: "initiated_by_is_other_chapter",
  met_with_name: "met_with_is_other_chapter",
  thanker_name: "thanker_is_other_chapter",
};

function Cell({ columnKey, value, row }: { columnKey: string; value: unknown; row: Record<string, unknown> }) {
  if (columnKey === "inside_outside" && (value === "Inside" || value === "Outside")) {
    return <span className={`pill ${String(value).toLowerCase()}`}>{String(value)}</span>;
  }
  if (columnKey === "amount" && typeof value === "number") {
    return <>{value.toLocaleString("en-IN")}</>;
  }
  const flagKey = OTHER_CHAPTER_FLAG[columnKey];
  if (flagKey && row[flagKey] === true && value != null && String(value) !== "") {
    return (
      <>
        {String(value)} <span className="pill outside">Other chapter</span>
      </>
    );
  }
  return <>{value == null ? "" : String(value)}</>;
}

export default function SlipsTable({
  columns,
  rows,
  filterable = [],
  initialFilters = {},
  filterOptions = {},
  emptyHint = "No records yet — import a Report XLS to get started.",
}: {
  columns: Col[];
  rows: Record<string, unknown>[];
  filterable?: string[];
  initialFilters?: Record<string, string>;
  filterOptions?: Record<string, string[]>;
  emptyHint?: string;
}) {
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>
                  {filterable.includes(c.key) ? (
                    <ColumnFilter
                      paramKey={`c_${c.key}`}
                      defaultValue={initialFilters[c.key] ?? ""}
                      options={filterOptions[c.key] ?? []}
                      label={c.label}
                    />
                  ) : (
                    <span className="th-label">{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={(r.id as string) ?? i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <Cell columnKey={c.key} value={r[c.key]} row={r} />
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
