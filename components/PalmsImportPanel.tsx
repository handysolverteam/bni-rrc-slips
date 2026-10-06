"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";

type Mismatch = { label: string; palms: number; slips: number };
type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; text: string }
  | { kind: "mismatch"; text: string; items: Mismatch[] }
  | { kind: "err"; text: string };

export type PalmsRecord = { filename: string; importedAt: string };

const fmt = (v: number): string => (Number.isInteger(v) && Math.abs(v) >= 10000 ? v.toLocaleString("en-IN") : String(v));

/**
 * Upload for BNI's `Chapter Summary PALMS Report` (.xls/.xlsx): the meeting
 * attendance columns P A L M S + T for a single meeting date (From = To).
 * The meeting's slips must be imported first. After the import the response's
 * `comparison` verdict (PALMS Total row vs this week's slips) is shown at once.
 *
 * On `/summary` the page passes `removeWeekId` (single-week scope with
 * attendance) + the current import `record`: the panel then shows which file
 * was imported and offers a **Remove PALMS summary** action (attendance +
 * comparison stats of that week — the slips import stays).
 */
export default function PalmsImportPanel({
  onImported,
  removeWeekId,
  record,
}: {
  onImported?: () => void;
  removeWeekId?: string | null;
  record?: PalmsRecord | null;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const router = useRouter();

  async function remove() {
    if (!removeWeekId || removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/import/palms?week=${encodeURIComponent(removeWeekId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setState({ kind: "err", text: data?.error ?? "Remove failed." });
        setConfirming(false);
        return;
      }
      setConfirming(false);
      setState({ kind: "ok", text: "PALMS summary removed — the slips import stays." });
      onImported?.();
      router.refresh();
    } catch (err) {
      setState({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
      setConfirming(false);
    } finally {
      setRemoving(false);
    }
  }

  async function upload(file: File) {
    if (state.kind === "busy") return;
    setState({ kind: "busy" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/palms", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setState({ kind: "err", text: data?.error ?? "Import failed." });
        return;
      }
      const base = `Imported ${data.importedCount} member(s) for ${data.weekLabel}${
        data.replacedCount ? ` (replaced ${data.replacedCount} existing row(s))` : ""
      }.`;
      const cmp = data.comparison as
        | { rows: { label: string; palms: number; slips: number; match: boolean }[]; allMatch: boolean }
        | null
        | undefined;
      if (cmp && !cmp.allMatch) {
        setState({
          kind: "mismatch",
          text: `${base} The PALMS counts do NOT match this week's imported slips:`,
          items: cmp.rows
            .filter((r) => !r.match)
            .map((r) => ({ label: r.label, palms: r.palms, slips: r.slips })),
        });
      } else if (cmp) {
        setState({ kind: "ok", text: `${base} PALMS counts match the imported slips.` });
      } else {
        setState({ kind: "ok", text: base });
      }
      onImported?.();
      router.refresh();
    } catch (err) {
      setState({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    }
  }

  return (
    <div className="card">
      <div className="import-head">
        <h2>Chapter Summary PALMS (attendance)</h2>
        {removeWeekId ? (
          <div className="import-head-actions">
            <button
              type="button"
              className="danger"
              disabled={removing || state.kind === "busy"}
              onClick={() => setConfirming(true)}
            >
              Remove PALMS summary
            </button>
          </div>
        ) : null}
      </div>
      {record ? (
        <p className="muted">
          Imported {record.filename}
          {record.importedAt ? ` on ${new Date(record.importedAt).toLocaleString()}` : ""}
        </p>
      ) : null}
      <form>
        <label className="field">
          Chapter Summary PALMS Report (.xls / .xlsx — single meeting date; import that week&apos;s
          slips first)
          <input
            type="file"
            accept=".xls,.xlsx"
            required
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </form>
      {state.kind === "busy" ? <p className="muted">Importing…</p> : null}
      {state.kind === "ok" ? <div className="data-alert ok">{state.text}</div> : null}
      {state.kind === "mismatch" ? (
        <div className="data-alert bad" role="alert">
          <span className="alert-title">PALMS vs slips mismatch</span>
          <span>{state.text}</span>
          <ul>
            {state.items.map((m) => (
              <li key={m.label}>
                {m.label}: PALMS {fmt(m.palms)} vs slips {fmt(m.slips)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.kind === "err" ? <p className="preview-warn">{state.text}</p> : null}
      {confirming && removeWeekId ? (
        <ConfirmDialog
          title="Remove PALMS summary?"
          message="Delete this week's imported PALMS attendance and its comparison totals? The slips import and every other import stay."
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
