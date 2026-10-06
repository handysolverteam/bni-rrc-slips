import * as XLSX from "xlsx";
import { normalizeName } from "./report-import";

export type PalmsMember = {
  /** "First Last" exactly as the file shows it. */
  name: string;
  present: number;
  absent: number;
  l: number;
  m: number;
  s: number;
  t: number;
};

/** The PALMS `Total` row's slip counts — PALMS's own official numbers. */
export type PalmsTotals = {
  rgi: number;
  rgo: number;
  rri: number;
  rro: number;
  visitors: number;
  oneToOnes: number;
  tyfcb: number;
  ceu: number;
};

export type ParsedPalms = {
  /** Meeting date (YYYY-MM-DD) from From:/To: — equal in a single-meeting file. */
  meetingDate: string | null;
  members: PalmsMember[];
  /** Total-row slip counts, compared against the app's slip data on import. */
  palmsTotals: PalmsTotals | null;
  errors: string[];
  headers: string[];
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

function cellToISODate(v: unknown): string | null {
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

/**
 * Parses BNI's `Chapter Summary PALMS Report` (.xls/.xlsx).
 *
 * File shape (verified against real exports): title rows, `Chapter:` /
 * `From:` / `To:` parameters, then a header row starting `First Name |
 * Last Name | P | A | … | RGI | RGO | RRI | RRO | V | 1-2-1 | TYFCB |
 * CEU | T` (spacer columns are blank), member rows, then pseudo rows
 * `Visitors`, `BNI` and a `Total` row.
 *
 * Only the attendance columns P A L M S + T are read here — every
 * slip-derived column is recomputed by the app from its own slips.
 * A range report (From ≠ To) is rejected: attendance must be imported
 * one meeting at a time so it can attach to exactly one bni_weeks row.
 */
export function parsePalmsFile(buffer: Buffer): ParsedPalms {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "report") ?? wb.SheetNames[0];
  const ws = wb.SheetNames.length > 0 ? wb.Sheets[sheetName] : undefined;
  if (!ws) {
    return {
      meetingDate: null,
      members: [],
      palmsTotals: null,
      errors: ["The file has no readable sheet."],
      headers: [],
    };
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
      meetingDate: null,
      members: [],
      palmsTotals: null,
      errors: [
        "Not a Chapter Summary PALMS file — the First Name / Last Name header row was not found.",
      ],
      headers: [],
    };
  }

  const rawHeader = (matrix[headerIdx] ?? []).map((c) => norm(c));
  const header = rawHeader.map((c) => key(c));
  const col = (...labels: string[]): number => {
    for (const l of labels) {
      const i = header.indexOf(l);
      if (i >= 0) return i;
    }
    return -1;
  };
  const colFirst = col("firstname");
  const colLast = col("lastname");
  const colP = col("p");
  const colA = col("a");
  const colL = col("l");
  const colM = col("m");
  const colS = col("s");
  const colT = col("t");
  if (colFirst < 0 || colLast < 0 || colP < 0 || colA < 0) {
    return {
      meetingDate: null,
      members: [],
      palmsTotals: null,
      errors: [
        `Chapter Summary header not found (need First Name / Last Name / P / A). Found: ${rawHeader.filter(Boolean).join(" | ") || "(none)"}`,
      ],
      headers: rawHeader,
    };
  }

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
  const fromISO = dateAfter("from");
  const toISO = dateAfter("to");
  const errors: string[] = [];
  if (fromISO && toISO && fromISO !== toISO) {
    return {
      meetingDate: null,
      members: [],
      palmsTotals: null,
      errors: [
        `This is a range report (From ${fromISO}, To ${toISO}) — export the PALMS report for a single meeting date (From = To).`,
      ],
      headers: rawHeader,
    };
  }
  const meetingDate = fromISO ?? toISO;
  if (!meetingDate) {
    return {
      meetingDate: null,
      members: [],
      palmsTotals: null,
      errors: ["Could not read the meeting date from the From:/To: parameter rows."],
      headers: rawHeader,
    };
  }

  const num = (row: unknown[], c: number): number => {
    if (c < 0) return 0;
    const n = Number(row[c]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };

  // Slip-count columns of the Total row (PALMS's official per-week numbers).
  const colRgi = col("rgi");
  const colRgo = col("rgo");
  const colRri = col("rri");
  const colRro = col("rro");
  const colV = col("v");
  const colO2o = col("121");
  const colTyfcb = col("tyfcb");
  const colCeu = col("ceu");

  const members: PalmsMember[] = [];
  let totalRow: unknown[] | null = null;
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const first = norm(row[colFirst]);
    const last = norm(row[colLast]);
    if (!first && !last) continue;
    // "Total" is the official totals row (kept for the comparison);
    // "Visitors"/"BNI" are not members.
    if (key(first) === "total") {
      totalRow = row;
      continue;
    }
    if (!last && /^(visitors?|bni)$/.test(key(first))) continue;
    const name = normalizeName(`${first} ${last}`);
    if (!name) continue;
    members.push({
      name,
      present: num(row, colP),
      absent: num(row, colA),
      l: num(row, colL),
      m: num(row, colM),
      s: num(row, colS),
      t: num(row, colT),
    });
  }
  if (members.length === 0) {
    errors.push("No member rows found below the header row.");
  }
  if (!totalRow) {
    errors.push("The `Total` row was not found — export the standard Chapter Summary PALMS Report (it is needed to verify the counts against the imported slips).");
  }
  const palmsTotals: PalmsTotals | null = totalRow
    ? {
        rgi: num(totalRow, colRgi),
        rgo: num(totalRow, colRgo),
        rri: num(totalRow, colRri),
        rro: num(totalRow, colRro),
        visitors: num(totalRow, colV),
        oneToOnes: num(totalRow, colO2o),
        tyfcb: num(totalRow, colTyfcb),
        ceu: num(totalRow, colCeu),
      }
    : null;

  return { meetingDate, members, palmsTotals, errors, headers: rawHeader };
}
