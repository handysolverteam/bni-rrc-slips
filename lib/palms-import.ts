import * as XLSX from "xlsx";
import { normalizeName } from "./report-import";

/** Known attendance letters in the wide report's cells (case-insensitive). */
export const PALMS_LETTERS = ["P", "A", "M", "S", "L"];

export type PalmsColumn = {
  /** Header label exactly as the file shows it (e.g. "Apr 01"). */
  header: string;
  /** Meeting date (YYYY-MM-DD) — year resolved from the From:/To: range. */
  iso: string;
};

export type PalmsRow = {
  /** "First Last" exactly as the file shows it. */
  name: string;
  /** cells[i] = letter for columns[i], null when the cell is blank. */
  cells: (string | null)[];
};

export type ParsedPalmsWide = {
  from: string | null;
  to: string | null;
  /** Date columns resolved to real dates, in file order. */
  columns: PalmsColumn[];
  members: PalmsRow[];
  /** Header labels that are not date-like — their cells are skipped. */
  columnsSkipped: string[];
  /** Cells whose value is not a known letter (skipped, listed for the UI). */
  issues: string[];
  errors: string[];
};

const norm = (v: unknown): string => String(v ?? "").trim();
const key = (v: unknown): string => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel serial day number -> ISO date (epoch 1899-12-30). */
export function excelSerialToISO(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

export function cellToISODate(v: unknown): string | null {
  if (typeof v === "number") return excelSerialToISO(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = norm(v);
  if (!s) return null;
  // Indian locale: dd/mm/yyyy (also dd-mm-yyyy, yyyy-mm-dd).
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return isoOf(year, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Apr 01" + the From/To year range -> ISO date (null when out of range). */
function resolveDateHeader(header: string, from: string, to: string): string | null {
  const m = header.match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase());
  if (mi < 0) return null;
  const fromY = Number(from.slice(0, 4));
  const toY = Number(to.slice(0, 4));
  const years = [fromY, toY, fromY - 1, toY + 1];
  for (const y of years) {
    const cand = isoOf(y, mi + 1, Number(m[2]));
    if (cand && cand >= from && cand <= to) return cand;
  }
  return null;
}

const MAX_ISSUES = 50;

/**
 * Parses BNI's wide `PALMS Attendance Report` (.xls/.xlsx) — one file
 * covering ~6 months of Wednesday meetings.
 *
 * File shape (verified against a real export): title/run rows, `Parameters`,
 * `Chapter:`, `From:` / `To:` (Excel serials), then a header row starting
 * `First Name | Last Name | <blank spacers> | Apr 01 | Apr 08 | …` (merged
 * cells create empty spacer columns — columns are located by VALUE, never by
 * fixed index), then one row per member with single-letter cells P A M S L
 * (blank = no cell).
 *
 * Date headers are `MMM dd`; the year comes from the From/To range. Headers
 * that are not date-like and cells that are not known letters never fail the
 * parse — they are collected in `columnsSkipped` / `issues` so the preview
 * can show them. Errors are reserved for unusable files (no header row, no
 * readable From/To, no date columns — e.g. the old single-meeting format,
 * which is no longer supported).
 */
export function parsePalmsWideFile(buffer: Buffer): ParsedPalmsWide {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "report") ?? wb.SheetNames[0];
  const ws = wb.SheetNames.length > 0 ? wb.Sheets[sheetName] : undefined;
  const base: ParsedPalmsWide = {
    from: null,
    to: null,
    columns: [],
    members: [],
    columnsSkipped: [],
    issues: [],
    errors: [],
  };
  if (!ws) {
    return { ...base, errors: ["The file has no readable sheet."] };
  }
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

  // Header row: the first row whose first cell is "First Name".
  let headerIdx = -1;
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    if (key((matrix[r] ?? [])[0]) === "firstname") {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      ...base,
      errors: ["Not a PALMS report file — the First Name / Last Name header row was not found."],
    };
  }

  const rawHeader = (matrix[headerIdx] ?? []).map((c) => norm(c));

  // From:/To: parameter rows — take the first non-empty cell after the label.
  const dateAfter = (label: string): string | null => {
    for (const row of matrix) {
      const arr = row ?? [];
      for (let c = 0; c < arr.length; c++) {
        if (key(arr[c]) !== label) continue;
        for (let c2 = c + 1; c2 < arr.length; c2++) {
          if (norm(arr[c2])) return cellToISODate(arr[c2]);
        }
      }
    }
    return null;
  };
  const from = dateAfter("from");
  const to = dateAfter("to");
  if (!from || !to) {
    return {
      ...base,
      errors: ["Could not read the From:/To: date range — export the wide PALMS Attendance Report."],
    };
  }

  // Date columns by header value (spacer columns are blank and dropped).
  const columns: PalmsColumn[] = [];
  const colMap = new Map<number, number>(); // matrix col -> columns index
  const columnsSkipped: string[] = [];
  for (let c = 2; c < rawHeader.length; c++) {
    const h = rawHeader[c];
    if (!h) continue;
    const iso = resolveDateHeader(h, from, to);
    if (iso) {
      colMap.set(c, columns.length);
      columns.push({ header: h, iso });
    } else {
      columnsSkipped.push(h);
    }
  }
  if (columns.length === 0) {
    return {
      from,
      to,
      columns: [],
      members: [],
      columnsSkipped,
      issues: [],
      errors: [
        "No date columns found — this looks like the old single-meeting PALMS file. Export the wide PALMS Attendance Report (6 months, one column per Wednesday).",
      ],
    };
  }

  const members: PalmsRow[] = [];
  const issues: string[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const first = norm(row[0]);
    const last = norm(row[1]);
    if (!first && !last) continue;
    // Pseudo rows from the export — never members.
    if (/^(total|visitors?|bni)$/.test(key(first)) || /^(total|visitors?|bni)$/.test(key(last))) continue;
    const name = normalizeName(`${first} ${last}`);
    if (!name) continue;
    const cells: (string | null)[] = columns.map(() => null);
    for (let c = 2; c < row.length; c++) {
      const ci = colMap.get(c);
      if (ci === undefined) continue;
      const v = norm(row[c]);
      if (!v) continue;
      const letter = v.toUpperCase();
      if (PALMS_LETTERS.includes(letter)) {
        cells[ci] = letter;
      } else if (issues.length < MAX_ISSUES) {
        issues.push(`${name} — ${columns[ci].header}: "${v}" is not a known attendance letter (P/A/M/S/L)`);
      }
    }
    members.push({ name, cells });
  }
  const errors: string[] = [];
  if (members.length === 0) {
    errors.push("No member rows found below the header row.");
  }

  return { from, to, columns, members, columnsSkipped, issues, errors };
}
