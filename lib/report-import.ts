import * as XLSX from "xlsx";
import { findChapterName } from "./file-chapter";
import type { InsideOutside, ReportRow, SlipKind } from "./types";

export function mapInsideOutside(raw: string): InsideOutside | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("tier 1") || v === "inside" || v === "1" || v.includes("(inside)")) return "Inside";
  if (v.includes("tier 2") || v === "outside" || v === "2" || v.includes("(outside)")) return "Outside";
  return null;
}

export function classifySlipType(raw: string): SlipKind | null {
  const v = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!v) return null;
  if (v.includes("onetoone") || v === "121") return "one-to-one";
  if (v.includes("referral")) return "referral";
  if (v.includes("tyfcb")) return "tyfcb";
  if (v.includes("visitor")) return "visitor";
  if (v.includes("ceu")) return "ceu";
  return null;
}

export type ReportColumnMap = {
  from: number;
  to: number;
  slipType: number;
  insideOutside: number;
  tyfcb: number;
  ceuCredits: number;
  detail: number;
};

export type ParsedReport = {
  rows: ReportRow[];
  errors: string[];
  /** Raw header labels as found in the file (for diagnostics). */
  headers: string[];
  /** 0-based column indexes, -1 when a column was not found. */
  columnMap: ReportColumnMap;
  /** Meeting date (YYYY-MM-DD) read from the title row, e.g. "Slips Audit Report for 01/04/2026". */
  reportDate: string | null;
  /** Chapter named in the header block above the table (raw, e.g. "Influencers"), if any. */
  chapterName?: string | null;
};

/**
 * Audit exports carry title rows above the column headers; the meeting date
 * lives in the title, e.g. "Slips Audit Report for 01/04/2026" (DD/MM/YYYY).
 * Scans the first rows, any column.
 */
export function findReportDate(matrix: string[][]): string | null {
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    for (const cell of matrix[r] ?? []) {
      const text = String(cell ?? "");
      const m = text.match(/report\s+for\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i);
      if (m) {
        const day = Number(m[1]);
        const month = Number(m[2]);
        let year = Number(m[3]);
        if (year < 100) year += 2000;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dt = new Date(`${iso}T00:00:00Z`);
          if (
            !Number.isNaN(dt.getTime()) &&
            dt.getUTCFullYear() === year &&
            dt.getUTCMonth() + 1 === month &&
            dt.getUTCDate() === day
          ) {
            return iso;
          }
        }
      }
      const isoMatch = text.match(/report\s+for\s+(\d{4}-\d{2}-\d{2})/i);
      if (isoMatch) return isoMatch[1];
    }
  }
  return null;
}

/** First row (within the top 10) that looks like the column header row. */
export function findHeaderRow(matrix: string[][]): number {
  for (let r = 0; r < Math.min(matrix.length, 10); r++) {
    const { map } = detectColumns((matrix[r] ?? []).map((h) => String(h ?? "")));
    if (map.from >= 0 && map.to >= 0 && map.slipType >= 0) return r;
  }
  return -1;
}

/**
 * Shared header detection for both parsers (SheetJS for .xls/.csv,
 * ExcelJS for .xlsx with bold info). Returns raw labels plus 0-based
 * column indexes (-1 when a column was not found).
 */
export function detectColumns(rawCells: unknown[]): {
  map: ReportColumnMap;
  headers: string[];
} {
  const rawHeaders = rawCells.map((h) => String(h ?? "").trim());
  // Strip case, spaces, punctuation: "TYFCB Amount (Rs.)" -> "tyfcbamountrs".
  const header = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const find = (pred: (h: string) => boolean): number => {
    for (let i = 0; i < header.length; i++) {
      if (header[i] && pred(header[i])) return i;
    }
    return -1;
  };

  // Exact matches first (common layout), fuzzy contains-match as fallback
  // so variants like "TYFCB Amount" or "Business Amount (INR)" still map.
  const map: ReportColumnMap = {
    from: find((h) => h === "from"),
    to: find((h) => h === "to"),
    slipType: find((h) => h === "sliptype" || h === "slip"),
    insideOutside: find((h) => h === "insideoutside" || h === "insideoroutside" || h === "inside" || h === "outside"),
    tyfcb: find((h) => h === "tyfcb"),
    ceuCredits: find((h) => h === "ceucredits" || h === "ceu"),
    detail: find((h) => h === "detail" || h === "details"),
  };
  if (map.tyfcb < 0) map.tyfcb = find((h) => h.includes("tyfcb") || h.includes("amount"));
  if (map.ceuCredits < 0) map.ceuCredits = find((h) => h.includes("ceu"));
  if (map.detail < 0) map.detail = find((h) => h.includes("detail") || h.includes("chapter"));
  if (map.insideOutside < 0) {
    map.insideOutside = find((h) => h.includes("inside") || h.includes("outside"));
  }
  if (map.slipType < 0) map.slipType = find((h) => h.includes("slip"));
  if (map.from < 0) map.from = find((h) => h.endsWith("from"));
  // "photo" also ends with "to", so exclude it explicitly.
  if (map.to < 0) map.to = find((h) => h.endsWith("to") && h !== "photo");

  return { map, headers: rawHeaders };
}

