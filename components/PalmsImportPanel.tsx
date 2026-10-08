"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";

type Preview = {
  filename: string;
  from: string | null;
  to: string | null;
  memberCount: number;
  weeksMatched: number;
  weeksUnknown: string[];
  cellTotal: number;
  cellNew: number;
  cellSkipped: number;
  skippedSamples: string[];
  issues: string[];
};

type State =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "preview"; preview: Preview }
  | { kind: "busy" }
  | { kind: "ok"; text: string }
  | { kind: "err"; text: string };

export type PalmsRecord = { filename: string; importedAt: string };

/**
 * Upload for BNI's wide `PALMS Attendance Report` (.xls/.xlsx) — one file
 * covering ~6 months, one cell per member per Wednesday (P A M S L letters).
 * Two-step flow: picking a file only runs the DRY-RUN preview (new vs
 * already-imported cells, unknown header dates) — the explicit **Import**
 * button starts the upload (choosing a file never imports by itself).
 * Cells that already exist are skipped, never replaced. Slips are never
 * involved: PALMS and the Slips Audit Report are independent imports.
 *
 * On `/palms` the page passes `hasData` + the current import `record`: the
 * panel then shows which file was imported and offers **Remove all PALMS
 * data** (attendance + PALMS batches — the slips import stays).
 */
export default function PalmsImportPanel({
  onImported,
  hasData = false,
  record,
}: {
  onImported?: () => void;
  hasData?: boolean;
  record?: PalmsRecord | null;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [picked, setPicked] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [open, setOpen] = useState(true);
  const router = useRouter();

  async function remove() {
    if (removing) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/import/palms", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setState({ kind: "err", text: data?.error ?? "Remove failed." });
        setConfirming(false);
        return;
      }
      setConfirming(false);
      setPicked(null);
      setState({ kind: "ok", text: "All PALMS data removed — the slips import stays." });
      onImported?.();
      router.refresh();
    } catch (err) {
      setState({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
      setConfirming(false);
    } finally {
      setRemoving(false);
    }
  }

  async function preview(file: File) {
    if (state.kind === "reading" || state.kind === "busy") return;
    setState({ kind: "reading" });
    setPicked(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/palms/preview", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setState({ kind: "err", text: data?.error ?? "Could not read the file." });
        return;
      }
      setState({ kind: "preview", preview: { ...data, filename: file.name } as Preview });
    } catch (err) {
      setState({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    }
  }

  async function upload() {
    if (state.kind !== "preview" || !picked || state.preview.cellNew === 0) return;
    setState({ kind: "busy" });
    try {
      const fd = new FormData();
      fd.append("file", picked);
      const res = await fetch("/api/import/palms", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setState({ kind: "err", text: data?.error ?? "Import failed." });
        return;
      }
      const bits = [
        `${data.importedCount} new cell(s)`,
        data.skippedCount ? `${data.skippedCount} already imported (skipped)` : "",
        `${data.weekCount} week(s)`,
      ].filter(Boolean);
      const unknown =
        Array.isArray(data.weeksUnknown) && data.weeksUnknown.length > 0
          ? ` — ${data.weeksUnknown.length} header date(s) not on the calendar were skipped`
          : "";
      setState({ kind: "ok", text: `Imported: ${bits.join(" · ")}${unknown}.` });
      setPicked(null);
      onImported?.();
      router.refresh();
    } catch (err) {
      setState({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    }
  }

  const previewing = state.kind === "reading" || state.kind === "preview";
  const pv = state.kind === "preview" ? state.preview : null;

  return (
    <div className="card">
      <div className="import-head">
        <h2>PALMS Report (6 months)</h2>
        <div className="import-head-actions">
          {hasData ? (
            <button
              type="button"
              className="danger"
              disabled={removing || state.kind === "busy" || state.kind === "reading"}
              onClick={() => setConfirming(true)}
            >
              Remove all PALMS data
            </button>
          ) : null}
          <button
            type="button"
            className="import-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "− Minimize" : "+ Import files"}
          </button>
        </div>
      </div>
      {open ? (
        <>
          {record ? (
            <p className="muted">
              Imported {record.filename}
              {record.importedAt ? ` on ${new Date(record.importedAt).toLocaleString()}` : ""}
            </p>
          ) : null}
          <form>
            <label className="field">
              PALMS Attendance Report (.xls / .xlsx — last ~6 months, one column per Wednesday)
              <input
                type="file"
                accept=".xls,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) preview(f);
                  e.target.value = "";
                }}
              />
            </label>

            {state.kind === "reading" ? <p className="muted">Reading file…</p> : null}

            {pv ? (
              <div className={`preview-card ${pv.cellSkipped > 0 || pv.weeksUnknown.length > 0 ? "warn" : "ok"}`}>
                <div className="preview-head">
                  <strong>{pv.filename}</strong>
                  <button
                    type="button"
                    className="mini-x"
                    aria-label={`Remove ${pv.filename}`}
                    title="Remove this file"
                    onClick={() => {
                      setPicked(null);
                      setState({ kind: "idle" });
                    }}
                  >
                    ✕
                  </button>
                </div>
                <p className="muted">
                  {pv.from} → {pv.to} · {pv.memberCount} member(s) · {pv.weeksMatched} week(s)
                </p>
                {pv.cellNew > 0 ? (
                  <p className="preview-ok">
                    {pv.cellNew} new cell(s) to import
                    {pv.cellSkipped > 0 ? `, ${pv.cellSkipped} already imported (will be skipped)` : ""}.
                  </p>
                ) : (
                  <p className="preview-note">All cells already imported — nothing new to import.</p>
                )}
                {pv.cellSkipped > 0 ? (
                  <p className="preview-warn">
                    Already imported ({pv.cellSkipped}): {pv.skippedSamples.join("; ")}
                    {pv.cellSkipped > pv.skippedSamples.length ? ", …" : ""}
                  </p>
                ) : null}
                {pv.weeksUnknown.length > 0 ? (
                  <p className="preview-warn">
                    {pv.weeksUnknown.length} header date(s) not on the Wednesday calendar will be skipped:{" "}
                    {pv.weeksUnknown.join(", ")}.
                  </p>
                ) : null}
                {pv.issues.length > 0 ? (
                  <details>
                    <summary>Cells with unknown values ({pv.issues.length})</summary>
                    <ul>
                      {pv.issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}

            {pv ? (
              <button
                type="button"
                className="primary btn-block"
                disabled={state.kind === "busy" || pv.cellNew === 0}
                onClick={upload}
              >
                {state.kind === "busy" ? "Importing…" : `Import ${pv.cellNew} new cell(s)`}
              </button>
            ) : (
              <button
                type="button"
                className="primary btn-block"
                disabled
              >
                {state.kind === "busy" ? "Importing…" : state.kind === "reading" ? "Reading file…" : "Choose a file to preview"}
              </button>
            )}
          </form>
          {state.kind === "ok" ? <div className="data-alert ok">{state.text}</div> : null}
          {state.kind === "err" ? <p className="preview-warn">{state.text}</p> : null}
        </>
      ) : null}
      {confirming && hasData ? (
        <ConfirmDialog
          title="Remove all PALMS data?"
          message="Delete every imported PALMS attendance cell for this chapter plus the batches those cells reference? The slips import and every other import stay."
          confirmLabel="Remove"
          danger
          busy={removing}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
