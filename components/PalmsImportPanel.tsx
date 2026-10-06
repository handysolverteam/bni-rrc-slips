"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mismatch = { label: string; palms: number; slips: number };
type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; text: string }
  | { kind: "mismatch"; text: string; items: Mismatch[] }
  | { kind: "err"; text: string };

const fmt = (v: number): string => (Number.isInteger(v) && Math.abs(v) >= 10000 ? v.toLocaleString("en-IN") : String(v));

/**
 * Upload for BNI's `Chapter Summary PALMS Report` (.xls/.xlsx): the meeting
 * attendance columns P A L M S + T for a single meeting date (From = To).
 * The meeting's slips must be imported first. After the import the response's
 * `comparison` verdict (PALMS Total row vs this week's slips) is shown at once.
 */
export default function PalmsImportPanel({ onImported }: { onImported?: () => void }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const router = useRouter();

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
      </div>
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
    </div>
  );
}
