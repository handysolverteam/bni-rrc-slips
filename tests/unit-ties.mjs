// Pure checks for lib/ties.ts: ties at the cut-off of a "top N" list.
// Run: node tests/unit-ties.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/ties.ts", import.meta.url), "utf8");
const t = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};
const v = (x) => x.value;
const names = (xs) => xs.map((x) => x.name).join(",");
const L = (...vals) => vals.map((value, i) => ({ name: "m" + (i + 1), value }));

check("no tie at the cut-off: exactly n", names(t.withTies(L(10, 8, 5, 4, 1), 3, v)) === "m1,m2,m3");
check("tie for the last place: everybody tied with it is included (3rd, 4th, 5th all on 5)", names(t.withTies(L(10, 8, 5, 5, 5, 4), 3, v)) === "m1,m2,m3,m4,m5");
check("a tie ABOVE the cut-off changes nothing (1st and 2nd tied, 3rd alone)", names(t.withTies(L(10, 10, 5, 4), 3, v)) === "m1,m2,m3");
check("two tied for 2nd: the 3rd entry is the second tied one, nobody extra", names(t.withTies(L(10, 8, 8, 5), 3, v)) === "m1,m2,m3");
check("everybody tied: all of them", names(t.withTies(L(5, 5, 5, 5, 5), 3, v)) === "m1,m2,m3,m4,m5");
check("fewer than n items: all of them", names(t.withTies(L(10, 8), 3, v)) === "m1,m2" && t.withTies([], 3, v).length === 0);
check("a cut-off value of 0 never extends (nobody did anything)", names(t.withTies(L(10, 4, 0, 0, 0, 0), 3, v)) === "m1,m2,m3" && names(t.withTies(L(10, 0, 0, 0), 3, v)) === "m1,m2,m3");
check("n <= 0 -> nothing; the input list is not modified", t.withTies(L(1, 2), 0, v).length === 0 && (() => { const a = L(5, 5, 5, 5); t.withTies(a, 2, v); return a.length === 4; })());
check("ascending order (fewest first) works the same", names(t.withTies(L(1, 2, 3, 3, 3, 9), 3, v)) === "m1,m2,m3,m4,m5");
check("competitionRanks: 1, 2, 2, 4", JSON.stringify(t.competitionRanks([10, 8, 8, 5])) === "[1,2,2,4]" && JSON.stringify(t.competitionRanks([5, 5, 5])) === "[1,1,1]" && JSON.stringify(t.competitionRanks([9, 5, 3, 3])) === "[1,2,3,3]" && t.competitionRanks([]).length === 0);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
