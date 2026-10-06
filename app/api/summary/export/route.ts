import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fetchPalmsComparisons } from "@/lib/palms-compare";
import { getCachedWeekOptions } from "@/lib/server-weeks";
import { SUMMARY_COLS, fetchChapterSummary, summaryCell } from "@/lib/summary-view";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const FORMATS = ["xlsx", "csv", "pdf", "json"];

function safeFilePart(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "summary";
}

const fmtMetric = (key: string, v: number): string =>
  key === "tyfcb" ? v.toLocaleString("en-IN") : String(v);

/** Chapter Summary export: the /summary screen as xlsx / csv / pdf (json feeds the in-browser PDF). */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();

    const url = new URL(request.url);
    const weekId = url.searchParams.get("week") ?? "";
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
    if (!weekId) return Response.json({ error: "week is required" }, { status: 400 });
    if (!FORMATS.includes(format)) {
      return Response.json({ error: "format must be xlsx, csv, pdf or json" }, { status: 400 });
    }
    const allWeeks = weekId === "all";
    const weekIds = allWeeks ? [] : weekId.split(",").map((s) => s.trim()).filter(Boolean);
    if (!allWeeks && weekIds.length === 0) {
      return Response.json({ error: "week is required" }, { status: 400 });
    }

    const [weeks, summary, comparisons] = await Promise.all([
      getCachedWeekOptions(ctx.tenantId),
      fetchChapterSummary(ctx.tenantId, weekIds),
      fetchPalmsComparisons(ctx.tenantId, weekIds),
    ]);
    // Same scope label the screen shows under the title.
    const active = weekIds
      .map((id) => weeks.find((w) => w.id === id))
      .filter((w): w is (typeof weeks)[number] => w !== undefined);
    const weekLabel = allWeeks
      ? "All weeks"
      : active.length > 3
        ? `${active.length} meetings`
        : active.length > 0
          ? active.map((w) => w.label).join(" + ")
          : "week";

    const headers = ["Member", ...SUMMARY_COLS.map((c) => c.label)];
    const rows = summary.rows.map((r) => [
      r.name,
      ...SUMMARY_COLS.map((c) => summaryCell(c.get(r), c.money)),
    ]);
    const totalRow =
      summary.rows.length > 0
        ? ["Total", ...SUMMARY_COLS.map((c) => summaryCell(c.total(summary.totals), c.money))]
        : null;

    // PALMS-vs-slips block — same rows as the screen's comparison table.
    const multi = comparisons.length > 1;
    const cmpHeaders = [...(multi ? ["Week"] : []), "Metric", "PALMS", "Slips", "Status"];
    const cmpRows: string[][] = comparisons.flatMap((c) =>
      c.rows.map((r) => [
        ...(multi ? [c.weekLabel] : []),
        r.label,
        fmtMetric(r.key, r.palms),
        fmtMetric(r.key, r.slips),
        r.match ? "Match" : "MISMATCH",
      ]),
    );
    const cmpTitle = `PALMS vs slips${multi ? ` — ${comparisons.length} weeks` : ""}`;

    const base = `chapter-summary-${safeFilePart(weekLabel)}`;

    if (format === "json") {
      return Response.json({
        filename: `${base}.pdf`,
        weekLabel,
        memberCount: summary.rows.length,
        headers,
        rows,
        totalRow,
        comparison: cmpRows.length > 0 ? { title: cmpTitle, headers: cmpHeaders, rows: cmpRows } : null,
      });
    }

    if (format === "csv") {
      const cell = (v: string) => JSON.stringify(v);
      const lines = [
        `Week,${JSON.stringify(weekLabel)}`,
        `Members,${String(summary.rows.length)}`,
        "",
        headers.map(cell).join(","),
      ];
      for (const r of rows) lines.push(r.map(cell).join(","));
      if (totalRow) lines.push(totalRow.map(cell).join(","));
      if (cmpRows.length > 0) {
        lines.push("", cmpTitle, cmpHeaders.join(","));
        for (const r of cmpRows) lines.push(r.map(cell).join(","));
      }
      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${base}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        [`Chapter Summary — ${weekLabel}`],
        [`Members: ${summary.rows.length}`],
        headers,
        ...rows,
        ...(totalRow ? [totalRow] : []),
      ]);
      ws["!cols"] = [{ wch: 26 }, ...SUMMARY_COLS.map((c) => ({ wch: c.money ? 12 : 7 }))];
      XLSX.utils.book_append_sheet(wb, ws, "Chapter Summary");
      if (cmpRows.length > 0) {
        const ws2 = XLSX.utils.aoa_to_sheet([[cmpTitle], cmpHeaders, ...cmpRows]);
        ws2["!cols"] = [
          ...(multi ? [{ wch: 26 }] : []),
          { wch: 9 },
          { wch: 12 },
          { wch: 12 },
          { wch: 10 },
        ];
        XLSX.utils.book_append_sheet(wb, ws2, "PALMS vs slips");
      }
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        },
      });
    }

    // pdf — server path for API/tests; the browser builds its own from json.
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Chapter Summary — ${weekLabel}`, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    doc.text(`Members: ${summary.rows.length}`, 40, 54);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: 58,
      head: [headers],
      body: totalRow && rows.length > 0 ? [...rows, totalRow] : rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [214, 84, 44], textColor: 255 },
      didParseCell: (d) => {
        // Total row prints bold (same as the screen's tfoot).
        if (d.section === "body" && totalRow && d.row.index === rows.length) {
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    if (cmpRows.length > 0) {
      // Title only — the styled table below repeats its own header on every
      // page, so no plain-text column-header row above it.
      autoTable(doc, {
        head: [[cmpTitle]],
        theme: "plain",
        styles: { fontStyle: "bold" },
      });
      autoTable(doc, {
        head: [cmpHeaders],
        body: cmpRows,
        styles: { fontSize: 7 },
        headStyles: { fillColor: [214, 84, 44], textColor: 255 },
        didParseCell: (d) => {
          if (d.section === "body" && String(d.cell.raw) === "MISMATCH") {
            d.cell.styles.fontStyle = "bold";
            d.cell.styles.textColor = [193, 60, 48];
          }
        },
      });
    }
    const pdf = Buffer.from(doc.output("arraybuffer"));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Export failed." },
      { status: 500 },
    );
  }
}
