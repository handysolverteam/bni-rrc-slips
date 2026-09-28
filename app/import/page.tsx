"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type Notice = {
  kind: "success" | "error";
  title: string;
  detail?: string;
  columnsInfo?: string;
  errors?: string[];
};

type Preview = {
  filename: string;
  reportDate: string;
  meetingDate: string;
  weekLabel: string;
  weekExists: boolean;
  weekId: string | null;
  slipCount: number;
  rowCount: number;
  columns: string[];
  boldUsed: boolean;
  errors: string[];
};

type Batch = {
  id: string;
  filename: string;
  imported_count: number;
  skipped_count: number;
  status: string;
  created_at: string;
  bni_weeks: { label: string; meeting_date: string | null } | null;
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(timer);
  }, [notice]);

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

  async function pickFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setNotice(null);
    if (!f) return;
    setReading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", title: "Could not read file", detail: data.error ?? "Preview failed." });
      } else {
        setPreview(data);
      }
    } catch (err) {
      setNotice({
        kind: "error",
        title: "Could not read file",
        detail: err instanceof Error ? err.message : "Network error — is the server running?",
      });
    } finally {
      setReading(false);
    }
  }

  async function doImport() {
    if (!file || busy) return;
    setBusy(true);
    setConfirming(false);
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
        setPreview(null);
        refreshHistory();
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Week already holds data: ask before importing again.
    if (preview && preview.weekExists && preview.slipCount > 0) {
      setConfirming(true);
      return;
    }
    doImport();
  }

  return (
    <div>
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
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <span className="hint">Tip: upload .xlsx (not .xls) — only .xlsx preserves bold, and bold names are filed as other-chapter members.</span>
          </label>

          {reading ? <p className="muted">Reading file…</p> : null}

          {preview ? (
            <div className={`preview-card ${preview.weekExists && preview.slipCount > 0 ? "warn" : "ok"}`}>
              <strong>{preview.weekLabel}</strong>
              <p className="muted">
                {preview.rowCount} row(s) in file
                {preview.boldUsed ? " · bold chapter info found" : ""}
              </p>
              {preview.weekExists && preview.slipCount > 0 ? (
                <p className="preview-warn">
                  This week is already imported ({preview.slipCount} slip(s)). Importing again
                  keeps existing rows and adds only new ones.
                </p>
              ) : (
                <p className="preview-ok">New week — nothing imported yet.</p>
              )}
            </div>
          ) : null}

          <button className="primary btn-block" disabled={busy || reading || !file || !preview} type="submit">
            {busy ? "Importing..." : reading ? "Reading…" : "Import"}
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
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td>{new Date(b.created_at).toLocaleString()}</td>
                      <td>{b.filename}</td>
                      <td>{b.bni_weeks?.label ?? "—"}</td>
                      <td>{b.imported_count}</td>
                      <td>{b.skipped_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {confirming && preview ? (
        <ConfirmDialog
          title="Import this week again?"
          message={`"${preview.weekLabel}" already holds ${preview.slipCount} slip(s). Importing "${preview.filename}" again keeps every existing row and adds only new ones.`}
          confirmLabel="Import again"
          busy={busy}
          onConfirm={doImport}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
