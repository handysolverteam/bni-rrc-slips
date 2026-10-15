// Parsers for the two BNI reports behind Traffic Lights, on workbooks generated in the same layout as BNI's exports
// (title rows, Parameters, Chapter / From / To as Excel serials, spacer columns from merged cells).
// Run: npx tsx tests/unit-traffic-reports.mts
import * as XLSX from "xlsx";
import { detectTrafficReport, parsePalmsSummaryReport, parseSponsorReport } from "../lib/traffic-report-import";

let pass = 0;
let fail = 0;
const check = (n: string, ok: boolean, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

const serial = (iso: string): number => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
const book = (rows: unknown[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
const params = (chapter: string, from: string, to: string): unknown[][] => [
  ["Running User", "", "Run At", "", "Country", "", "Region", "", "Chapter"],
  ["Rahul Matharu", "", 46309.8, "", "India", "", "Gurgaon", "", chapter],
  ["Parameters"],
  ["Chapter:", "", "", "", "", "", chapter],
  ["From:", "", "", "", "", "", serial(from)],
  ["To:", "", "", "", "", "", serial(to)],
];

const palms = book([
  ["Chapter ► Summary PALMS Report"],
  ...params("Influencers", "2026-03-31", "2026-10-14"),
  ["First Name", "Last Name", "P", "A", "", "L", "M", "S", "", "RGI", "RGO", "RRI", "", "RRO", "V", "1-2-1", "", "TYFCB", "CEU", "T"],
  ["Garima", "Agarwal", 24, 2, "", 0, 2, 1, "", 12, 7, 5, "", 8, 4, 25, "", 181650, 15, 0],
  ["Rajesh Kumar", "Agarwal", 17, 2, "", 0, 4, 6, "", 3, 21, 4, "", 5, 1, 17, "", 12483100, 15, 0],
  ["Visitors", "", 29, 0, "", 0, 0, 0, "", 0, 0, 0, "", 0, 0, 0, "", 0, 0, 0],
  ["BNI", "", 29, 0, "", 0, 0, 0, "", 3, 0, 0, "", 1, 0, 0, "", 3306316, 0, 0],
  ["Total", "", 1950, 67, "", 9, 121, 111, "", 881, 1290, 848, "", 1273, 245, 2765, "", 599576269, 1601, 23],
]);
const sponsor = book([
  ["Chapter ► Sponsor Report"],
  ...params("Influencers", "2026-03-31", "2026-10-14"),
  ["Sponsor First Name", "Sponsor Last Name", "", "Total Members Sponsored", "Sponsored First Name", "", "Sponsored Last Name", "", "Sponsored Region", "Sponsored Chapter", "", "Application Date"],
  ["Saumitra", "Agarwal", "", 2, "Prabhav", "", "Agarwal", "", "Gurgaon", "Stars", "", serial("2026-06-19")],
  ["Saumitra", "Agarwal", "", 2, "Vinod", "", "Choudhary", "", "Gurgaon", "Stars", "", serial("2026-08-21")],
  ["Neraj K", "Anand", "", 1, "Nikhil Anand", "", "Malik", "", "Gurgaon", "Champions", "", serial("2026-08-06")],
]);
const other = book([["Something else"], ["a", "b"]]);

check("detects each report by its title", detectTrafficReport(palms) === "palms" && detectTrafficReport(sponsor) === "sponsor" && detectTrafficReport(other) === null);

const p = parsePalmsSummaryReport(palms);
check("PALMS: range + chapter from the header block", p.from === "2026-03-31" && p.to === "2026-10-14" && p.chapterName === "Influencers" && p.errors.length === 0, JSON.stringify([p.from, p.to, p.chapterName, p.errors]));
check("PALMS: member rows only — the Visitors / BNI / Total pseudo rows are skipped", p.rows.length === 2 && p.rows[0].name === "Garima Agarwal" && p.rows[1].name === "Rajesh Kumar Agarwal");
const g = p.rows[0];
check("PALMS: every column read by header text across spacer columns", g.p === 24 && g.a === 2 && g.l === 0 && g.m === 2 && g.s === 1 && g.rgi === 12 && g.rgo === 7 && g.rri === 5 && g.rro === 8 && g.visitors === 4 && g.oneToOnes === 25 && g.tyfcb === 181650 && g.ceu === 15, JSON.stringify(g));

const s = parseSponsorReport(sponsor);
check("Sponsor: range + chapter", s.from === "2026-03-31" && s.to === "2026-10-14" && s.chapterName === "Influencers" && s.errors.length === 0);
check("Sponsor: one row per sponsored person with names, chapter and application date", s.rows.length === 3 && s.rows[0].sponsor === "Saumitra Agarwal" && s.rows[0].sponsored === "Prabhav Agarwal" && s.rows[0].sponsoredChapter === "Stars" && s.rows[0].applicationDate === "2026-06-19" && s.rows[2].sponsor === "Neraj K Anand" && s.rows[2].sponsored === "Nikhil Anand Malik", JSON.stringify(s.rows));

check("the wrong parser refuses the other report with a clear message", parseSponsorReport(palms).errors.length === 1 && parsePalmsSummaryReport(sponsor).errors.length === 1 && /Not a Chapter/.test(parsePalmsSummaryReport(other).errors[0]));
const noDates = book([["Chapter ► Sponsor Report"], ["Parameters"], ["Sponsor First Name", "Sponsor Last Name", "", "Total Members Sponsored", "Sponsored First Name", "", "Sponsored Last Name", "", "Sponsored Region", "Sponsored Chapter", "", "Application Date"]]);
check("a report without From/To is refused", parseSponsorReport(noDates).errors.length === 1);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
