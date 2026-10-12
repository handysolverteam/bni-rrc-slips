// Pure checks for lib/export-name.ts (default export names from the filters + typed-name cleaning).
// Run: node tests/unit-export-name.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/export-name.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};
const q = (s) => new URLSearchParams(s);

let n = m.reportDefaultName({ scopeLabel: "7 October 2026 (Week 41)", tab: "all", query: q("") });
check("one week, all tabs", n === "slip-report_7-October-2026-Week-41", n);

n = m.reportDefaultName({ scopeLabel: "7 October 2026 (Week 41)", tab: "tyfcb", query: q("") });
check("tab is part of the name", n === "slip-report_7-October-2026-Week-41_tyfcb", n);

n = m.reportDefaultName({ scopeLabel: "All weeks", tab: "one-to-one", query: q("") });
check("121 tab + all weeks", n === "slip-report_All-weeks_121", n);

n = m.reportDefaultName({
  scopeLabel: "5 meetings",
  tab: "referral",
  query: q("cf_referral_from=Amit Bahl&cf_referral_to=Neha Goel,Rahul Bajaj&q=gupta&page=3&week=abc"),
});
check("text filters are named, page / week params are not", n === "slip-report_5-meetings_referrals_search-gupta_from-Amit-Bahl_to-Neha-Goel-Rahul-Bajaj", n);

n = m.reportDefaultName({ scopeLabel: "x".repeat(300), tab: "all", query: q("cf_tyfcb_from=" + "y".repeat(300)) });
check("names stay short", n.length <= 110, String(n.length));

n = m.reportDefaultName({ scopeLabel: "Café — Week ½", tab: "all", query: q("") });
check("no path / reserved characters survive", /^[A-Za-z0-9._-]+$/.test(n), n);

n = m.attendanceDefaultName({ scopeLabel: "All weeks" });
check("attendance name", n === "attendance_All-weeks", n);
n = m.attendanceDefaultName({ scopeLabel: "2 Sep 2026 + 9 Sep 2026" });
check("attendance multi-week", n === "attendance_2-Sep-2026-9-Sep-2026", n);

// typed names
check("typed name keeps spaces and drops illegal characters", m.cleanFileName('  My: "report"/v2?  ', "xlsx") === "My report v2");
check("a typed extension is not doubled", m.cleanFileName("june-top3.XLSX", "xlsx") === "june-top3");
check("empty / only illegal characters -> empty", m.cleanFileName(' / : * ', "csv") === "");
check("leading dots and trailing dots/spaces are removed", m.cleanFileName("..hidden. ", "pdf") === "hidden");
check("very long names are capped", m.cleanFileName("a".repeat(400), "pdf").length === 150);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
