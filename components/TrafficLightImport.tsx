"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Result = { month: string; filename: string; rows: number; matched: number; unmatched: string[] };

/**
 * Import / remove BNI's "Member Traffic Lights" Excel for a report month. It supplies the Visitors and
 * Sponsors the slips cannot, plus BNI's own total as a reference. Re-importing a month replaces it.
 */
export default function TrafficLightImport({
  month,
  hasBni,
  filename,
  tableReady,
}: {
  month: string;
  hasBni: boolean;
  filename: string | null;
  tableReady: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [, startTransition] = useTransition();

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/traffic-lights/import", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json as Result);
      startTransition(() => router.push(`/traffic-lights?month=${(json as Result).month}`));
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm(`Remove the imported BNI file for ${month}? Visitors and Sponsors go back to the slips (sponsors 0).`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/traffic-lights/import?month=${month}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(null);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tl-import">
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Working…" : hasBni ? "Replace BNI Excel" : "Import BNI Excel"}
      </button>
      {hasBni ? (
        <>
          <span className="muted">
            BNI file for this month{filename ? `: ${filename}` : ""}
          </span>
          <button type="button" disabled={busy} onClick={remove}>
            Remove
          </button>
        </>
      ) : (
        <span className="muted">
          {tableReady
            ? "No BNI file for this month — visitors come from the slips and sponsors count 0."
            : "BNI import needs migration 010 (run supabase/migrations/010_traffic_lights.sql once)."}
        </span>
      )}
      {error ? <span className="cat-state bad">{error}</span> : null}
      {result ? (
        <span className="muted">
          Imported {result.rows} rows for {result.month}; {result.matched} matched to members
          {result.unmatched.length > 0 ? `, not matched: ${result.unmatched.join(", ")}` : ""}.
        </span>
      ) : null}
    </div>
  );
}
