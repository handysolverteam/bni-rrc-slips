// Grounding check for chat answers (lib/chat/verify-answer.ts): correct answers pass, the mistakes seen in the real
// chat (merged bands, members moved between teams, filler lines, wrong counts / totals) are caught.
// Run: node tests/unit-verify-answer.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/chat/verify-answer.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); };
const mem = (name, value) => ({ name, value });

// A TYFCB-style banded tool result (3 bands) and a Power-Team result (2 teams).
const bandsResult = {
  rowCount: 6,
  totals: { tyfcbAmount: 1000500 },
  bands: [
    { band: "0", count: 1, members: [mem("Ankush Bhat", 0)] },
    { band: "above ₹0 up to ₹10,00,000", count: 3, members: [mem("Arminderpal Singh", 13000), mem("Suraj Yadav", 62000), mem("Rahul Bajaj", 943300)] },
    { band: "above ₹10,00,000 up to ₹50,00,000", count: 2, members: [mem("Nishant Tanwar", 1005000), mem("Annie Jain", 1081224)] },
  ],
};
const teamsResult = {
  totalMembers: 5,
  teams: [
    { team: "HR / Admin", count: 3, members: ["Abhay Mehta", "Amit Chandna", "Arminderpal Singh"] },
    { team: "Construction", count: 2, members: ["Abhay Goenka", "Rohit Kumar"] },
  ],
};

const good = `TYFCB
0 (1 Member)
1. Ankush Bhat – ₹0

Up to ₹10 Lakh (3 Members)
1. Arminderpal Singh – ₹13,000
2. Suraj Yadav – ₹62,000
3. Rahul Bajaj – ₹9,43,300

₹10–50 Lakh (2 Members)
1. Nishant Tanwar – ₹10,05,000
2. Annie Jain – ₹10,81,224

TOTAL: 6 MEMBERS · ₹10,00,500

Filters applied: Home chapter`;
const facts = m.collectFacts([bandsResult]);
check("a correct banded answer passes", m.findProblems(good, facts).length === 0, JSON.stringify(m.findProblems(good, facts)));

const merged = good.replace("₹10–50 Lakh (2 Members)", "REMOVED").replace("Up to ₹10 Lakh (3 Members)", "Everything (5 Members)").replace("REMOVED\n", "").replace("\n\n1. Nishant", "\n1. Nishant");
const mp = m.findProblems(merged, facts);
check("two bands merged into one block are caught", mp.some((p) => /mixes members/.test(p)), JSON.stringify(mp));

const wrongCount = good.replace("Up to ₹10 Lakh (3 Members)", "Up to ₹10 Lakh (4 Members)");
check("a heading count that differs from its lines is caught", m.findProblems(wrongCount, facts).some((p) => /says 4/.test(p)));

const wrongValue = good.replace("₹62,000", "₹72,000");
check("a number the data never returned is caught", m.findProblems(wrongValue, facts).some((p) => /72,000/.test(p)));

const wrongTotal = good.replace("₹10,00,500", "₹10,00,900");
check("a wrong TOTAL figure is caught", m.findProblems(wrongTotal, facts).some((p) => /total figure/.test(p)));

const tf = m.collectFacts([teamsResult]);
const teamsGood = `HR / Admin (3 Members)
1. Abhay Mehta
2. Amit Chandna
3. Arminderpal Singh

Construction (2 Members)
1. Abhay Goenka
2. Rohit Kumar

Total: 5 members`;
check("a correct team list passes", m.findProblems(teamsGood, tf).length === 0, JSON.stringify(m.findProblems(teamsGood, tf)));

const moved = teamsGood.replace("2. Amit Chandna", "2. Rohit Kumar");
check("a member moved into the wrong team is caught", m.findProblems(moved, tf).length > 0, JSON.stringify(m.findProblems(moved, tf)));

const filler = teamsGood.replace("2. Rohit Kumar", "2. (Note: additional members mapped directly in respective teams)");
check("a filler / invented line is caught", m.findProblems(filler, tf).some((p) => /not a name/.test(p)), JSON.stringify(m.findProblems(filler, tf)));

const prose = `Here is what I suggest:
1. Check the Members page
2. Ask again tomorrow

Filters applied: none`;
check("numbered advice (no figures) is not treated as a list", m.findProblems(prose, facts).length === 0, JSON.stringify(m.findProblems(prose, facts)));

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
