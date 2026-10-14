"use client";

import { useState } from "react";
import ExportNameDialog from "@/components/ExportNameDialog";
import { trafficDefaultName } from "@/lib/export-name";

const FORMATS = ["xlsx", "csv", "pdf"] as const;

type ExportJson = {
  filename: string;
  title: string;
  window: string;
  memberCount: number;
  headers: string[];
  rows: string[][];
  colors: string[];
  filters: string[];
};

// Total Score cell colours in the PDF (same as the screen's dots).
const RGB: Record<string, [number, number, number]> = { green: [34, 197, 94], amber: [245, 158, 11], red: [239, 68, 68], grey: [156, 163, 175] };

/** Export the Traffic Lights table (what is on screen: report month + colour / name filters) as XLSX, CSV or PDF. */
export default function TrafficExportButtons({ month, light, nameFilter }: { month: string; light: string; nameFilter: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ format: string; name: string } | null>(null);

  function endpoint(format: string): string {
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (light) params.set("light", light);
    if (nameFilter) params.set("c_name", nameFilter);
    params.set("format", format);
    return `/api/traffic-lights/export?${params.toString()}`;
  }

  async function downloadPdf(fileName: string) {
    // Built here from JSON (same workaround as the other exports: binary responses can be swallowed by extensions).
    const res = await fetch(endpoint("json"));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `server returned ${res.status}`);
    const data = (await res.json()) as ExportJson;
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(12);
    doc.text(data.title, 40, 34);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    doc.text([data.window, `${data.memberCount} members`, ...data.filters].join(" · "), 40, 48);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: 54,
      head: [data.headers],
      body: data.rows,
      styles: { fontSize: 6, halign: "center" },
      headStyles: { fillColor: [214, 84, 44], textColor: 255 },
      columnStyles: { 0: { halign: "left" }, 1: { halign: "left" } },
      didParseCell: (h) => {
        if (h.section === "body" && h.column.index === 2) {
          const c = RGB[data.colors[h.row.index]];
          if (c) {
            h.cell.styles.fillColor = c;
            h.cell.styles.textColor = 255;
            h.cell.styles.fontStyle = "bold";
          }
        }
      },
    });
    doc.save(`${fileName}.pdf`);
  }

  async function download(format: string, fileName: string) {
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      if (format === "pdf") {
        await downloadPdf(fileName);
        return;
      }
      const res = await fetch(endpoint(format));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `server returned ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${fileName}.${format}`;
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
          <button
            key={f}
            type="button"
            disabled={busy !== null || !month}
            onClick={() => setAsking({ format: f, name: trafficDefaultName({ month, light, nameFilter }) })}
          >
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
