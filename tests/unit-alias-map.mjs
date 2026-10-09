// Pure checks for lib/alias-map.ts: remembered-merge mapping + look-alike suggestions.
// Run: node tests/unit-alias-map.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/alias-map.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

const map = new Map([
  ["amit k bahl", "Amit Bahl"],
  ["a bahl", "Amit K Bahl"], // chain: A Bahl -> Amit K Bahl -> Amit Bahl
]);
check("alias maps to the canonical name (case/space insensitive)", m.resolveAlias(map, "  AMIT  k  Bahl ") === "Amit Bahl");
check("alias chains collapse", m.resolveAlias(map, "A Bahl") === "Amit Bahl");
check("unknown names pass through", m.resolveAlias(map, "Bina Shah") === "Bina Shah");
const loop = new Map([["a b", "C D"], ["c d", "A B"]]);
check("a merge cycle cannot hang", typeof m.resolveAlias(loop, "A B") === "string");

// report rows: guest of a Visitor slip is never aliased
const rows = [
  { from: "Amit K Bahl", to: "Rita Shah", slipType: "Referral" },
  { from: "Rita Shah", to: "Amit K Bahl", slipType: "Visitor" }, // To = the guest
  { from: "Amit K Bahl", to: "", slipType: "CEU" },
];
const out = m.aliasReportRows(rows, map);
check("From/To mapped on member slips", out[0].from === "Amit Bahl" && out[2].from === "Amit Bahl");
check("a visitor's own name (To) is left alone", out[1].to === "Amit K Bahl");
check("empty map returns the same rows", m.aliasReportRows(rows, new Map()) === rows);

// PALMS: two spellings of one person become one row, cells combined
const members = [
  { name: "Amit Bahl", cells: ["P", null, null] },
  { name: "Amit K Bahl", cells: [null, "M", "P"] },
  { name: "Bina Shah", cells: ["A", null, null] },
];
const merged = m.aliasPalmsMembers(members, map);
check("PALMS spellings collapse into one member", merged.length === 2 && merged[0].name === "Amit Bahl");
check("their cells are combined (first letter per week wins)", JSON.stringify(merged[0].cells) === JSON.stringify(["P", "M", "P"]));

// look-alikes
const s = (a, b) => m.similarScore(a, b);
check("middle initial", s("Amit K Bahl", "Amit Bahl") === 3);
check("first initial only", s("A. Bahl", "Amit Bahl") === 3);
check("one-letter typo", s("Kunnal Gupta", "Kunal Gupta") === 3);
check("middle name", s("Rajesh Agarwal", "Rajesh Kumar Agarwal") >= 2);
check("same name is not a candidate", s("Amit Bahl", "amit  bahl") === 0);
check("different first name, same surname is not a candidate", s("Amit Gupta", "Rahul Gupta") === 0 && s("Sandeep Chopra", "Sunil Chopra") === 0);
check("single words never match", s("Amit", "Amit Bahl") === 0);
const found = m.findSimilar("Amit K Bahl", ["Amit Bahl", "Bina Shah", "Amit Gupta", "A Bahl"]);
check("findSimilar returns look-alikes only", found.includes("Amit Bahl") && !found.includes("Bina Shah") && !found.includes("Amit Gupta"), JSON.stringify(found));

// form value
const picks = m.parseMergePicks(JSON.stringify({ " Amit K Bahl ": "Amit Bahl", Same: "same", Bad: 5, "": "x" }));
check("merge picks: trimmed, junk and self-merges dropped", JSON.stringify(picks) === JSON.stringify({ "Amit K Bahl": "Amit Bahl" }), JSON.stringify(picks));
check("merge picks: garbage input is empty", Object.keys(m.parseMergePicks("not json")).length === 0 && Object.keys(m.parseMergePicks(null)).length === 0);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
