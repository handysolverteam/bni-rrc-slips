"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ChapterChooser, { initialChapterField, type ChapterCheckInfo } from "@/components/ChapterChooser";
import ConfirmDialog from "@/components/ConfirmDialog";
import NewMembersPicker from "@/components/NewMembersPicker";

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
  /** Valid rows not yet in the database / already imported (skipped). */
  newCount?: number;
  duplicateCount?: number;
  chapter?: ChapterCheckInfo;
  homeChapter?: string;
  newMembers?: string[];
  similar?: Record<string, string[]>;
  columns: string[];
  boldUsed: boolean;
  errors: string[];
  rowIssues: RowIssues;
};

/**
 * Shared import panel — identical UI on /import and /report:
 * multi-file picker, per-file preview cards (week, rows, bold,
 * typing-mistake rows), one confirmation when bad rows exist, per-file
 * results. Rows already imported for the week are flagged in the preview and
 * skipped on import (same-file repeats are still kept — owner rule).
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
  // Per file: the chapter picked in the chooser ("" = active) and the new
  // members un-ticked (not added to the home chapter).
  const [chapters, setChapters] = useState<Record<string, string>>({});
  const [skips, setSkips] = useState<Record<string, string[]>>({});
  // Per file: { new name: existing member it is the same person as }.
  const [mergePicks, setMergePicks] = useState<Record<string, Record<string, string>>>({});
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

  async function previewOne(f: File, chapter = ""): Promise<Preview | null> {
    const fd = new FormData();
    fd.append("file", f);
    if (chapter) fd.append("chapter", chapter);
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
    const chosen: Record<string, string> = {};
    for (const f of list) {
      let p = await previewOne(f);
      // A file for another/unclear chapter starts from the best guess and is
      // recounted against it (the chooser lets the user change it).
      const init = p ? initialChapterField(p.chapter) : "";
      if (p && init) {
        const again = await previewOne(f, init);
        if (again) {
          p = again;
          chosen[f.name] = init;
        }
      }
      if (p) out.push(p);
    }
    setChapters(chosen);
    setSkips({});
    setMergePicks({});
    setPreviews(out);
    setReading(false);
  }

  // Only typing mistakes pause the import — already-imported rows are
  // skipped silently (they are shown in the preview, no confirmation).
  const nothingNew = (p: Preview) => (p.duplicateCount ?? 0) > 0 && (p.newCount ?? 1) <= 0;
  const badFiles = previews.filter((p) => p.rowIssues.skippedCount > 0);
  const needsConfirm = badFiles.length > 0;
  const done = results.filter((r) => r.kind === "success");
  const failed = results.filter((r) => r.kind === "error");

  async function chooseChapter(name: string, field: string) {
    const file = files.find((x) => x.name === name);
    if (!file) return;
    setChapters((c) => ({ ...c, [name]: field })); // the import uses this at once, even before the recount returns
    const again = await previewOne(file, field);
    if (!again) return;
    setChapters((c) => ({ ...c, [name]: field }));
    setSkips((s) => ({ ...s, [name]: [] }));
    setMergePicks((m) => ({ ...m, [name]: {} }));
    setPreviews((prev) => prev.map((x) => (x.filename === name ? again : x)));
  }

  // A new member is asked about ONCE: in the first file of the queue that lists
  // it (the import of that file creates it, so later files find it existing).
  function namesFor(p: Preview): string[] {
    const earlier = new Set<string>();
    for (const q of previews) {
      if (q.filename === p.filename) break;
      for (const n of q.newMembers ?? []) earlier.add(n);
    }
    return (p.newMembers ?? []).filter((n) => !earlier.has(n));
  }

  function removeFile(name: string) {
    setSkips((s) => {
      const { [name]: _drop, ...rest } = s;
      return rest;
    });
    setMergePicks((m) => {
      const { [name]: _drop, ...rest } = m;
      return rest;
    });
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
    let switchTo: string | null = null;
    for (const p of previews) {
      const file = byName.get(p.filename);
      if (!file) continue;
      if (nothingNew(p)) {
        // Every row is already in: no empty import batch, just say so.
        setResults((r) => [...r, { kind: "success", title: `${p.filename}: nothing new — all ${p.duplicateCount} row(s) already imported` }]);
        setPreviews((prev) => prev.filter((x) => x.filename !== p.filename));
        setFiles((prev) => prev.filter((x) => x.name !== p.filename));
        continue;
      }
      let ok = false;
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (chapters[p.filename]) fd.append("chapter", chapters[p.filename]);
        // Choices made on a name apply to every file that contains it.
        fd.append("skipMembers", JSON.stringify(Object.values(skips).flat()));
        const allMerges = Object.assign({}, ...Object.values(mergePicks));
        if (Object.keys(allMerges).length > 0) fd.append("mergeMembers", JSON.stringify(allMerges));
        const res = await fetch("/api/import/report", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResults((r) => [...r, { kind: "error", title: `${p.filename}: import failed`, detail: data.error ?? `Server returned status ${res.status}` }]);
        } else {
          ok = true;
          if (data.tenantId && p.chapter && data.tenantId !== p.chapter.active.id) switchTo = data.tenantId;
          const bits = [
            `+${data.importedCount ?? 0} into ${data.bniWeek ?? p.weekLabel}`,
            data.skippedCount ? `${data.skippedCount} skipped` : "",
            data.boldUsed ? "bold applied" : "",
            data.aliasesSaved ? `${data.aliasesSaved} merge(s) remembered` : "",
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
    if (switchTo) {
      // Imported into another / a new chapter: make it the active one.
      await fetch("/api/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: switchTo }),
      });
      window.location.reload();
      return;
    }
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
              {p.chapter ? (
                <ChapterChooser
                  key={p.filename}
                  check={p.chapter}
                  disabled={busy}
                  onChange={(f) => void chooseChapter(p.filename, f)}
                />
              ) : null}
              <NewMembersPicker
                names={namesFor(p)}
                homeChapter={p.homeChapter ?? "the home chapter"}
                skipped={skips[p.filename] ?? []}
                merges={mergePicks[p.filename] ?? {}}
                similar={p.similar}
                disabled={busy}
                onChange={(s) => setSkips((prev) => ({ ...prev, [p.filename]: s }))}
                onMerge={(n, into) =>
                  setMergePicks((prev) => {
                    const cur = { ...(prev[p.filename] ?? {}) };
                    if (into) cur[n] = into;
                    else delete cur[n];
                    return { ...prev, [p.filename]: cur };
                  })
                }
              />
              {p.weekExists && p.slipCount > 0 ? (
                <p className="preview-note">
                  Week already holds {p.slipCount} slip(s) —{" "}
                  {(p.duplicateCount ?? 0) > 0
                    ? `${p.duplicateCount} row(s) in this file are already imported and will be skipped; ${p.newCount ?? 0} new row(s) will be imported.`
                    : "all rows in this file are new and will be imported."}
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

        <button className="primary btn-block" disabled={busy || reading || files.length === 0 || previews.length === 0 || previews.every(nothingNew)} type="submit">
          {busy ? "Importing..." : reading ? "Reading…" : previews.length > 0 && previews.every(nothingNew) ? "Nothing new to import" : files.length > 1 ? `Import ${files.length} files` : "Import"}
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
