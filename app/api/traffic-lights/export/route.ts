import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { multiParts } from "@/lib/list-filters";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";
import { LIGHT_LABEL, type LightColor } from "@/lib/traffic-light-score";
import { fetchTrafficData, rangeLabel, trafficView } from "@/lib/traffic-lights";

export const dynamic = "force-dynamic";

const FORMATS = ["xlsx", "csv", "pdf", "json"];
const LIGHTS: LightColor[] = ["green", "amber", "red", "grey"];
const LIGHT_RGB: Record<LightColor, string> = { green: "FF22C55E", amber: "FFF59E0B", red: "FFEF4444", grey: "FF9CA3AF" };
// The same colours as the screen: one per metric (header cell + its two columns).
const GROUP_RGB = ["FF2F6FED", "FF0E9488", "FF8B5CF6", "FF2E9E57", "FFC98A00", "FFD6459A", "FF2A8FBD"];

const HEADERS = [
  "Chapter", "Name", "Total Score",
  "Attendance Rate", "Attendance Score", "CEU Rate", "CEU Score", "121 Rate", "121 Score",
  "Referrals Given Rate", "Referrals Given Score", "TYFCB", "TYFCB Score", "Visitors", "Visitor Score", "Sponsors", "Sponsor Score",
];

const safeFilePart = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
const r4 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10000) / 10000);

/**
 * Traffic Lights export (xlsx / csv / pdf; json feeds the in-browser PDF). The sheet mirrors BNI's own "Member
 * Traffic Lights" workbook — title row, then Chapter · Name · Total Score · rate/score pairs — for the imported range and the
 * colour / name filters currently on screen (`?month=<from>_<to>`, `?light=`, `?c_name=`).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();

    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
    if (!FORMATS.includes(format)) return Response.json({ error: "format must be xlsx, csv, pdf or json" }, { status: 400 });

    const data = await fetchTrafficData(ctx.tenantId);
    const view = trafficView(data, url.searchParams.get("month") ?? undefined);
    if (view.rows.length === 0) return Response.json({ error: "No Traffic Lights data to export." }, { status: 404 });

    const lightParam = url.searchParams.get("light") ?? "";
    const light = LIGHTS.includes(lightParam as LightColor) ? (lightParam as LightColor) : "";
    const want = new Set(multiParts((url.searchParams.get("c_name") ?? "").trim()).map((n) => n.toLowerCase()));
    const rows = view.rows.filter((r) => (!light || r.color === light) && (want.size === 0 || want.has(r.name.toLowerCase())));

    const [fromIso, toIso] = view.month.split("_");
    const monthTitle = rangeLabel(fromIso, toIso).toUpperCase();
    const chapter = data.homeName.replace(/^bni\s+/i, "").toUpperCase();
    const title = `MEMBER TRAFFIC LIGHTS OF ${chapter} CHAPTER FOR ${monthTitle}`;
    const chapterCell = data.homeName.replace(/^bni\s+/i, "");
    const base = `traffic-lights-${safeFilePart(toIso)}${light ? `-${light}` : ""}`;

    // One line per member, numbers as numbers (rates to 4 decimals like BNI's sheet).
    const line = (r: (typeof rows)[number]): (string | number | null)[] => [
      chapterCell, r.name, r.total,
      r4(r.attendance.rate), r.attendance.score, r4(r.ceu.rate), r.ceu.score, r4(r.oneToOne.rate), r.oneToOne.score,
      r4(r.referrals.rate), r.referrals.score, Math.round(r.tyfcb.amount), r.tyfcb.score, r.visitors.count, r.visitors.score, r.sponsors.count, r.sponsors.score,
    ];
    const lines = rows.map(line);

    if (format === "json") {
      return Response.json({
        filename: `${base}.pdf`,
        title,
        window: view.windowLabel,
        memberCount: rows.length,
        headers: HEADERS,
        rows: lines.map((l) => l.map((v) => (v === null ? "" : String(v)))),
        colors: rows.map((r) => r.color),
        filters: [light ? `Colour: ${LIGHT_LABEL[light]}` : "", want.size > 0 ? `Members: ${[...want].length} selected` : ""].filter(Boolean),
      });
    }

    if (format === "csv") {
      const cell = (v: string | number | null) => (v === null ? "" : typeof v === "number" ? String(v) : JSON.stringify(v));
      const out = [JSON.stringify(title), JSON.stringify(view.windowLabel), HEADERS.map(cell).join(","), ...lines.map((l) => l.map(cell).join(","))];
      return new Response(out.join("\n"), {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${base}.csv"` },
      });
    }

    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Traffic Lights");
      ws.mergeCells(1, 1, 1, HEADERS.length);
      const t = ws.getCell(1, 1);
      t.value = title;
      t.font = { bold: true, size: 14 };
      t.alignment = { horizontal: "center" };
      const head = ws.addRow(HEADERS);
      head.height = 30;
      head.eachCell((c, col) => {
        const group = col >= 4 ? Math.floor((col - 4) / 2) : -1;
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: group >= 0 ? GROUP_RGB[group] : "FFD6542C" } };
      });
      rows.forEach((r, i) => {
        const row = ws.addRow(lines[i]);
        row.eachCell({ includeEmpty: true }, (c, col) => {
          if (col >= 3) c.alignment = { horizontal: "center" };
        });
        const total = row.getCell(3);
        total.font = { bold: true, color: { argb: "FFFFFFFF" } };
        total.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RGB[r.color] } };
        for (const col of [4, 6, 8, 10]) row.getCell(col).numFmt = "0.0000";
        row.getCell(12).numFmt = "#,##0";
      });
      ws.columns = HEADERS.map((h, i) => ({ width: i === 1 ? 28 : i === 0 ? 14 : Math.max(11, Math.min(18, h.length + 2)) }));
      ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
      const buf = await wb.xlsx.writeBuffer();
      return new Response(new Uint8Array(buf as ArrayBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        },
      });
    }

    // pdf — server path for API/tests; the browser builds its own from json.
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(12);
    doc.text(title, 40, 34);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    doc.text(`${view.windowLabel} · ${rows.length} members`, 40, 48);
    doc.setTextColor(0, 0, 0);
    autoTable(doc, {
      startY: 54,
      head: [HEADERS],
      body: lines.map((l) => l.map((v) => (v === null ? "" : String(v)))),
      styles: { fontSize: 6, halign: "center" },
      headStyles: { fillColor: [214, 84, 44], textColor: 255 },
      columnStyles: { 0: { halign: "left" }, 1: { halign: "left" } },
    });
    const pdf = Buffer.from(doc.output("arraybuffer"));
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Export failed." }, { status: 500 });
  }
}
