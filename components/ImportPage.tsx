"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ImportPanel from "@/components/ImportPanel";
import PalmsImportPanel from "@/components/PalmsImportPanel";
import ColumnFilter from "@/components/ColumnFilter";
import ConfirmDialog from "@/components/ConfirmDialog";

type Batch = {
  id: string;
  filename: string;
  imported_count: number;
  skipped_count: number;
  status: string;
  error_message: string | null;
  created_at: string;
  bni_weeks: { label: string; meeting_date: string | null } | null;
  kind: "slips" | "palms";
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

/**
 * One history table (Slips Audit Reports, or PALMS Reports): its own
 * header filters and expandable skipped-rows detail.
 */
function HistoryTable({
  title,
  emptyText,
  batches,
  onAskDelete,
}: {
  title: string;
  emptyText: string;
  batches: Batch[];
  onAskDelete: (id: string) => void;
}) {
  // Collapse/expand, same pattern (and button) as the import panels above:
  // header always visible, table hidden while minimized.
  const [open, setOpen] = useState(true);
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

  return (
    <div className="card history-card">
      <div className="import-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="import-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "− Minimize" : "+ Show table"}
        </button>
      </div>
      {!open ? null : batches.length === 0 ? (
        <p className="muted">{emptyText}</p>
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
                    />
                  </th>
                  <th>Imported</th>
                  <th>Skipped</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
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
                          <td>
                            <button
                              type="button"
                              className="danger"
                              aria-label={`Delete ${b.filename}`}
                              onClick={() => onAskDelete(b.id)}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="skip-detail">
                            <td colSpan={6}>
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
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ImportPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  // Delete flow: which row is being confirmed, request-in-flight flag and the
  // last failure (shown above both tables).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const confirmBatch = useMemo(() => batches.find((b) => b.id === confirmId) ?? null, [batches, confirmId]);

  /** Delete the confirmed import: batch row + every row it created. */
  async function deleteImport() {
    if (!confirmBatch || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/import/batches/${confirmBatch.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error ?? `Delete failed (${res.status}).`);
        setConfirmId(null);
        return;
      }
      setConfirmId(null);
      await refreshHistory();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Network error");
      setConfirmId(null);
    } finally {
      setDeleting(false);
    }
  }

  const askDelete = (id: string) => {
    setDeleteError(null);
    setConfirmId(id);
  };

  return (
    <div>
      <ImportPanel onImported={refreshHistory} />

      <PalmsImportPanel onImported={refreshHistory} />

      {deleteError ? <p className="preview-warn">Delete failed: {deleteError}</p> : null}

      <HistoryTable
        title="Imported Slips Audit Reports"
        emptyText="No slips imports yet."
        batches={batches.filter((b) => b.kind === "slips")}
        onAskDelete={askDelete}
      />
      <HistoryTable
        title="Imported PALMS Reports"
        emptyText="No PALMS imports yet."
        batches={batches.filter((b) => b.kind === "palms")}
        onAskDelete={askDelete}
      />

      {confirmBatch ? (
        <ConfirmDialog
          title="Delete this import?"
          message={`Delete ${confirmBatch.filename}${
            confirmBatch.bni_weeks?.label ? ` (${confirmBatch.bni_weeks.label})` : ""
          } and every row it imported — its slips, or its PALMS attendance cells? Other imports of that week stay. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={deleteImport}
          onCancel={() => setConfirmId(null)}
        />
      ) : null}
    </div>
  );
}
