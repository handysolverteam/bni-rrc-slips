"use client";

import { useState } from "react";

const FORMATS = ["xlsx", "csv", "pdf"] as const;

// Section header fills — same palette as the screen (see globals.css).
const SECTION_FILL: Record<string, [number, number, number]> = {
  "One-to-One": [211, 84, 0],
  Referral: [46, 139, 87],
  TYFCB: [184, 134, 11],
  Visitor: [47, 111, 176],
};

export default function ReportExportButtons({
  weekId,
  tab,
  scopeLabel,
}: {
  weekId: string;
  tab: string;
  scopeLabel: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopePart = scopeLabel
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fallbackName = (format: string) =>
    `week-report-${scopePart || "data"}${tab === "all" ? "" : `-${tab}`}.${format}`;

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
    // PDF bytes get swallowed between this server and this browser (server
    // logs 200, browser sees 204) — so build the file here from JSON data,
    // which passes through untouched.
    // Every active filter (week, tab, search, per-table week and column
    // filters) is mirrored from the current URL so the file always
    // matches the screen.
    const current = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const [k, v] of current.entries()) {
      if (k === "page" || k === "format" || k === "debug") continue;
      if (v) params.set(k, v);
    }
    if (!params.get("week") && weekId) params.set("week", weekId);
    if (!params.get("tab")) params.set("tab", tab);
    const res = await fetch(
      `/api/report/export?${params.toString()}&format=json`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `server returned ${res.status}`);
    }
    const data = (await res.json()) as {
      filename: string;
      weekLabel: string;
      filterLine: string;
      summary: { rows: { section: string; count: number; info: string }[]; total: number };
      sections: { title: string; totalLabel: string; headers: string[]; keys: string[]; rows: string[][]; bold: [boolean, boolean][]; totalRow: string[] | null }[];
    };
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Week Report — ${data.weekLabel}`, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    const filterLines = doc.splitTextToSize(`Filters: ${data.filterLine}`, 760);
    doc.text(filterLines, 40, 54);
    doc.setTextColor(0, 0, 0);
    let first = true;
    // Summary first: stat-card section counts, same as xlsx/csv (no slips
    // grand total — that row is not part of the exported file).
    autoTable(doc, {
      startY: first ? 58 + filterLines.length * 10 : undefined,
      head: [["Summary", "", ""]],
      theme: "plain",
      styles: { fontStyle: "bold" },
    });
    autoTable(doc, {
      head: [["Section", "Count", "Details"]],
      body: data.summary.rows.map((r) => [r.section, String(r.count), r.info.replace(/₹/g, "Rs. ")]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [38, 50, 56], textColor: 255 },
    });
    first = false;
    for (const s of data.sections) {
      const headers = s.headers;
      // Column keys, not labels — section headers are renamed per report
      // ("Referral From", "Thanker", …) while the flags stay keyed from/to.
      const fromCol = s.keys.indexOf("from");
      const toCol = s.keys.indexOf("to");
      // Section title only — the styled table below repeats its own header
      // on every page, so no plain-text column-header row above it.
      autoTable(doc, {
        startY: first ? 58 + filterLines.length * 10 : undefined,
        head: [[`${s.title} (${s.rows.length})`]],
        theme: "plain",
        styles: { fontStyle: "bold" },
      });
      autoTable(doc, {
        head: [headers],
        // The built-in PDF font has no ₹ glyph, so print "Rs." there.
        body: [...s.rows, ...(s.totalRow ? [s.totalRow] : [])].map((r) => r.map((c) => c.replace(/₹/g, "Rs. "))),
        styles: { fontSize: 7 },
        headStyles: { fillColor: SECTION_FILL[s.title] ?? [193, 60, 48], textColor: 255 },
        // Outsider names (bold in the source file) print bold — every
        // section whose rows carry flags, not just referrals.
        didParseCell: (d) => {
          if (d.section !== "body") return;
          const flags = s.bold[d.row.index];
          if (!flags) return;
          if ((d.column.index === fromCol && flags[0]) || (d.column.index === toCol && flags[1])) {
            d.cell.styles.fontStyle = "bold";
          }
        },
      });
      first = false;
    }
    doc.save(data.filename);
  }

  async function download(format: string) {
    if (busy || !weekId) return;
    setBusy(format);
    setError(null);
    const current = new URLSearchParams(window.location.search);
    const endpointParams = new URLSearchParams();
    for (const [k, v] of current.entries()) {
      if (k === "page" || k === "format" || k === "debug") continue;
      if (v) endpointParams.set(k, v);
    }
    if (!endpointParams.get("week") && weekId) endpointParams.set("week", weekId);
    if (!endpointParams.get("tab")) endpointParams.set("tab", tab);
    const endpoint = `/api/report/export?${endpointParams.toString()}&format=${format}`;
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
        // Something between the server and this page emptied the reply
        // (curl proves the bytes leave the server intact) — retry as a
        // plain navigation download instead of failing silently.
        downloadViaNavigation(endpoint, fallbackName(format));
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = nameMatch ? nameMatch[1] : `week-report.${format}`;
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
