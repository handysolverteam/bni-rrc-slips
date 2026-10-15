import * as XLSX from "xlsx";
import { findChapterName } from "./file-chapter";
import { cellToISODate } from "./palms-import";

/** One member's line of BNI's Chapter Summary PALMS Report (totals for the whole From..To range). */
export type PalmsSummaryRow = {
  name: string;
  p: number;
  a: number;
  l: number;
  m: number;
  s: number;
  rgi: number;
  rgo: number;
  rri: number;
  rro: number;
  visitors: number;
  oneToOnes: number;
  tyfcb: number;
  ceu: number;
  t: number;
};

export type ParsedPalmsSummary = {
  kind: "palms";
  from: string | null;
  to: string | null;
  chapterName: string | null;
  rows: PalmsSummaryRow[];
  errors: string[];
};

/** One line of BNI's Chapter Sponsor Report: a member and one person they sponsored. */
export type SponsorRow = {
  sponsor: string;
  sponsored: string;
  sponsoredChapter: string | null;
  sponsoredRegion: string | null;
  applicationDate: string | null;
};

export type ParsedSponsorReport = {
  kind: "sponsor";
  from: string | null;
  to: string | null;
  chapterName: string | null;
  rows: SponsorRow[];
  errors: string[];
};

export type TrafficReportKind = "palms" | "sponsor";

const norm = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: unknown): string => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const int = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

function matrixOf(buffer: Buffer): unknown[][] | null {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "report") ?? wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  return ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][]) : null;
}

/** Which report this is, from the title row ("Chapter ► Sponsor Report" / "Chapter ► Summary PALMS Report"). */
export function detectTrafficReport(buffer: Buffer): TrafficReportKind | null {
  const matrix = matrixOf(buffer);
  if (!matrix) return null;
  for (const row of matrix.slice(0, 6)) {
    const text = key((row ?? []).map(norm).join(""));
    if (text.includes("sponsorreport")) return "sponsor";
    if (text.includes("summarypalmsreport")) return "palms";
  }
  return null;
}

/** First non-empty cell right of a `From:` / `To:` label, as an ISO date. */
function dateAfter(matrix: unknown[][], label: string): string | null {
  for (const row of matrix.slice(0, 20)) {
    const arr = row ?? [];
    for (let c = 0; c < arr.length; c++) {
      if (key(arr[c]) !== label) continue;
      for (let c2 = c + 1; c2 < arr.length; c2++) if (norm(arr[c2])) return cellToISODate(arr[c2]);
    }
  }
  return null;
}

/** Header row = the first row (within 25) whose first cell equals `first`. Columns are found by header text. */
function headerOf(matrix: unknown[][], first: string): { idx: number; col: Map<string, number> } | null {
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const row = matrix[r] ?? [];
    if (key(row[0]) !== first) continue;
    const col = new Map<string, number>();
    row.forEach((c, i) => {
      const k = key(c);
      if (k && !col.has(k)) col.set(k, i);
    });
    return { idx: r, col };
  }
  return null;
}

/**
 * Chapter Summary PALMS Report: title rows, `Parameters`, `Chapter:`, `From:` / `To:` (Excel serials), then a header
 * `First Name | Last Name | P | A | L | M | S | RGI | RGO | RRI | RRO | V | 1-2-1 | TYFCB | CEU | T` (merged cells leave
 * blank spacer columns, so columns are found by header text) and one row per member plus a final `Total` row.
 */
export function parsePalmsSummaryReport(buffer: Buffer): ParsedPalmsSummary {
  const base: ParsedPalmsSummary = { kind: "palms", from: null, to: null, chapterName: null, rows: [], errors: [] };
  const matrix = matrixOf(buffer);
  if (!matrix) return { ...base, errors: ["The file has no readable sheet."] };
  const head = headerOf(matrix, "firstname");
  if (!head || !head.col.has("rgi") || !head.col.has("121")) {
    return { ...base, errors: ["Not a Chapter Summary PALMS Report — the First Name … RGI / 1-2-1 / TYFCB / CEU header row was not found."] };
  }
  const from = dateAfter(matrix, "from");
  const to = dateAfter(matrix, "to");
  const chapterName = findChapterName(matrix.slice(0, head.idx));
  if (!from || !to) return { ...base, chapterName, errors: ["Could not read the From:/To: date range of the report."] };

  const at = (row: unknown[], k: string): number => int(row[head.col.get(k) ?? -1]);
  const rows: PalmsSummaryRow[] = [];
  for (let r = head.idx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const first = norm(row[0]);
    const last = norm(row[1]);
    if (!first && !last) continue;
    if (/^(total|visitors?|bni)$/.test(key(first)) || /^(total|visitors?|bni)$/.test(key(last))) continue;
    rows.push({
      name: norm(`${first} ${last}`),
      p: at(row, "p"),
      a: at(row, "a"),
      l: at(row, "l"),
      m: at(row, "m"),
      s: at(row, "s"),
      rgi: at(row, "rgi"),
      rgo: at(row, "rgo"),
      rri: at(row, "rri"),
      rro: at(row, "rro"),
      visitors: at(row, "v"),
      oneToOnes: at(row, "121"),
      tyfcb: at(row, "tyfcb"),
      ceu: at(row, "ceu"),
      t: at(row, "t"),
    });
  }
  const errors = rows.length === 0 ? ["No member rows found below the header row."] : [];
  return { kind: "palms", from, to, chapterName, rows, errors };
}

/**
 * Chapter Sponsor Report: same header block, then
 * `Sponsor First Name | Sponsor Last Name | Total Members Sponsored | Sponsored First Name | Sponsored Last Name |
 * Sponsored Region | Sponsored Chapter | Application Date`, one row per sponsored person.
 */
export function parseSponsorReport(buffer: Buffer): ParsedSponsorReport {
  const base: ParsedSponsorReport = { kind: "sponsor", from: null, to: null, chapterName: null, rows: [], errors: [] };
  const matrix = matrixOf(buffer);
  if (!matrix) return { ...base, errors: ["The file has no readable sheet."] };
  const head = headerOf(matrix, "sponsorfirstname");
  if (!head || !head.col.has("sponsoredfirstname") || !head.col.has("applicationdate")) {
    return { ...base, errors: ["Not a Chapter Sponsor Report — the Sponsor First Name … Application Date header row was not found."] };
  }
  const from = dateAfter(matrix, "from");
  const to = dateAfter(matrix, "to");
  const chapterName = findChapterName(matrix.slice(0, head.idx));
  if (!from || !to) return { ...base, chapterName, errors: ["Could not read the From:/To: date range of the report."] };

  const text = (row: unknown[], k: string): string => norm(row[head.col.get(k) ?? -1]);
  const rows: SponsorRow[] = [];
  for (let r = head.idx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const sponsor = norm(`${text(row, "sponsorfirstname")} ${text(row, "sponsorlastname")}`);
    const sponsored = norm(`${text(row, "sponsoredfirstname")} ${text(row, "sponsoredlastname")}`);
    if (!sponsor || !sponsored) continue;
    rows.push({
      sponsor,
      sponsored,
      sponsoredChapter: text(row, "sponsoredchapter") || null,
      sponsoredRegion: text(row, "sponsoredregion") || null,
      applicationDate: cellToISODate(row[head.col.get("applicationdate") ?? -1]),
    });
  }
  return { kind: "sponsor", from, to, chapterName, rows, errors: [] };
}
