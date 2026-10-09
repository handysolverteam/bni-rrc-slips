// Pure checks for lib/file-chapter.ts + the real PALMS sample (fixtures/).
// Run: node tests/unit-file-chapter.mjs
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import XLSX from "xlsx";

const src = readFileSync(new URL("../lib/file-chapter.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

// value below the "Chapter" cell (slips header block / PALMS Z2:Z3)
check("name below the Chapter cell", m.findChapterName([["Title"], ["", "Chapter"], ["", "Influencers"]]) === "Influencers");
// value to the right (PALMS parameter row)
check("name to the right of the Chapter cell", m.findChapterName([["Parameters"], ["Chapter", "", "", "Influencers"], ["From:", "", "", 1]]) === "Influencers");
// "Chapter ► Report" title and "Other Member's Chapter" headers never match
check("title / data-column headers are not the label", m.findChapterName([["Chapter ► PALMS Attendance Report"], ["Other Member's Chapter", "x"]]) === null);
// a label below is skipped (A5 Chapter / A6 From:)
check("a label below is skipped for the right-hand value", m.findChapterName([["Chapter", "", "BNI Pioneers"], ["From:", "", 1]]) === "BNI Pioneers");
check("no chapter -> null", m.findChapterName([["a", "b"], ["c", "d"]]) === null);

// naming
check("Influencers -> BNI Influencers", m.normalizeChapterName("Influencers") === "BNI Influencers");
check("BNI prefix kept, region dropped", m.normalizeChapterName("BNI Pioneers, Faridabad, India") === "BNI Pioneers");
check("chapterKey ignores BNI/plural-less spelling of the same word", m.chapterKey("BNI Influencers") === m.chapterKey("Influencers"));
check("chapterKey separates different chapters", m.chapterKey("Energizers, Gurgaon, India") !== m.chapterKey("BNI Influencers"));

// the real export (when the fixture is present)
const fx = new URL("../fixtures/palms-sample-08-10-2026.xls", import.meta.url);
if (existsSync(fx)) {
  const wb = XLSX.readFile(fx.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const mat = XLSX.utils.sheet_to_json(wb.Sheets["Report"], { header: 1, defval: "" });
  check("real PALMS file: chapter = Influencers", m.findChapterName(mat.slice(0, 7)) === "Influencers");
}

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