export function parseReportFile(buffer: Buffer): ParsedReport {
  const empty: ParsedReport = {
    rows: [],
    errors: [],
    headers: [],
    reportDate: null,
    columnMap: { from: -1, to: -1, slipType: -1, insideOutside: -1, tyfcb: -1, ceuCredits: -1, detail: -1 },
  };
  const wb = XLSX.read(buffer, { type: "buffer" });
  // Prefer sheet named Report, else first sheet.
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "report") ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const matrix: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const reportDate = findReportDate(matrix);
  empty.reportDate = reportDate;

  const headerIdx = findHeaderRow(matrix);
  if (headerIdx < 0) {
    return {
      ...empty,
      errors: [
        "Header row (From / To / Slip Type) was not found in the first rows of the sheet.",
      ],
    };
  }
  if (matrix.length - headerIdx < 2) return { ...empty, errors: ["No data rows found."] };

  const { map, headers: rawHeaders } = detectColumns(matrix[headerIdx].map((h) => String(h ?? "")));

  const errors: string[] = [];
  if (map.from < 0 || map.to < 0 || map.slipType < 0) {
    return {
      ...empty,
      headers: rawHeaders,
      columnMap: map,
      errors: [
        `Headers From / To / Slip Type were not found. Found headers: ${rawHeaders.filter(Boolean).join(" | ") || "(none)"}`,
      ],
    };
  }

  const rows: ReportRow[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r];
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
    });
  }
  if (map.tyfcb < 0) {
    errors.push("No TYFCB/amount column detected — TYFCB amounts will import as 0.");
  }
  return {
    rows,
    errors,
    headers: rawHeaders,
    columnMap: map,
    reportDate,
    chapterName: findChapterName(matrix.slice(0, headerIdx)),
  };
}

export function parseAmount(raw: string): number {
  // Extract the first number-like token so currency prefixes ("Rs. 1400"),
  // thousand separators ("2,60,000.00") and stray text don't corrupt the value.
  const match = String(raw ?? "").match(/-?(\d[\d,]*(\.\d+)?|\.\d+)/);
  if (!match) return 0;
  const n = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeName(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

/**
 * A From/To cell holding only digits is the source row number (e.g. the
 * extra Count column in TYFCB sections) — never a real person name.
 */
export function isCountLikeName(v: string): boolean {
  return /^\d+$/.test(v.trim());
}

export type RowIssueLists = { skipped: string[]; warnings: string[] };

/**
 * Row-level file validation for preview: mirrors the import route's own
 * rules so the UI can warn before importing. `skipped` rows never import;
 * `warnings` import with a defaulted value.
 */
export function validateReportRows(
  rows: import("./types").ReportRow[],
): RowIssueLists {
  const skipped: string[] = [];
  const warnings: string[] = [];
  for (const r of rows) {
    const kind = classifySlipType(r.slipType);
    const from = normalizeName(r.from);
    const to = normalizeName(r.to);
    if (!kind) {
      skipped.push(`Row ${r.rowNumber}: unknown Slip Type "${r.slipType.trim().slice(0, 30)}"`);
      continue;
    }
    if (kind === "referral" || kind === "one-to-one") {
      const label = kind === "referral" ? "Referral" : "One-to-One";
      if (!from || !to) skipped.push(`Row ${r.rowNumber}: ${label} needs From + To`);
      else if (isCountLikeName(from) || isCountLikeName(to)) {
        skipped.push(`Row ${r.rowNumber}: ${label} has a number instead of a name`);
      }
    } else if (kind === "tyfcb") {
      const name = to || from;
      if (!name) skipped.push(`Row ${r.rowNumber}: TYFCB needs To (member thanked)`);
      else if (isCountLikeName(name)) skipped.push(`Row ${r.rowNumber}: TYFCB has a number instead of a name`);
      else if (from && isCountLikeName(from)) {
        warnings.push(`Row ${r.rowNumber}: TYFCB From "${from}" is a number, ignored`);
      }
      if (!r.tyfcb.trim()) warnings.push(`Row ${r.rowNumber}: TYFCB has no amount (imports as 0)`);
    } else if (kind === "visitor") {
      const fullName = to || from;
      if (!fullName) skipped.push(`Row ${r.rowNumber}: Visitor needs a name`);
      else if (isCountLikeName(fullName)) skipped.push(`Row ${r.rowNumber}: Visitor has a number instead of a name`);
      else if (r.from && r.to && isCountLikeName(from)) {
        warnings.push(`Row ${r.rowNumber}: inviter "${from}" is a number, ignored`);
      }
    } else {
      const name = from || to;
      if (!name) skipped.push(`Row ${r.rowNumber}: CEU needs From member`);
      else if (isCountLikeName(name)) skipped.push(`Row ${r.rowNumber}: CEU has a number instead of a name`);
    }
    if (r.insideOutside.trim() && !mapInsideOutside(r.insideOutside)) {
      warnings.push(`Row ${r.rowNumber}: Inside/Outside "${r.insideOutside.trim().slice(0, 30)}" not recognized (stored blank)`);
    }
  }
  return { skipped, warnings };
}
