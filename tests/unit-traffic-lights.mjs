// Pure checks for the Traffic Lights screen: tier scoring (boundaries + REAL rows of BNI's September '26 report) and the
// per-member assembly from the two imported BNI reports (Chapter Summary PALMS Report + Chapter Sponsor Report).
// Run: node tests/unit-traffic-lights.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const opts = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const asUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");

const score = await import(asUrl(ts.transpileModule(read("../lib/traffic-light-score.ts"), opts).outputText));
const calcSrc = ts.transpileModule(read("../lib/traffic-light-calc.ts"), opts).outputText.replace(
  '"@/lib/traffic-light-score"',
  JSON.stringify(asUrl(ts.transpileModule(read("../lib/traffic-light-score.ts"), opts).outputText)),
);
const calc = await import(asUrl(calcSrc));
let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

// ---- tiers (boundaries)
const P = score.pointsFor;
check("attendance: <88% 0, 88% 5, 96% 10", P("attendance", 0.879) === 0 && P("attendance", 0.88) === 5 && P("attendance", 0.959) === 5 && P("attendance", 0.96) === 10 && P("attendance", 1) === 10);
check("attendance is scored on the whole percent, half-down (BNI: 22/23 = 95.65% -> 10 pts, 14/16 = 87.5% -> 0)", score.attendancePoints(22 / 23) === 10 && score.attendancePoints(14 / 16) === 0 && score.attendancePoints(25 / 27) === 5 && score.attendancePoints(24 / 26) === 5 && score.attendancePoints(26 / 27) === 10 && score.attendancePoints(0.8889) === 5 && score.attendancePoints(0.5) === 0);
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

// ---- names
check("firstLastKey drops the middle initial", calc.firstLastKey("Ranjan K Sapra") === calc.firstLastKey("Ranjan  Sapra") && calc.firstLastKey("Dr. Hemesh Thakur") === "dr thakur" && calc.nameKey("  Neha   Goel ") === "neha goel");
const resolver = calc.makeResolver(["Ranjan K Sapra", "Ashwani Kumar", "Amit Gupta", "Amit K Gupta"]);
check("resolver: exact key, unique first+last, never an ambiguous or unknown name", resolver("ranjan  sapra") === "ranjan k sapra" && resolver("Ashwani Kumar") === "ashwani kumar" && resolver("Amit Gupta") === "amit gupta" && resolver("Amit R Gupta") === null && resolver("Nobody Here") === null);

// ---- assembly from the imported BNI reports (Chapter Summary PALMS Report + Chapter Sponsor Report)
const line = (o) => ({ name: "Amit Gupta", p: 0, a: 0, l: 0, m: 0, s: 0, rgi: 0, rgo: 0, visitors: 0, oneToOnes: 0, tyfcb: 0, ceu: 0, ...o });
const RANGE = { from: "2026-03-31", to: "2026-10-14" };
const build = (rows, sponsors = []) => calc.buildTrafficRows({ rows, sponsors, ...RANGE });

check("Wednesdays between 31 Mar and 14 Oct 2026 = 29", calc.wednesdaysBetween("2026-03-31", "2026-10-14") === 29 && calc.wednesdaysBetween("2026-10-14", "2026-03-31") === 0);

// a real line of the 14 Oct 2026 PALMS report (Garima Agarwal): P24 A2 L0 M2 S1, RGI12 RGO7, V4, 1-2-1 25, TYFCB 181650, CEU 15
{
  const g = build([line({ name: "Garima Agarwal", p: 24, a: 2, m: 2, s: 1, rgi: 12, rgo: 7, visitors: 4, oneToOnes: 25, tyfcb: 181650, ceu: 15 })])[0];
  check("weeks = P + A + L + M + S = 29; attendance = (29 - 2) / 29", g.weeks === 29 && Math.abs(g.attendance.rate - 27 / 29) < 1e-12 && g.attendance.score === 5, `${g.weeks} ${g.attendance.rate}`);
  check("rates per week: CEU 15/29, 121 25/29, referrals (RGI + RGO) 19/29", Math.abs(g.ceu.rate - 15 / 29) < 1e-12 && g.ceu.score === 10 && Math.abs(g.oneToOne.rate - 25 / 29) < 1e-12 && g.oneToOne.score === 15 && Math.abs(g.referrals.rate - 19 / 29) < 1e-12 && g.referrals.score === 10);
  check("TYFCB amount + visitors straight from the report", g.tyfcb.amount === 181650 && g.tyfcb.score === 2 && g.visitors.count === 4 && g.visitors.score === 20);
  check("total + colour: 5 + 10 + 15 + 10 + 2 + 20 + 0 = 62 -> amber", g.total === 62 && g.color === "amber", String(g.total));
  check("a complete lettered run needs no note", g.notes.length === 0 || g.notes.every((n) => /lettered weeks/.test(n)));
}

