"use client";

import { useState } from "react";
import ExportNameDialog from "@/components/ExportNameDialog";
import { attendanceDefaultName } from "@/lib/export-name";

const FORMATS = ["xlsx", "csv", "pdf"] as const;

type PalmsExportJson = {
  filename: string;
  weekLabel: string;
  memberCount: number;
  headers: string[];
  rows: string[][];
  totalRow: string[] | null;
};

export default function PalmsExportButtons({
  weekId,
  scopeLabel,
}: {
  weekId: string;
  scopeLabel: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ format: string; name: string } | null>(null);

  function downloadViaNavigation(endpoint: string, filename: string) {
    // Fallback path: top-level navigation download (bypasses fetch hooks).
    const a = document.createElement("a");
    a.href = endpoint;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadPdf(fileName: string) {
    // Same byte-swallowing workaround as the report: build the PDF here
    // from JSON data, which passes through untouched.
    const endpoint = buildEndpoint("json");
    const res = await fetch(endpoint);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `server returned ${res.status}`);
    }
    const data = (await res.json()) as PalmsExportJson;
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Attendance — ${data.weekLabel}`, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    doc.text(`Members: ${data.memberCount}`, 40, 54);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: 58,
      head: [data.headers],
      body: data.rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [214, 84, 44], textColor: 255 },
    });
    doc.save(`${fileName}.pdf`);
  }

  function buildEndpoint(format: string): string {
    const current = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const [k, v] of current.entries()) {
      if (k === "page" || k === "format" || k === "debug" || k === "tab") continue;
      if (v) params.set(k, v);
    }
    if (!params.get("week") && weekId) params.set("week", weekId);
    return `/api/palms/export?${params.toString()}&format=${format}`;
  }

  /** Opens the file-name modal, prefilled from the week scope on screen. */
  function ask(format: string) {
    if (busy || !weekId) return;
    setAsking({ format, name: attendanceDefaultName({ scopeLabel }) });
  }

  async function download(format: string, fileName: string) {
    if (busy || !weekId) return;
    setBusy(format);
    setError(null);
    const endpoint = buildEndpoint(format);
    try {
      if (format === "pdf") {
        await downloadPdf(fileName);
        return;
      }
      const res = await fetch(endpoint);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `server returned ${res.status}`);
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        downloadViaNavigation(endpoint, `${fileName}.${format}`);
        return;
      }
      const filename = `${fileName}.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "download failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="report-actions">
      <span className="export-title">Export</span>
      <span className="seg-group">
        {FORMATS.map((f) => (
          <button key={f} type="button" disabled={busy !== null} onClick={() => ask(f)}>
            {busy === f ? "Preparing…" : f.toUpperCase()}
          </button>
        ))}
      </span>
      {error ? <span className="preview-warn">Export failed: {error}</span> : null}
      {asking ? (
        <ExportNameDialog
          defaultName={asking.name}
          ext={asking.format}
          onCancel={() => setAsking(null)}
          onConfirm={(name) => {
            const f = asking.format;
            setAsking(null);
            void download(f, name);
          }}
        />
      ) : null}
    </div>
  );
}
