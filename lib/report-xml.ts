import { detectColumns, findHeaderRow, findReportDate, type ParsedReport } from "./report-import";
import type { BoldParsedReport } from "./report-bold";
import type { ReportRow } from "./types";

/**
 * SpreadsheetML (Excel 2003 XML) parser with bold info.
 *
 * The client's Report files arrive as `.xls`/`.xlsx` extensions but are
 * really SpreadsheetML XML (`<?xml ... <Workbook ...>`). BIFF formatting is
 * unreadable to open-source parsers, but XMLSS carries styles as plain XML:
 *   <Style ss:ID="23"><Font ... ss:Bold="1" .../></Style>
 *   <Cell ss:Index="1" ss:StyleID="23"><Data ss:Type="String">Name</Data></Cell>
 * A BOLD name lives in a DIFFERENT chapter (same rule as the .xlsx reader).
 */

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m, e: string) => named[e] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|\\s)(?:ss:)?${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** style id -> bold */
function parseBoldStyles(xml: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  const re = /<Style\b([^>]*)>([\s\S]*?)<\/Style\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = attr(m[1], "ID");
    if (!id) continue;
    map.set(id, /<Font\b[^>]*\b(?:ss:)?Bold="1"/.test(m[2]));
  }
  return map;
}

function cellTextAndBold(
  cellInner: string,
  cellTag: string,
  boldStyles: Map<string, boolean>,
): { text: string; bold: boolean } {
  const styleId = attr(cellTag, "StyleID");
  let bold = (styleId != null && boldStyles.get(styleId)) === true;
  const dataMatch = cellInner.match(/<Data\b[^>]*>([\s\S]*?)<\/Data\s*>/);
  const raw = dataMatch ? dataMatch[1] : "";
  if (/<Font\b[^>]*\b(?:ss:)?Bold="1"/.test(raw)) bold = true; // inline rich-text bold
  const text = decodeEntities(raw.replace(/<[^>]+>/g, "")).trim();
  return { text, bold };
}

export function isSpreadsheetML(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 2000).toString("utf8").replace(/^\uFEFF/, "");
  const t = head.trimStart();
  return t.startsWith("<?xml") && t.includes("<Workbook");
}

export function parseReportXmlSpreadsheetML(buffer: Buffer): BoldParsedReport {
  const empty: BoldParsedReport = {
    rows: [],
    errors: [],
    headers: [],
    reportDate: null,
    columnMap: { from: -1, to: -1, slipType: -1, insideOutside: -1, tyfcb: -1, ceuCredits: -1, detail: -1 },
    boldFound: false,
  };
  const xml = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (!xml.includes("<Workbook")) throw new Error("Not a SpreadsheetML workbook.");

  const boldStyles = parseBoldStyles(xml);

  // Prefer the sheet named Report, else the first sheet.
  const sheets: { name: string; body: string }[] = [];
  const sheetRe = /<Worksheet\b([^>]*)>([\s\S]*?)<\/Worksheet\s*>/g;
  let sm: RegExpExecArray | null;
  while ((sm = sheetRe.exec(xml)) !== null) {
    sheets.push({ name: attr(sm[1], "Name") ?? "", body: sm[2] });
  }
  const sheet =
    sheets.find((s) => s.name.toLowerCase() === "report") ?? sheets[0];
  if (!sheet) throw new Error("No worksheet found in the file.");

  const texts: string[][] = [];
  const bolds: boolean[][] = [];
  const rowRe = /<Row\b([^>]*)>([\s\S]*?)<\/Row\s*>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheet.body)) !== null) {
    // Rows/cells can be sparse (ss:Index) — expand positionally.
    const t: string[] = [];
    const b: boolean[] = [];
    let col = 0;
    const cellRe = /<Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Cell\s*>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[2])) !== null) {
      const idx = attr(cm[1], "Index");
      if (idx) col = Number(idx) - 1;
      if (cm[2] !== undefined) {
        const { text, bold } = cellTextAndBold(cm[2], cm[1], boldStyles);
        t[col] = text;
        b[col] = bold;
      }
      col++;
    }
    if (t.some((v) => v !== undefined && v !== "")) {
      // Densify: missing cells become "".
      const width = t.length;
      for (let i = 0; i < width; i++) {
        if (t[i] === undefined) t[i] = "";
        if (b[i] === undefined) b[i] = false;
      }
      texts.push(t);
      bolds.push(b);
    }
  }

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
  return { rows, errors, headers, columnMap: map, reportDate, boldFound };
}