// sponsors come from the Sponsor Report only
{
  const members = [line({ name: "Pranati Bajaj", p: 20 }), line({ name: "Ranjan K Sapra", p: 20 }), line({ name: "Komal Gupta", p: 20 })];
  const sponsors = [
    { sponsor: "Pranati Bajaj", sponsored: "Dheeraj Parcha", applicationDate: "2026-07-07" }, // sponsored into ANOTHER chapter still counts
    { sponsor: "Ranjan Sapra", sponsored: "Yoginder Kalra", applicationDate: "2026-05-20" }, // BNI prints no middle initial
    { sponsor: "Ranjan Sapra", sponsored: "Piyush Puri", applicationDate: "2026-06-17" },
    { sponsor: "Komal Gupta", sponsored: "Old Application", applicationDate: "2026-01-02" }, // before the range
    { sponsor: "BNI Website", sponsored: "Annie Jain", applicationDate: "2026-03-31" }, // not a member
  ];
  const r = build(members, sponsors);
  const by = (n) => r.find((x) => x.name === n).sponsors;
  check("sponsors: counted per Sponsor Report row, other-chapter sponsored members included", by("Pranati Bajaj").count === 1 && by("Pranati Bajaj").score === 5);
  check("sponsors: 'Ranjan Sapra' in the report is the member 'Ranjan K Sapra' (2 sponsored, 5 points)", by("Ranjan K Sapra").count === 2 && by("Ranjan K Sapra").score === 5);
  check("sponsors: an application date outside the range does not count; a non-member sponsor is ignored", by("Komal Gupta").count === 0 && by("Komal Gupta").score === 0);
  const none = build(members, null);
  check("no Sponsor Report imported -> 0 sponsors for everybody", none.every((x) => x.sponsors.count === 0));
}

// no letters at all: divide by the Wednesdays of the range, attendance 0 with a note
{
  const r = build([line({ name: "Neha Goel", oneToOnes: 29 })])[0];
  check("no attendance letters: weeks = Wednesdays in the range, attendance rate null / 0 points, noted", r.weeks === 29 && r.attendance.rate === null && r.attendance.score === 0 && r.oneToOne.rate === 1 && r.notes.some((n) => /no attendance letters/.test(n)), JSON.stringify(r));
}
// joined part-way
{
  const r = build([line({ name: "Neha Goel", p: 12 })])[0];
  check("12 lettered weeks of 29: rates use 12, attendance 100%, note explains", r.weeks === 12 && r.attendance.rate === 1 && r.notes.some((n) => /12 lettered weeks of 29/.test(n)), r.notes.join(" | "));
}
// attendance rule: leave / medical / substitute all count as attended
{
  const r = build([line({ name: "Neha Goel", p: 20, a: 1, l: 1, m: 2, s: 2 })])[0];
  check("(weeks - absents) / weeks: 1 absent in 26 = 25/26 -> 96% -> 10 points", Math.abs(r.attendance.rate - 25 / 26) < 1e-12 && r.attendance.score === 10);
}
// sorting
{
  const r = calc.sortTrafficRows(build([line({ name: "B Low", p: 20 }), line({ name: "A High", p: 20, visitors: 6, oneToOnes: 40, rgi: 40, tyfcb: 2000000, ceu: 30 }), line({ name: "A Low", p: 20 })]));
  check("highest score first, ties by name", r[0].name === "A High" && r[1].name === "A Low" && r[2].name === "B Low");
}

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
