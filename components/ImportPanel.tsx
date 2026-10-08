"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";

type Result = {
  kind: "success" | "error";
  title: string;
  detail?: string;
  errors?: string[];
  warning?: string;
};

type RowIssues = {
  skippedCount: number;
  skippedSamples: string[];
  warningCount: number;
  warningSamples: string[];
};

type Preview = {
  filename: string;
  reportDate: string;
  meetingDate: string;
  weekLabel: string;
  weekExists: boolean;
  weekId: string | null;
  slipCount: number;
  counts: Record<string, number>;
  rowCount: number;
  columns: string[];
  boldUsed: boolean;
  errors: string[];
  rowIssues: RowIssues;
};

/**
 * Shared import panel — identical UI on /import and /report:
 * multi-file picker, per-file preview cards (week, rows, bold,
 * typing-mistake rows), one confirmation when bad rows exist, per-file
 * results. Duplicates are never flagged: every entry is imported as-is.
 * variant "card": self-contained card with its own head (/import page and /report).
 * variant "toolbar": solid accent button + dropdown panel — available for a
 * toolbar next to other actions (currently unused).
 */
export default function ImportPanel({
  title = "Import Report XLS",
  headingLevel = "h2",
  defaultCollapsed = false,
  variant = "card",
  onImported,
}: {
  title?: string;
  headingLevel?: "h1" | "h2";
  defaultCollapsed?: boolean;
  variant?: "card" | "toolbar";
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Toolbar variant behaves like a menu: clicking outside closes it.
  useEffect(() => {
    if (!open || variant !== "toolbar") return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, variant]);

  useEffect(() => {
    if (results.length === 0) return;
    const timer = setTimeout(() => setResults([]), 15000);
    return () => clearTimeout(timer);
  }, [results]);

  async function previewOne(f: File): Promise<Preview | null> {
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setResults((r) => [...r, { kind: "error", title: `${f.name}: could not read file`, detail: data.error ?? "Preview failed." }]);
        return null;
      }
      return {
        ...data,
        filename: f.name,
        rowIssues: data.rowIssues ?? { skippedCount: 0, skippedSamples: [], warningCount: 0, warningSamples: [] },
        counts: data.counts ?? {},
      };
    } catch (err) {
      setResults((r) => [...r, { kind: "error", title: `${f.name}: could not read file`, detail: err instanceof Error ? err.message : "Network error" }]);
      return null;
    }
  }

  async function pickFiles(list: File[]) {
    setFiles(list);
    setPreviews([]);
    setResults([]);
    if (list.length === 0) return;
    setReading(true);
    const out: Preview[] = [];
    for (const f of list) {
      const p = await previewOne(f);
      if (p) out.push(p);
    }
    setPreviews(out);
    setReading(false);
  }

  // Only typing mistakes pause the import — duplicate entries are
  // correct and never ask for confirmation (owner rule).
  const badFiles = previews.filter((p) => p.rowIssues.skippedCount > 0);
  const needsConfirm = badFiles.length > 0;
  const done = results.filter((r) => r.kind === "success");
  const failed = results.filter((r) => r.kind === "error");

  function removeFile(name: string) {
    setFiles((f) => f.filter((x) => x.name !== name));
    setPreviews((p) => p.filter((x) => x.filename !== name));
  }

  function dismissResult(title: string) {
    setResults((r) => r.filter((x) => x.title !== title));
  }

  function confirmMessage(): string {
    return (
      badFiles
        .map((p) => `"${p.filename}" has ${p.rowIssues.skippedCount} bad row(s) (${p.rowIssues.skippedSamples.join("; ")})`)
        .join("; ") + ". Those rows will be skipped — import the rest?"
    );
  }

  async function doImport() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setConfirming(false);
    setResults([]);

    const byName = new Map(files.map((f) => [f.name, f]));
    for (const p of previews) {
      const file = byName.get(p.filename);
      if (!file) continue;
      let ok = false;
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/import/report", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResults((r) => [...r, { kind: "error", title: `${p.filename}: import failed`, detail: data.error ?? `Server returned status ${res.status}` }]);
        } else {
          ok = true;
          const bits = [
            `+${data.importedCount ?? 0} into ${data.bniWeek ?? p.weekLabel}`,
            data.skippedCount ? `${data.skippedCount} skipped` : "",
            data.boldUsed ? "bold applied" : "",
          ].filter(Boolean);
          setResults((r) => [...r, {
            kind: "success",
            title: `${p.filename}: ${bits.join(" · ")}`,
            errors: Array.isArray(data.errors) && data.errors.length > 0 ? data.errors : undefined,
            warning: typeof data.warning === "string" ? data.warning : undefined,
          }]);
        }
      } catch (err) {
        setResults((r) => [...r, { kind: "error", title: `${p.filename}: import failed`, detail: err instanceof Error ? err.message : "Network error" }]);
      }
      // Imported files leave the queue at once: drop the preview card into
      // the Imported list below and reflect the new data straight away.
      // Failed files stay queued for retry.
      if (ok) {
        setPreviews((prev) => prev.filter((x) => x.filename !== p.filename));
        setFiles((prev) => prev.filter((x) => x.name !== p.filename));
        router.refresh();
      }
    }
    setBusy(false);
    onImported?.();
    router.refresh();
    onImported?.();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Typing mistakes (bad rows): pause and ask before importing.
    if (needsConfirm) {
      setConfirming(true);
      return;
    }
    doImport();
  }

  const body = open ? (
      <>
      <form onSubmit={submit}>
        <label className="field">
          Report files (.xls / .xlsx / .csv, multiple allowed)
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            multiple
            required
            onChange={(e) => pickFiles([...(e.target.files ?? [])])}
          />
        </label>

        {reading ? <p className="muted">Reading files…</p> : null}

          {previews.map((p) => (
            <div key={p.filename} className={`preview-card ${p.rowIssues.skippedCount > 0 ? "warn" : "ok"}`}>
              <div className="preview-head">
                <strong>{p.filename}</strong>
                <button
                  type="button"
                  className="mini-x"
                  aria-label={`Remove ${p.filename}`}
                  title="Remove this file"
                  onClick={() => removeFile(p.filename)}
                >
                  ✕
                </button>
              </div>
            <p className="muted">
              {p.weekLabel} · {p.rowCount} row(s)
              {p.boldUsed ? " · bold chapter info found" : ""}
            </p>
              {p.weekExists && p.slipCount > 0 ? (
                <p className="preview-note">
                  Week already holds {p.slipCount} slip(s) — every row in this file is imported (duplicates are kept).
                </p>
              ) : (
                <p className="preview-ok">New week — nothing imported yet.</p>
              )}
              {p.rowIssues.skippedCount > 0 ? (
                <p className="preview-warn">
                  {p.rowIssues.skippedCount} bad row(s) will be skipped
                  ({p.rowIssues.skippedSamples.join("; ")}).
                </p>
              ) : null}
              {p.rowIssues.warningCount > 0 ? (
                <p className="preview-note">
                  {p.rowIssues.warningCount} row(s) import with defaults
                  ({p.rowIssues.warningSamples.join("; ")}).
                </p>
              ) : null}
          </div>
        ))}

        <button className="primary btn-block" disabled={busy || reading || files.length === 0 || previews.length === 0} type="submit">
          {busy ? "Importing..." : reading ? "Reading…" : files.length > 1 ? `Import ${files.length} files` : "Import"}
        </button>
      </form>

      {done.length > 0 ? (
        <div className="done-list">
          <div className="done-head">
            <strong>Imported</strong>
            <button
              type="button"
              className="mini-x"
              aria-label="Dismiss all imported files"
              title="Dismiss all"
              onClick={() => setResults((r) => r.filter((x) => x.kind !== "success"))}
            >
              ✕
            </button>
          </div>
          <ul>
            {done.map((n) => (
              <li key={n.title}>
                <span className="done-tick">✓</span> {n.title}
                {n.warning ? (
                  <p className="preview-warn" role="alert">
                    {n.warning}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mini-x"
                  aria-label={`Dismiss ${n.title}`}
                  onClick={() => dismissResult(n.title)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="toast-stack">
          {failed.map((n) => (
            <div key={n.title} className={`toast ${n.kind}`} role="alert">
          <div>
            <strong>{n.title}</strong>
            {n.detail ? <p className="muted">{n.detail}</p> : null}
            {n.errors && n.errors.length > 0 ? (
              <details>
                <summary>Row issues ({n.errors.length})</summary>
                <ul>
                  {n.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <button type="button" onClick={() => dismissResult(n.title)}>
            Dismiss
          </button>
          </div>
          ))}
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Import with skipped rows?"
          message={confirmMessage()}
          confirmLabel={files.length > 1 ? `Import ${files.length} files` : "Import"}
          busy={busy}
          onConfirm={doImport}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      </>
  ) : null;

  if (variant === "toolbar") {
    return (
      <div className="import-toolbar" ref={wrapRef}>
        <button
          type="button"
          className="import-open"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "✕ Close" : "+ Import files"}
        </button>
        {open ? <div className="import-pop">{body}</div> : null}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="import-head">
        {headingLevel === "h2" ? <h2>{title}</h2> : <h1>{title}</h1>}
        <button
          type="button"
          className="import-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "− Minimize" : "+ Import files"}
        </button>
      </div>
      {body}
    </div>
  );
}
