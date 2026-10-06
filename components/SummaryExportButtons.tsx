"use client";

import { useState } from "react";

const FORMATS = ["xlsx", "csv", "pdf"] as const;

type SummaryExportJson = {
  filename: string;
  weekLabel: string;
  memberCount: number;
  headers: string[];
  rows: string[][];
  totalRow: string[] | null;
};

export default function SummaryExportButtons({
  weekId,
  scopeLabel,
}: {
  weekId: string;
  scopeLabel: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopePart = scopeLabel
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fallbackName = (format: string) =>
    `chapter-summary-${scopePart || "summary"}.${format}`;

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

  async function downloadPdf() {
    // Same byte-swallowing workaround as the report: build the PDF here
    // from JSON data, which passes through untouched.
    const endpoint = buildEndpoint("json");
    const res = await fetch(endpoint);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `server returned ${res.status}`);
    }
    const data = (await res.json()) as SummaryExportJson;
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Chapter Summary — ${data.weekLabel}`, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    doc.text(`Members: ${data.memberCount}`, 40, 54);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: 58,
      head: [data.headers],
      body: data.totalRow && data.rows.length > 0 ? [...data.rows, data.totalRow] : data.rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [214, 84, 44], textColor: 255 },
      didParseCell: (d) => {
        if (d.section === "body" && data.totalRow && d.row.index === data.rows.length) {
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    doc.save(data.filename);
  }

  function buildEndpoint(format: string): string {
    const current = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const [k, v] of current.entries()) {
      if (k === "page" || k === "format" || k === "debug" || k === "tab") continue;
      if (v) params.set(k, v);
    }
    if (!params.get("week") && weekId) params.set("week", weekId);
    return `/api/summary/export?${params.toString()}&format=${format}`;
  }

  async function download(format: string) {
    if (busy || !weekId) return;
    setBusy(format);
    setError(null);
    const endpoint = buildEndpoint(format);
    try {
      if (format === "pdf") {
        await downloadPdf();
        return;
      }
      const res = await fetch(endpoint);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `server returned ${res.status}`);
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        downloadViaNavigation(endpoint, fallbackName(format));
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = nameMatch ? nameMatch[1] : `chapter-summary.${format}`;
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
          <button key={f} type="button" disabled={busy !== null} onClick={() => download(f)}>
            {busy === f ? "Preparing…" : f.toUpperCase()}
          </button>
        ))}
      </span>
      {error ? <span className="preview-warn">Export failed: {error}</span> : null}
    </div>
  );
}
