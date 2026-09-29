import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fetchReportSections, rowCells, totalRowCells, visibleColumns, type ReportSectionKey } from "@/lib/report-view";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABS: ReportSectionKey[] = ["one-to-one", "referral", "tyfcb", "visitor"];

function safeFilePart(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
}

/** Download the week report as xlsx / csv / pdf, current tab or all tabs. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const weekId = url.searchParams.get("week") ?? "";
    const tab = url.searchParams.get("tab") ?? "all";
    const q = url.searchParams.get("q") ?? "";
    const colFor = (key: string) => ({
      from: url.searchParams.get(`cf_${key}_from`) ?? "",
      to: url.searchParams.get(`cf_${key}_to`) ?? "",
      detail: url.searchParams.get(`cf_${key}_detail`) ?? "",
    });
    const col = {
      "one-to-one": colFor("one-to-one"),
      referral: colFor("referral"),
      tyfcb: colFor("tyfcb"),
      visitor: colFor("visitor"),
    };
    // Per-table week overrides (w_<section>): a table uses its own scope
    // when set, otherwise the universal week above.
    const weekOverrides: Record<string, string> = {
      "one-to-one": url.searchParams.get("w_one-to-one") ?? "",
      referral: url.searchParams.get("w_referral") ?? "",
      tyfcb: url.searchParams.get("w_tyfcb") ?? "",
      visitor: url.searchParams.get("w_visitor") ?? "",
    };
    const effOf = (key: string): string => weekOverrides[key]?.trim() || weekId;
    const wideOf = (key: string): boolean => effOf(key) === "all";
    const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
    if (!weekId) return Response.json({ error: "week is required" }, { status: 400 });
    if (!["xlsx", "csv", "pdf", "json"].includes(format)) {
      return Response.json({ error: "format must be xlsx, csv, pdf or json" }, { status: 400 });
    }

    const sb = getSupabaseServer();
    const allWeeks = weekId === "all";
    async function weekLabelOf(id: string): Promise<string> {
      if (id === "all") return "All weeks";
      const { data: week } = await sb.from("bni_weeks").select("label").eq("id", id).maybeSingle();
      return (week as { label?: string } | null)?.label ?? "week";
    }
    const sections = await fetchReportSections(weekId, q, col, weekOverrides);
    const picked = tab === "all" ? sections : sections.filter((s) => s.key === tab);
    if (picked.length === 0) return Response.json({ error: "unknown tab" }, { status: 400 });
    const mixed = picked.some((s) => (weekOverrides[s.key] || "").trim() !== "");

    // Diagnostic: ?debug=1 returns JSON proving generation worked + byte size.
    if (url.searchParams.get("debug") === "1") {
      return Response.json({
        ok: true,
        format,
        week: weekId,
        sections: picked.map((s) => ({ title: s.title, rows: s.rows.length, scope: effOf(s.key) })),
      });
    }

    // Human-readable filter record for the exported file.
    const filterBits: string[] = [`Week: ${allWeeks ? "All weeks" : await weekLabelOf(weekId)}`];
    for (const s of picked) {
      const ov = (weekOverrides[s.key] || "").trim();
      if (ov) filterBits.push(`${s.title} week: ${await weekLabelOf(ov)}`);
    }
    if (q.trim()) filterBits.push(`Search: "${q.trim()}"`);
    const colLabels = { from: "From", to: "To", detail: "Detail" } as const;
    for (const s of picked) {
      for (const f of ["from", "to", "detail"] as const) {
        const v = (col[s.key]?.[f] || "").trim();
        if (v) filterBits.push(`${s.title} ${colLabels[f]}: ${v}`);
      }
    }
    const filterLine = filterBits.join(" | ");
    async function scopePartOf(id: string): Promise<string> {
      return id === "all" ? "all-weeks" : safeFilePart(await weekLabelOf(id));
    }
    let scopePart: string;
    let titleWeek: string;
    if (tab === "all") {
      scopePart = `${allWeeks ? "all-weeks" : safeFilePart(await weekLabelOf(weekId))}${mixed ? "-mixed" : ""}`;
      titleWeek = allWeeks ? "All weeks" : await weekLabelOf(weekId);
    } else {
      const eff = effOf(tab);
      scopePart = await scopePartOf(eff);
      titleWeek = await weekLabelOf(eff);
    }
    const base = `week-report-${scopePart}${tab === "all" ? "" : `-${tab}`}`;

    // Machine-readable payload for in-browser file building (JSON always
    // passes through; some stacks swallow generated PDF bytes instead).
    // Includes per-row bold flags so the client PDF can bold outsiders.
    if (format === "json") {
      return Response.json({
        filename: `${base}.pdf`,
        weekLabel: titleWeek,
        filterLine,
        sections: picked.map((s) => {
          const cols = visibleColumns(s.rows, wideOf(s.key));
          const withTotal = s.totalAmount != null && s.rows.length > 0;
          return {
            title: s.title,
            totalLabel: s.totalLabel,
            headers: cols.map((c) => c.label),
            rows: s.rows.map((r) => rowCells(r, cols)),
            bold: s.rows.map((r) => [r.fromBold, r.toBold]),
            totalRow: withTotal ? totalRowCells(cols, s.totalAmount as number) : null,
          };
        }),
      });
    }

    if (format === "csv") {
      const lines = [`Week,${JSON.stringify(titleWeek)}`, `Filters,${JSON.stringify(filterLine)}`];
      for (const s of picked) {
        const cols = visibleColumns(s.rows, wideOf(s.key));
        const headers = cols.map((c) => c.label);
        lines.push("", `${s.title} (${s.rows.length})`, headers.join(","));
        for (const r of s.rows) {
          lines.push(rowCells(r, cols).map((v) => JSON.stringify(String(v))).join(","));
        }
        if (s.totalAmount != null && s.rows.length > 0) {
          lines.push(totalRowCells(cols, s.totalAmount).map((v) => JSON.stringify(String(v))).join(","));
        }
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
      for (const s of picked) {
        const cols = visibleColumns(s.rows, wideOf(s.key));
        const headers = cols.map((c) => c.label);
        const ws = XLSX.utils.aoa_to_sheet([
          [`${titleWeek} — ${s.title} (${s.rows.length})`],
          [`Filters: ${filterLine}`],
          headers,
          ...s.rows.map((r) => rowCells(r, cols)),
          ...(s.totalAmount != null && s.rows.length > 0
            ? [totalRowCells(cols, s.totalAmount)]
            : []),
        ]);
        XLSX.utils.book_append_sheet(wb, ws, s.title.slice(0, 28));
      }
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        },
      });
    }

    // pdf
    const doc = new jsPDF({ orientation: "landscape", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Week Report — ${titleWeek}`, 40, 40);
    doc.setFontSize(8);
    doc.setTextColor(110, 105, 95);
    const filterLines = doc.splitTextToSize(`Filters: ${filterLine}`, 760);
    doc.text(filterLines, 40, 54);
    doc.setTextColor(0, 0, 0);
    const firstTableY = 58 + filterLines.length * 10;
    let first = true;
    for (const s of picked) {
      const cols = visibleColumns(s.rows, wideOf(s.key));
      const headers = cols.map((c) => c.label);
      const fromCol = headers.indexOf("From");
      const toCol = headers.indexOf("To");
      autoTable(doc, {
        startY: first ? firstTableY : undefined,
        head: [[`${s.title} (${s.rows.length})`, "", "", "", "", "", "", ""].slice(0, headers.length)],
        body: [headers.map(String)],
        theme: "plain",
        styles: { fontStyle: "bold" },
      });
      autoTable(doc, {
        head: [headers],
        body: [
          ...s.rows.map((r) => rowCells(r, cols)),
          ...(s.totalAmount != null && s.rows.length > 0
            ? [totalRowCells(cols, s.totalAmount)]
            : []),
        ],
        styles: { fontSize: 7 },
        headStyles: { fillColor: [193, 60, 48], textColor: 255 },
        // Outsider names (bold in the source file) print bold — every
        // section whose rows carry flags, not just referrals.
        didParseCell: (d) => {
          if (d.section !== "body") return;
          const flags = s.rows[d.row.index];
          if (!flags) return;
          if (
            (d.column.index === fromCol && flags.fromBold) ||
            (d.column.index === toCol && flags.toBold)
          ) {
            d.cell.styles.fontStyle = "bold";
          }
        },
      });
      first = false;
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
