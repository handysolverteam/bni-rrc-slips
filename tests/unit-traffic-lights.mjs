// Pure checks for the Traffic Lights screen: tier scoring (boundaries + REAL rows of BNI's September '26 file),
// the 6-month window, the per-member assembly (proration, other-chapter rows, hybrid BNI sourcing,
// name matching) and the BNI Excel parser.
// Run: node tests/unit-traffic-lights.mjs
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as XLSX from "xlsx";

const opts = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const asUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");

const score = await import(asUrl(ts.transpileModule(read("../lib/traffic-light-score.ts"), opts).outputText));
const calcSrc = ts.transpileModule(read("../lib/traffic-light-calc.ts"), opts).outputText.replace(
  '"@/lib/traffic-light-score"',
  JSON.stringify(asUrl(ts.transpileModule(read("../lib/traffic-light-score.ts"), opts).outputText)),
);
const calc = await import(asUrl(calcSrc));
// The parser imports the bare "xlsx" package, so it is written next to the tests (where node can resolve it).
const impPath = fileURLToPath(new URL("./_tl_import.tmp.mjs", import.meta.url));
writeFileSync(impPath, ts.transpileModule(read("../lib/traffic-light-import.ts"), opts).outputText);
const imp = await import("./_tl_import.tmp.mjs");
unlinkSync(impPath);

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

// ---- tiers (boundaries)
const P = score.pointsFor;
check("attendance: <88% 0, 88% 5, 96% 10", P("attendance", 0.879) === 0 && P("attendance", 0.88) === 5 && P("attendance", 0.959) === 5 && P("attendance", 0.96) === 10 && P("attendance", 1) === 10);
check("CEU: 0 -> 0, any credit 5, > 0.5 per week 10", P("ceu", 0) === 0 && P("ceu", 0.0741) === 5 && P("ceu", 0.5) === 5 && P("ceu", 0.5556) === 10);
check("121: 0.25 / 0.5 / 0.75 / 1 per week -> 5 / 10 / 15 / 20", P("oneToOne", 0.24) === 0 && P("oneToOne", 0.25) === 5 && P("oneToOne", 0.5) === 10 && P("oneToOne", 0.75) === 15 && P("oneToOne", 1) === 20 && P("oneToOne", 3.4) === 20);
check("referrals: 0.25 … 1.25 per week -> 5 … 25", P("referrals", 0.2) === 0 && P("referrals", 0.25) === 5 && P("referrals", 1) === 20 && P("referrals", 1.25) === 25 && P("referrals", 3) === 25);
check("TYFCB: ₹1 / 85k / 210k / 625k / 1.25M -> 1…5", P("tyfcb", 0) === 0 && P("tyfcb", 1) === 1 && P("tyfcb", 84999) === 1 && P("tyfcb", 85000) === 2 && P("tyfcb", 598961) === 3 && P("tyfcb", 625000) === 4 && P("tyfcb", 1250000) === 5);
check("visitors: 1..5 -> 5..25, sponsors >=1 -> 5", P("visitors", 0) === 0 && P("visitors", 1) === 5 && P("visitors", 4) === 20 && P("visitors", 9) === 25 && P("sponsors", 0) === 0 && P("sponsors", 2) === 5);
check("maximum points add up to 100", Object.values(score.MAX_POINTS).reduce((a, b) => a + b, 0) === 100);
check("lights: 70 green, 50 amber, 30 red, below grey", score.lightFor(100) === "green" && score.lightFor(70) === "green" && score.lightFor(69) === "amber" && score.lightFor(50) === "amber" && score.lightFor(49) === "red" && score.lightFor(30) === "red" && score.lightFor(29) === "grey");

// ---- REAL rows of BNI's "Member Traffic Lights … SEPTEMBER '26": [att, ceu, 121, ref, tyfcb, visitors, sponsors] -> total
const real = [
  ["Ranjan Sapra", [1, 0.6296, 2.0741, 1.9259, 5042091, 15, 2], 100],
  ["Sunil Bindra", [1, 2.1481, 2.4444, 1.7778, 8717079, 5, 0], 95],
  ["Vaini Mehra", [1, 1.25, 3.25, 2.8125, 260625, 17, 0], 93],
  ["Komal Gupta", [0.963, 0.7778, 1.2222, 1.2963, 2535261, 3, 1], 90],
  ["Amit Gupta", [1, 0.963, 1.4444, 1.0741, 2875959, 1, 1], 75],
  ["Suraj Yadav", [1, 0.6, 1.3, 0.1, 12000, 5, 0], 66],
  ["Arun Ahuja", [1, 0.0741, 1.2222, 1.1111, 5437000, 1, 0], 65],
  ["Piyush Puri", [0.875, 0.25, 0.625, 0.4375, 406000, 5, 0], 48],
  ["Usha Kumar", [1, 0, 1.2222, 0.7778, 63900, 0, 0], 46],
  ["Rahul Bajaj", [0.8889, 0, 0.963, 0.2963, 883500, 0, 0], 29],
  ["Priyatna Basu", [1, 0, 0.5556, 0.3704, 120551, 0, 0], 27],
];
const totalOf = ([att, ceu, oto, ref, tyf, vis, spo]) =>
  P("attendance", att) + P("ceu", ceu) + P("oneToOne", oto) + P("referrals", ref) + P("tyfcb", tyf) + P("visitors", vis) + P("sponsors", spo);
