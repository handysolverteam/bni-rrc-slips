"use client";

import { Fragment, useEffect, useState } from "react";
import ImportPanel from "@/components/ImportPanel";

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

export default function ImportPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [openSkip, setOpenSkip] = useState<string | null>(null);

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
                    <th>Imported On</th>
                    <th>File</th>
                    <th>Week</th>
                    <th>Imported</th>
                    <th>Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
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
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
