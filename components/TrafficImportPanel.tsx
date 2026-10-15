"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";

type Report = { from: string; to: string; members: number; sponsors: number; hasPalms: boolean; hasSponsorReport: boolean };

const day = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Upload for the two BNI reports behind the Traffic Lights screen: the Chapter Summary PALMS Report and the Chapter
 * Sponsor Report (several files at once; the type is recognised from each file). Importing a range again replaces it.
 * Lists the imported ranges with a Remove button.
 */
export default function TrafficImportPanel() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ ok: boolean; text: string }[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [confirm, setConfirm] = useState<Report | null>(null);
  const [removing, setRemoving] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/import/traffic", { cache: "no-store" });
      const data = await res.json();
      setReports(data.reports ?? []);
      setNeedsMigration(!!data.needsMigration);
    } catch {
      /* the list is a convenience; the import itself reports errors */
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    const out: { ok: boolean; text: string }[] = [];
    for (const file of files) {
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/import/traffic", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) out.push({ ok: false, text: `${file.name}: ${data?.error ?? "import failed"}` });
        else
          out.push({
            ok: true,
            text: `${file.name}: ${data.kind === "palms" ? "PALMS report" : "Sponsor report"} ${day(data.from)} – ${day(data.to)} imported (${data.count} ${data.kind === "palms" ? "member(s)" : "sponsored"})`,
          });
      } catch (e) {
        out.push({ ok: false, text: `${file.name}: ${e instanceof Error ? e.message : "network error"}` });
      }
    }
    setResults(out);
    setFiles([]);
    setInputKey((k) => k + 1);
    setBusy(false);
    await refresh();
    router.refresh();
  }

  async function remove() {
    if (!confirm) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/import/traffic?from=${confirm.from}&to=${confirm.to}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResults([{ ok: false, text: data?.error ?? "Remove failed." }]);
      } else setResults([{ ok: true, text: `Removed ${day(confirm.from)} – ${day(confirm.to)}.` }]);
    } finally {
      setRemoving(false);
      setConfirm(null);
      await refresh();
      router.refresh();
    }
  }

  return (
    <div className="card">
      <div className="import-head">
        <h2>Traffic Lights reports (BNI)</h2>
      </div>
      <p className="muted">
        Upload BNI&apos;s <b>Chapter Summary PALMS Report</b> and <b>Chapter Sponsor Report</b> for the same From–To range (.xls / .xlsx, both
        at once is fine). The Traffic Lights screen is built from these two files. Importing a range again replaces it.
      </p>
      {needsMigration ? (
        <div className="data-alert">Run supabase/migrations/010_traffic_reports.sql in the Supabase SQL editor first, then import.</div>
      ) : null}
      <label className="field">
        <span>Report files</span>
        <input
          key={inputKey}
          type="file"
          accept=".xls,.xlsx"
          multiple
          disabled={busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </label>
      <button type="button" className="primary btn-block" disabled={busy || files.length === 0} onClick={upload}>
        {busy ? "Importing…" : files.length > 1 ? `Import ${files.length} files` : "Import"}
      </button>
      {results.map((r, i) =>
        r.ok ? (
          <div key={i} className="data-alert ok">
            {r.text}
          </div>
        ) : (
          <p key={i} className="preview-warn">
            {r.text}
          </p>
        ),
      )}
      {reports.length > 0 ? (
        <div className="table-card">
          <div className="table-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Range</th>
                  <th>PALMS report</th>
                  <th>Sponsor report</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={`${r.from}_${r.to}`}>
                    <td>
                      {day(r.from)} – {day(r.to)}
                    </td>
                    <td>{r.hasPalms ? `${r.members} member(s)` : "— not imported"}</td>
                    <td>{r.hasSponsorReport ? `${r.sponsors} sponsored` : "— not imported (sponsors score 0)"}</td>
                    <td>
                      <button type="button" className="danger" onClick={() => setConfirm(r)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title="Remove this range?"
          message={`Remove the PALMS and Sponsor reports for ${day(confirm.from)} – ${day(confirm.to)}? The Traffic Lights screen will no longer show this range.`}
          confirmLabel="Remove"
          danger
          busy={removing}
          onConfirm={remove}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}
