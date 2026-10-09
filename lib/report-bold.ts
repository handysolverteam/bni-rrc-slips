import ExcelJS from "exceljs";
import { findChapterName } from "./file-chapter";
import { detectColumns, findHeaderRow, findReportDate, type ParsedReport } from "./report-import";
import type { ReportRow } from "./types";

/**
 * Bold-aware parser for .xlsx Report files (ExcelJS reads rich-text runs).
 *
 * Chapter rule confirmed by the user: a BOLD name lives in a DIFFERENT
 * chapter, and the Detail column describes THAT bold person's chapter.
 * Non-bold names are same-chapter members.
 *
 * NOTE: true binary BIFF .xls files carry no readable formatting through
 * open-source parsers — but the client's `.xls` files are really
 * SpreadsheetML XML, handled with bold by lib/report-xml.ts.
 */

type RichRun = { text?: string | number; font?: { bold?: boolean } };

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    const anyV = v as { richText?: RichRun[]; result?: unknown };
    if (Array.isArray(anyV.richText)) {
      return anyV.richText.map((run) => String(run.text ?? "")).join("");
    }
    if ("result" in anyV) {
      return anyV.result == null ? "" : String(anyV.result);
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
}

function cellBold(cell: ExcelJS.Cell): boolean {
  const v = cell.value;
  if (v && typeof v === "object") {
    const richText = (v as { richText?: RichRun[] }).richText;
    if (Array.isArray(richText)) {
      // Whole-cell bold in the source file lands here as bold runs.
      return richText.some((run) => run.font?.bold === true);
    }
  }
  return cell.font?.bold === true;
}

export type BoldParsedReport = ParsedReport & { boldFound: boolean };

export async function parseReportXlsxBold(buffer: Buffer): Promise<BoldParsedReport> {
  const empty: BoldParsedReport = {
    rows: [],
    errors: [],
    headers: [],
    reportDate: null,
    columnMap: { from: -1, to: -1, slipType: -1, insideOutside: -1, tyfcb: -1, ceuCredits: -1, detail: -1 },
    boldFound: false,
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const ws =
    wb.worksheets.find((s) => s.name.toLowerCase() === "report") ?? wb.worksheets[0];
  if (!ws) throw new Error("No worksheet found in the file.");

  const texts: string[][] = [];
  const bolds: boolean[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const t: string[] = [];
    const b: boolean[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      t[colNumber - 1] = cellText(cell);
      b[colNumber - 1] = cellBold(cell);
    });
    texts.push(t);
    bolds.push(b);
  });

  // Title rows sit above the headers (week date lives in the title);
  // the header row is located by content, not by position.
  const reportDate = findReportDate(texts);
  empty.reportDate = reportDate;

  const start = findHeaderRow(texts);
  if (start < 0 || start >= texts.length - 1) {
    return {
      ...empty,
      errors: ["Header row (From / To / Slip Type) was not found in the first rows of the sheet."],
    };
  }

  const { map, headers } = detectColumns(texts[start]);

  const errors: string[] = [];
  if (map.from < 0 || map.to < 0 || map.slipType < 0) {
    return {
      ...empty,
      headers,
      columnMap: map,
      errors: [
        `Headers From / To / Slip Type were not found. Found headers: ${headers.filter(Boolean).join(" | ") || "(none)"}`,
      ],
    };
  }

  const rows: ReportRow[] = [];
  for (let r = start + 1; r < texts.length; r++) {
    const line = texts[r];
    const flags = bolds[r] ?? [];
    const get = (i: number) => (i >= 0 ? String(line[i] ?? "").trim() : "");
    const from = get(map.from);
    const to = get(map.to);
    const slipType = get(map.slipType);
    if (!from && !to && !slipType) continue; // blank line
    rows.push({
      from,
      to,
      slipType,
      insideOutside: get(map.insideOutside),
      tyfcb: get(map.tyfcb),
      ceuCredits: get(map.ceuCredits),
      detail: get(map.detail),
      rowNumber: r + 1,
      fromBold: map.from >= 0 ? (flags[map.from] ?? false) : false,
      toBold: map.to >= 0 ? (flags[map.to] ?? false) : false,
    });
  }
  if (map.tyfcb < 0) {
    errors.push("No TYFCB/amount column detected — TYFCB amounts will import as 0.");
  }
  const boldFound = rows.some((r) => r.fromBold || r.toBold);
  return {
    rows,
    errors,
    headers,
    columnMap: map,
    reportDate,
    boldFound,
    chapterName: findChapterName(texts.slice(0, start)),
  };
}