for (const [name, inputs, expected] of real) check(`BNI Sept '26 row reproduces: ${name} = ${expected}`, totalOf(inputs) === expected, `got ${totalOf(inputs)}`);

// ---- window
check("window = the 6 calendar months ending in the report month", calc.windowStart("2026-09") === "2026-04-01" && calc.windowStart("2026-10") === "2026-05-01" && calc.windowStart("2026-02") === "2025-09-01");
const all = ["2026-03-25", "2026-04-01", "2026-09-30", "2026-10-07"].map((date, i) => ({ id: `w${i}`, date }));
check("windowMeetings keeps only meetings inside it", JSON.stringify(calc.windowMeetings(all, "2026-09").map((m) => m.date)) === JSON.stringify(["2026-04-01", "2026-09-30"]));

// ---- names
check("firstLastKey drops the middle initial", calc.firstLastKey("Ranjan K Sapra") === calc.firstLastKey("Ranjan  Sapra") && calc.firstLastKey("Dr. Hemesh Thakur") === "dr thakur" && calc.nameKey("  Neha   Goel ") === "neha goel");
const resolver = calc.makeResolver(["Ranjan K Sapra", "Ashwani Kumar", "Amit Gupta", "Amit K Gupta"]);
check("resolver: exact key, unique first+last, never an ambiguous or unknown name", resolver("ranjan  sapra") === "ranjan k sapra" && resolver("Ashwani Kumar") === "ashwani kumar" && resolver("Amit Gupta") === "amit gupta" && resolver("Amit R Gupta") === null && resolver("Nobody Here") === null);

