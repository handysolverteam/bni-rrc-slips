import * as XLSX from "xlsx";
import type { BniRow } from "@/lib/traffic-light-calc";

/** One data row of BNI's "Member Traffic Lights" Excel, with every score as printed. */
export type BniFileRow = BniRow & {
  chapter: string;
  ceuScore: number;
  oneToOneScore: number;
  referralsScore: number;
  tyfcbScore: number;
  visitorScore: number;
  sponsorScore: number;
};

export type ParsedBniFile = {
  /** First day of the report month, `YYYY-MM-01`. */
  reportMonth: string;
  /** `YYYY-MM` */
  month: string;
  title: string;
  rows: BniFileRow[];
};

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03", apr: "04", april: "04",
  may: "05", jun: "06", june: "06", jul: "07", july: "07", aug: "08", august: "08",
  sep: "09", sept: "09", september: "09", oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
};

/** "… FOR SEPTEMBER '26" -> "2026-09" (null when the title carries no month). */
export function monthFromTitle(title: string): string | null {
  const m = /\bFOR\s+([A-Za-z]+)\s*'?\s*(\d{2}|\d{4})\b/i.exec(title);
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  const yy = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${yy}-${mm}`;
}

const norm = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === "" || v === null || v === undefined ? null : num(v));

/**
 * Parse BNI's Member Traffic Lights workbook: a title row ("MEMBER TRAFFIC LIGHTS OF … CHAPTER FOR
 * SEPTEMBER '26"), then a header row containing `Name` and `Total Score`, then one row per member.
 * Columns are found by header text, so their order does not matter. Throws a plain message on a file
 * that is not this report.
 */
export function parseBniTrafficLights(buffer: Buffer): ParsedBniFile {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no sheets.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
  const title = String(grid[0]?.[0] ?? "").replace(/\s+/g, " ").trim();
  if (!/traffic lights/i.test(title)) throw new Error("This is not BNI's Member Traffic Lights report (title row not found).");
  const month = monthFromTitle(title);
  if (!month) throw new Error("Could not read the report month from the title (expected \"… FOR SEPTEMBER '26\").");

  const headerAt = grid.findIndex((r) => {
    const h = r.map(norm);
    return h.includes("name") && h.includes("total score");
  });
  if (headerAt < 0) throw new Error("The header row (Name, Total Score, …) was not found.");
  const header = grid[headerAt].map(norm);
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    chapter: col("chapter"),
    name: col("name"),
    total: col("total score"),
    attR: col("attendance rate"),
    attS: col("attendance score"),
    ceuR: col("ceu rate"),
    ceuS: col("ceu score"),
    otoR: col("121 rate"),
    otoS: col("121 score"),
    refR: col("referrals given rate", "referral rate"),
    refS: col("referrals given score", "referral score"),
    tyf: col("tyfcb"),
    tyfS: col("tyfcb score"),
    vis: col("visitors"),
    visS: col("visitor score", "visitors score"),
    spo: col("sponsors"),
    spoS: col("sponsor score", "sponsors score"),
  };
  const missing = (["name", "total", "attR", "ceuR", "otoR", "refR", "tyf", "vis"] as const).filter((k) => c[k] < 0);
  if (missing.length > 0) throw new Error(`Missing column(s) in the header row: ${missing.join(", ")}.`);

  const at = (r: unknown[], i: number): unknown => (i >= 0 ? r[i] : "");
  const rows: BniFileRow[] = [];
  for (const r of grid.slice(headerAt + 1)) {
    const name = String(at(r, c.name) ?? "").replace(/\s+/g, " ").trim();
    if (!name || norm(name) === "name") continue;
    rows.push({
      name,
      chapter: String(at(r, c.chapter) ?? "").trim(),
      total: num(at(r, c.total)),
      attendanceRate: numOrNull(at(r, c.attR)),
      attendanceScore: num(at(r, c.attS)),
      ceuRate: numOrNull(at(r, c.ceuR)),
      ceuScore: num(at(r, c.ceuS)),
      oneToOneRate: numOrNull(at(r, c.otoR)),
      oneToOneScore: num(at(r, c.otoS)),
      referralsRate: numOrNull(at(r, c.refR)),
      referralsScore: num(at(r, c.refS)),
      tyfcb: numOrNull(at(r, c.tyf)),
      tyfcbScore: num(at(r, c.tyfS)),
      visitors: Math.round(num(at(r, c.vis))),
      visitorScore: num(at(r, c.visS)),
      sponsors: Math.round(num(at(r, c.spo))),
      sponsorScore: num(at(r, c.spoS)),
    });
  }
  if (rows.length === 0) throw new Error("No member rows were found under the header.");
  return { reportMonth: `${month}-01`, month, title, rows };
}
