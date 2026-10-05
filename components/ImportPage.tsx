"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ImportPanel from "@/components/ImportPanel";
import ColumnFilter from "@/components/ColumnFilter";

type Batch = {
  id: string;
  filename: string;
  imported_count: number;
  skipped_count: number;
  status: string;
  error_message: string | null;
  created_at: string;
  bni_weeks: { label: string; meeting_date: string | null } | null;
};

/**
 * Skipped-row reasons stored on the batch. New imports store JSON
 * `{ errors, skips }`; older rows hold plain text or nothing at all.
 */
function skipEntries(b: Batch): string[] | null {
  if (!b.error_message) return null;
  try {
    const parsed = JSON.parse(b.error_message) as { skips?: unknown };
    if (Array.isArray(parsed?.skips)) {
      return parsed.skips.filter((s): s is string => typeof s === "string");
    }
  } catch {
    // legacy plain-text log
  }
  return b.error_message.split(" | ").map((s) => s.trim()).filter(Boolean);
}

/** Local calendar day (YYYY-MM-DD) of an import timestamp — matches the "Imported On" cell. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ImportPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [openSkip, setOpenSkip] = useState<string | null>(null);
  // Header filters (client-side, like the other tables' column filters):
  // "Imported On" picks a single day, "Week" multi-selects week labels.
  const [dateFilter, setDateFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");

  const weekOptions = useMemo(() => {
    const seen: string[] = [];
    for (const b of batches) {
      const label = b.bni_weeks?.label ?? "—";
      if (!seen.includes(label)) seen.push(label);
    }
    return seen;
  }, [batches]);

  const filtered = useMemo(
    () =>
      batches.filter((b) => {
        if (weekFilter && !weekFilter.split(",").includes(b.bni_weeks?.label ?? "—")) return false;
        if (dateFilter && localDateKey(b.created_at) !== dateFilter) return false;
        return true;
      }),
    [batches, weekFilter, dateFilter],
  );

  async function refreshHistory() {
    try {
      const res = await fetch("/api/import/batches");
      const data = await res.json();
      if (Array.isArray(data.batches)) setBatches(data.batches);
    } catch {
      // history simply stays as-is
    }
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  return (
    <div>
      <ImportPanel onImported={refreshHistory} />

      <div className="card history-card">
        <h2>Imported weeks</h2>
        {batches.length === 0 ? (
          <p className="muted">No imports yet.</p>
        ) : (
          <div className="table-card">
            <div className="table-scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>
                      <span className="col-filter-wrap">
                        <span
                          className={`combo${dateFilter ? " has-value" : ""}`}
                          title="Filter by import date"
                        >
                          <span className="combo-field">
                            <input
                              type="date"
                              className="combo-input col-filter-date"
                              value={dateFilter}
                              aria-label="Imported On"
                              onChange={(e) => setDateFilter(e.target.value)}
                            />
                            {dateFilter ? (
                              <button
                                type="button"
                                className="combo-adorn"
                                aria-label="Clear date filter"
                                onClick={() => setDateFilter("")}
                              >
                                ✕
                              </button>
                            ) : null}
                          </span>
                        </span>
                      </span>
                    </th>
                    <th>File</th>
                    <th>
                      <ColumnFilter
                        paramKey="week"
                        defaultValue={weekFilter}
                        options={weekOptions}
                        label="Week"
                        allLabel="All weeks"
                        onApply={setWeekFilter}
                        multiSelect
                      />
                    </th>
                    <th>Imported</th>
                    <th>Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No imports match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((b) => {
                    const open = openSkip === b.id;
                    const entries = skipEntries(b);
                    return (
                      <Fragment key={b.id}>
                        <tr>
                          <td>{new Date(b.created_at).toLocaleString()}</td>
                          <td>{b.filename}</td>
                          <td>{b.bni_weeks?.label ?? "—"}</td>
                          <td>{b.imported_count}</td>
                          <td>
                            {b.skipped_count > 0 ? (
                              <button
                                type="button"
                                className="skip-toggle"
                                aria-expanded={open}
                                onClick={() => setOpenSkip(open ? null : b.id)}
                              >
                                {b.skipped_count}
                                <span className="skip-caret">{open ? "▾" : "▸"}</span>
                              </button>
                            ) : (
                              b.skipped_count
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr className="skip-detail">
                            <td colSpan={5}>
                              <strong>
                                Skipped entries (
                                {entries && entries.length !== b.skipped_count
                                  ? `${entries.length} of ${b.skipped_count}`
                                  : b.skipped_count}
                                )
                              </strong>
                              {entries && entries.length > 0 ? (
                                <ul>
                                  {entries.map((e, i) => (
                                    <li key={i}>{e}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="muted">
                                  Details weren&apos;t recorded for this import — reasons are stored for
                                  new imports.
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                    }))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
