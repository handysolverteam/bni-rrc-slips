// Pure checks for lib/period.ts: the one "last 6 months" window used everywhere (BNI / go-green rule: ends on an
// anchor date, starts the day after the same date 6 months earlier; holds 26 or 27 meetings).
// Run: node tests/unit-period.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/period.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const p = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

// The chapter's real 28 Wednesday meetings (1 Apr – 7 Oct 2026)
const meetings = [
  "2026-04-01", "2026-04-08", "2026-04-15", "2026-04-22", "2026-04-29",
  "2026-05-06", "2026-05-13", "2026-05-20", "2026-05-27",
  "2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24",
  "2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29",
  "2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26",
  "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30",
  "2026-10-07",
];
const count = (w) => meetings.filter((d) => p.inWindow(d, w)).length;

const sep = p.rollingWindow("2026-09-30");
const oct = p.rollingWindow("2026-10-07");
check("anchor 30 Sep -> 31 Mar..30 Sep (BNI's September report: 27 meetings)", sep.from === "2026-03-31" && sep.to === "2026-09-30" && count(sep) === 27, JSON.stringify(sep) + " " + count(sep));
check("anchor 7 Oct (latest meeting) -> 8 Apr..7 Oct = 27 meetings, today's 'last 6 months'", oct.from === "2026-04-08" && oct.to === "2026-10-07" && count(oct) === 27, JSON.stringify(oct) + " " + count(oct));
check("a window can hold 26 meetings (anchor 23 Sep -> 24 Mar..23 Sep minus the 30 Sep end = 26)", count(p.rollingWindow("2026-09-23")) === 26, String(count(p.rollingWindow("2026-09-23"))));
check("start day is clamped to the shorter month (anchor 31 Aug -> 28 Feb + 1 = 1 Mar)", p.rollingWindow("2026-08-31").from === "2026-03-01" && p.rollingWindow("2024-08-31").from === "2024-03-01" && p.rollingWindow("2026-02-28").from === "2025-08-29");
check("crossing a year end", p.rollingWindow("2026-02-04").from === "2025-08-05" && p.rollingWindow("2026-02-04").to === "2026-02-04");
check("12 months is supported (go-green's yearly view) and bad input gives null", p.rollingWindow("2026-09-30", 12).from === "2025-10-01" && p.rollingWindow("nope") === null && p.rollingWindow(null) === null && p.rollingWindow("2026-09-30", 0) === null);
check("windowForDates anchors on the newest meeting", JSON.stringify(p.windowForDates(meetings)) === JSON.stringify(oct) && p.windowForDates([]) === null && p.windowForDates([null, undefined, "x"]) === null);
check("latestDate ignores blanks and junk", p.latestDate(["2026-01-07", null, "2026-03-04T00:00:00Z", "bad"]) === "2026-03-04");
check("anchorForMonth: a finished month anchors on its last day, the running month on the newest meeting", p.anchorForMonth("2026-09", "2026-10-07") === "2026-09-30" && p.anchorForMonth("2026-10", "2026-10-07") === "2026-10-07" && p.anchorForMonth("2026-10", null) === "2026-10-31" && p.anchorForMonth("2026-02", "2026-10-07") === "2026-02-28");
check("inWindow is inclusive of both ends and ignores blanks", p.inWindow("2026-04-08", oct) && p.inWindow("2026-10-07", oct) && !p.inWindow("2026-04-07", oct) && !p.inWindow("2026-10-08", oct) && !p.inWindow(null, oct) && p.inWindow("2026-10-07T10:00:00Z", oct));
check("month key", p.monthKeyOf("2026-09-30") === "2026-09" && p.monthKeyOf("x") === null);
check("labels state the weeks the window holds", p.windowLabel(oct, 27) === "8 April – 7 October 2026 · 27 weeks" && p.windowLabel(p.rollingWindow("2026-02-04"), 26) === "5 August 2025 – 4 February 2026 · 26 weeks" && p.windowLabel(oct, 1) === "8 April – 7 October 2026 · 1 week" && p.windowTitle(oct, 27) === "Last 6 months (27 weeks)");

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