// ---- assembly
const W = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({ id, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
const base = { referrals: [], oneToOnes: [], ceus: [], tyfcb: [], visitors: [], attendance: [] };
const rep = (n, week, extra = {}) => Array.from({ length: n }, () => ({ week, from: "Amit Gupta", ...extra }));
const slips = {
  ...base,
  // 6 referrals in 6 meetings = 1.0/week (+2 flagged other-chapter: another person with the same name)
  referrals: [...W.map((w) => ({ week: w.id, from: "Amit Gupta" })), ...rep(2, "a", { fromOther: true })],
  oneToOnes: [{ week: "a", a: "Amit Gupta", b: "Neha Goel" }, { week: "b", a: "Neha Goel", b: "Amit Gupta" }, { week: "c", a: "Amit Gupta", aOther: true, b: "Neha Goel" }],
  ceus: [{ week: "a", name: "Amit Gupta", credits: 3 }],
  tyfcb: [{ week: "a", name: "Amit Gupta", amount: 700000 }, { week: "z", name: "Amit Gupta", amount: 9e9 }],
  visitors: [{ week: "a", inviter: "Amit Gupta" }, { week: "b", inviter: "amit  gupta" }, { week: "a", inviter: null }],
  attendance: W.map((w) => ({ week: w.id, name: "Amit Gupta", present: 1, absent: 0, m: 0, s: 0, l: 0 })),
};
let rows = calc.buildTrafficRows({ members: ["Amit Gupta", "Neha Goel"], meetings: W, slips, bni: [] });
const amit = rows.find((r) => r.name === "Amit Gupta");
check("referrals per week: 6 in 6 meetings = 1.00, other-chapter rows skipped", amit.referrals.rate === 1 && amit.referrals.score === 20, JSON.stringify(amit.referrals));
check("121: both sides count, an other-chapter side does not", amit.oneToOne.rate === 2 / 6 && amit.oneToOne.score === 5, JSON.stringify(amit.oneToOne));
check("CEU / TYFCB / visitors come from the slips (window only, names normalised)", amit.ceu.rate === 0.5 && amit.ceu.score === 5 && amit.tyfcb.amount === 700000 && amit.tyfcb.score === 4 && amit.visitors.count === 2 && amit.visitors.source === "slips");
check("full attendance -> 100% from PALMS, 10 points; sponsors 0 without a BNI file", amit.attendance.rate === 1 && amit.attendance.score === 10 && amit.attendance.source === "palms" && amit.sponsors.count === 0 && amit.sponsors.source === "none");
check("total + colour", amit.total === 10 + 5 + 5 + 20 + 4 + 10 + 0 && amit.color === "amber", `${amit.total}`);
const neha = rows.find((r) => r.name === "Neha Goel");
check("no attendance at all -> 0 points and a note, never a guess", neha.attendance.source === "none" && neha.attendance.score === 0 && neha.notes.some((n) => /attendance not imported/.test(n)));

// part-year member: first attendance in meeting 3 of 6 -> 4 weeks
const late = W.slice(2).map((w) => ({ week: w.id, name: "Neha Goel", present: 1, absent: 0, m: 0, s: 0, l: 0 }));
rows = calc.buildTrafficRows({ members: ["Neha Goel"], meetings: W, slips: { ...base, attendance: late, ceus: [{ week: "c", name: "Neha Goel", credits: 2 }] }, bni: [] });
check("joined part-way: rates are divided by the weeks since first attendance (4, not 6)", rows[0].weeks === 4 && rows[0].prorated && rows[0].ceu.rate === 0.5, JSON.stringify(rows[0].ceu));

// hybrid: BNI visitors + sponsors + attendance when PALMS attendance is missing; weeks implied by BNI's rates
const bniRow = { name: "Amit  Gupta", total: 80, attendanceRate: 0.9565, attendanceScore: 10, ceuRate: 0.75, oneToOneRate: 0.5, referralsRate: 1.5, tyfcb: 700000, visitors: 5, sponsors: 1 };
rows = calc.buildTrafficRows({ members: ["Amit Gupta"], meetings: W, slips: { ...slips, attendance: [] }, bni: [bniRow] });
const h = rows[0];
check("BNI file: visitors + sponsors taken from it, tagged BNI", h.visitors.count === 5 && h.visitors.source === "bni" && h.visitors.slips === 2 && h.sponsors.count === 1 && h.sponsors.score === 5);
check("BNI file: attendance used when PALMS has none, with BNI's printed score (it rounds at the 96% line)", h.attendance.source === "bni" && h.attendance.score === 10);
check("BNI file: weeks implied from its rates (6 referrals / 1.5 = 4 weeks) and compared", h.weeks === 4 && h.prorated && h.bni && h.bni.total === 80, `weeks ${h.weeks}`);
check("BNI comparison marks a match or the difference", h.bni.matches === (h.total === 80));

// ---- parser
const wb = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ["MEMBER TRAFFIC LIGHTS OF INFLUENCERS CHAPTER FOR SEPTEMBER '26"],
  ["Chapter", "Name", "Total Score", "Attendance Rate", "Attendance Score", "CEU Rate", "CEU Score", "121 Rate", "121 Score", "Referrals Given Rate", "Referrals Given Score", "TYFCB", "TYFCB Score", "Visitors", "Visitor Score", "Sponsors", "Sponsor Score"],
  ["Influencers", "Ranjan  Sapra", 100, 1, 10, 0.6296, 10, 2.0741, 20, 1.9259, 25, 5042091, 5, 15, 25, 2, 5],
  ["Influencers", "Usha Kumar", 46, 1, 10, 0, 0, 1.2222, 20, 0.7778, 15, 63900, 1, 0, 0, 0, 0],
]);
XLSX.utils.book_append_sheet(wb, sheet, "Influencers");
const parsed = imp.parseBniTrafficLights(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
check("parser: month from the title, rows by header text", parsed.month === "2026-09" && parsed.reportMonth === "2026-09-01" && parsed.rows.length === 2 && parsed.rows[0].name === "Ranjan Sapra" && parsed.rows[0].visitors === 15 && parsed.rows[0].sponsors === 2 && parsed.rows[1].tyfcb === 63900);
check("monthFromTitle variants", imp.monthFromTitle("… FOR SEPTEMBER '26") === "2026-09" && imp.monthFromTitle("FOR Oct 2026") === "2026-10" && imp.monthFromTitle("no month here") === null);
const bad = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(bad, XLSX.utils.aoa_to_sheet([["Some other report"], ["a", "b"]]), "x");
let msg = "";
try {
  imp.parseBniTrafficLights(XLSX.write(bad, { type: "buffer", bookType: "xlsx" }));
} catch (e) {
  msg = e.message;
}
check("parser: a different report is refused with a plain message", /not BNI's Member Traffic Lights/.test(msg), msg);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
