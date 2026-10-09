import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fetchPalmsMatrix, fetchPalmsWeekOptions, palmsWeekScope } from "@/lib/palms-view";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const FORMATS = ["xlsx", "csv", "pdf", "json"];

function safeFilePart(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
}

/** PALMS Report export: the /palms member × week matrix as xlsx / csv / pdf (json feeds the in-browser PDF). Cells identical to the screen. */
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
    const weekIds = palmsWeekScope(weekId);
    if (!allWeeks && weekIds.length === 0) {
      return Response.json({ error: "week is required" }, { status: 400 });
    }

    const [weeks, matrix] = await Promise.all([
      fetchPalmsWeekOptions(ctx.tenantId),
      fetchPalmsMatrix(ctx.tenantId, weekIds),
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

    const headers = ["Member", ...matrix.weeks.map((w) => w.header)];
    const rows = matrix.rows.map((r) => [r.name, ...r.cells]);

    const base = `palms-report-${safeFilePart(weekLabel)}`;

    if (format === "json") {
      return Response.json({
        filename: `${base}.pdf`,
        weekLabel,
        memberCount: matrix.rows.length,
        headers,
        rows,
        totalRow: null,
      });
    }

    if (format === "csv") {
      const cell = (v: string) => JSON.stringify(v);
      const lines = [
        `Week,${JSON.stringify(weekLabel)}`,
        `Members,${String(matrix.rows.length)}`,
        "",
        headers.map(cell).join(","),
      ];
      for (const r of rows) lines.push(r.map(cell).join(","));
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
        [`Attendance — ${weekLabel}`],
        [`Members: ${matrix.rows.length}`],
        headers,
        ...rows,
      ]);
      ws["!cols"] = [{ wch: 26 }, ...matrix.weeks.map(() => ({ wch: 8 }))];
      XLSX.utils.book_append_sheet(wb, ws, "Attendance");
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
    doc.text(`Attendance — ${weekLabel}`, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    doc.text(`Members: ${matrix.rows.length}`, 40, 54);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: 58,
      head: [headers],
      body: rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [214, 84, 44], textColor: 255 },
    });
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
