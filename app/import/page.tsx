"use client";

import { useEffect, useState } from "react";

type Notice = {
  kind: "success" | "error";
  title: string;
  detail?: string;
  columnsInfo?: string;
  errors?: string[];
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 10000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setNotice(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/report", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setNotice({
          kind: "error",
          title: "Import failed",
          detail: data.error ?? `Server returned status ${res.status}`,
        });
      } else {
        const blankNote =
          data.tyfcbBlankAmount > 0
            ? ` ${data.tyfcbBlankAmount} TYFCB row(s) had no amount in the file.`
            : "";
        const skippedNote = data.skippedCount ? ` ${data.skippedCount} row(s) skipped.` : "";
        const boldNote = data.boldUsed ? " Bold chapter info detected and applied." : "";
        setNotice({
          kind: "success",
          title: `Imported ${data.importedCount ?? 0} rows into ${data.bniWeek ?? "the week"}`,
          detail: `${skippedNote}${blankNote}${boldNote}`.trim() || undefined,
          columnsInfo: Array.isArray(data.columns) ? data.columns.join(" | ") : undefined,
          errors: Array.isArray(data.errors) ? data.errors : undefined,
        });
      }
    } catch (err) {
      setNotice({
        kind: "error",
        title: "Import failed",
        detail: err instanceof Error ? err.message : "Network error — is the server running?",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>Import Report XLS</h1>
      <p className="muted">
        The meeting week is read from the file itself — the first row, e.g.{" "}
        <strong>Slips Audit Report for 01/04/2026</strong>.
      </p>
      <form onSubmit={submit}>
        <label className="field">
          Report file (.xls / .xlsx / .csv)
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="hint">Tip: upload .xlsx (not .xls) — only .xlsx preserves bold, and bold names are filed as other-chapter members.</span>
        </label>
        <button className="primary btn-block" disabled={busy || !file} type="submit">
          {busy ? "Importing..." : "Import"}
        </button>
      </form>

      {notice ? (
        <div className={`toast ${notice.kind}`} role="alert">
          <div>
            <strong>{notice.title}</strong>
            {notice.detail ? <p className="muted">{notice.detail}</p> : null}
            {notice.columnsInfo ? (
              <details>
                <summary>Columns detected in file</summary>
                <p className="muted">{notice.columnsInfo}</p>
              </details>
            ) : null}
            {notice.errors && notice.errors.length > 0 ? (
              <details>
                <summary>Row issues ({notice.errors.length})</summary>
                <ul>
                  {notice.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
