// Pure checks for the "Last 6 months" entry that every week dropdown shares (lib/weeks.ts + lib/period.ts).
// Run: node tests/unit-weeks-window.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const opts = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const asUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const periodUrl = asUrl(ts.transpileModule(read("../lib/period.ts"), opts).outputText);
const w = await import(asUrl(ts.transpileModule(read("../lib/weeks.ts"), opts).outputText.replace('"@/lib/period"', JSON.stringify(periodUrl))));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

const dates = ["2026-04-01", "2026-04-08", "2026-04-15", "2026-04-22", "2026-04-29", "2026-05-06", "2026-05-13", "2026-05-20", "2026-05-27", "2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24", "2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07"];
const weeks = dates.map((d, i) => ({ id: "id" + i, label: `${d} label`, meeting_date: d, week_no: i + 1 }));

const opt = w.lastSixMonthsOption(weeks);
check("the option reads 'Last 6 months (27 weeks)' for the current data (8 Apr – 7 Oct)", opt && opt.value === "last6m" && opt.label === "Last 6 months (27 weeks)", JSON.stringify(opt));
check("it holds exactly the 27 weeks of the window, oldest being 8 April", (() => { const ws = w.lastSixMonthsWeeks(weeks); return ws.length === 27 && ws[0].meeting_date === "2026-04-08" && ws.at(-1).meeting_date === "2026-10-07"; })());
check("the window follows the newest week (a list ending 30 Sep -> 31 Mar..30 Sep = 27 weeks, 6 fewer weeks of data -> 26)", w.lastSixMonthsWeeks(weeks.slice(0, 27)).length === 27 && w.lastSixMonthsOption(weeks.slice(0, 26)).label === "Last 6 months (26 weeks)");
check("no weeks -> no option", w.lastSixMonthsOption([]) === null && w.lastSixMonthsWeeks([]).length === 0);
check("weeks without dates are ignored", w.lastSixMonthsOption([{ id: "a", label: "x", meeting_date: null }]) === null);

const f = w.weekFilterOptions(weeks);
check("column filter options: All weeks, then Last 6 months, then every week", f[0].value === "all" && f[1].value === "last6m" && f.length === 2 + weeks.length && f[2].value === "id0");
const c = w.weekChoiceOptions(weeks);
check("week box options (it adds its own 'All'): Last 6 months first, then every week", c[0].value === "last6m" && c.length === 1 + weeks.length);
check("with no weeks the dropdown has no preset", w.weekFilterOptions([]).length === 1 && w.weekChoiceOptions([]).length === 0);

check("expandWeekToken: last6m -> the 27 real ids (comma list)", w.expandWeekToken("last6m", weeks).split(",").length === 27 && w.expandWeekToken("last6m", weeks).split(",")[0] === "id1");
check("expandWeekToken: ordinary values are untouched", w.expandWeekToken("all", weeks) === "all" && w.expandWeekToken("id3,id4", weeks) === "id3,id4" && w.expandWeekToken("", weeks) === "" && w.expandWeekToken(undefined, weeks) === "");
check("expandWeekToken: the token mixed with ids still expands (the dropdown keeps it exclusive)", w.expandWeekToken("id0,last6m", weeks).split(",").length === 27);

// ---- date range filter (`range:<from>..<to>` in the week parameter)
check("rangeToken: both ends, one end, reversed pair swapped, invalid -> empty", w.rangeToken("2026-04-01", "2026-09-30") === "range:2026-04-01..2026-09-30" && w.rangeToken("2026-04-01", "") === "range:2026-04-01.." && w.rangeToken("", "2026-09-30") === "range:..2026-09-30" && w.rangeToken("2026-09-30", "2026-04-01") === "range:2026-04-01..2026-09-30" && w.rangeToken("", "") === "" && w.rangeToken("nope", "2026-13") === "");
check("parseRangeToken: round trip, open ends, and non-range values -> null", JSON.stringify(w.parseRangeToken("range:2026-04-01..2026-09-30")) === JSON.stringify({ from: "2026-04-01", to: "2026-09-30" }) && w.parseRangeToken("range:..2026-09-30").from === "" && w.parseRangeToken("range:2026-04-01..").to === "" && w.parseRangeToken("all") === null && w.parseRangeToken("last6m") === null && w.parseRangeToken("range:garbage") === null && w.parseRangeToken(undefined) === null);
check("findRangeToken: finds the token inside a comma list", w.findRangeToken("id1,range:2026-04-01..2026-09-30") === "range:2026-04-01..2026-09-30" && w.findRangeToken("id1,id2") === null);
check("weeksInRange: meeting dates inside the range, both ends included", w.weeksInRange(weeks, "2026-04-01", "2026-04-29").map((x) => x.meeting_date).join() === "2026-04-01,2026-04-08,2026-04-15,2026-04-22,2026-04-29");
check("weeksInRange: open ends", w.weeksInRange(weeks, "2026-09-23", "").length === 3 && w.weeksInRange(weeks, "", "2026-04-08").length === 2 && w.weeksInRange(weeks, "", "").length === weeks.length);
check("weeksInRange: weeks without a meeting date never match", w.weeksInRange([{ id: "x", label: "x", meeting_date: null }], "", "").length === 0);
check("expandWeekToken: a range -> the ids of the weeks inside it (Apr..Sep 2026 = 27 weeks)", w.expandWeekToken("range:2026-04-01..2026-09-30", weeks).split(",").length === 27 && w.expandWeekToken("range:2026-04-01..2026-09-30", weeks).split(",")[0] === "id0");
check("expandWeekToken: a range with no imported week -> the id that matches nothing (never an empty string = 'everything')", w.expandWeekToken("range:2030-01-01..2030-02-01", weeks) === w.NO_WEEK_ID && /^[0-9a-f-]{36}$/.test(w.NO_WEEK_ID));
check("expandWeekToken: the range wins over other picks in the same value", w.expandWeekToken("id0,range:2026-04-01..2026-04-08", weeks) === "id0,id1".split(",").slice(0, 2).join(","));
check("rangeTitle: both ends, one day, open ends", w.rangeTitle("2026-04-15", "2026-10-14") === "15 Apr 2026 – 14 Oct 2026" && w.rangeTitle("2026-04-15", "2026-04-15") === "15 Apr 2026" && w.rangeTitle("2026-04-15", "") === "From 15 Apr 2026" && w.rangeTitle("", "2026-10-14") === "Until 14 Oct 2026");
check("weekBounds: first and last meeting date", JSON.stringify(w.weekBounds(weeks)) === JSON.stringify({ min: "2026-04-01", max: "2026-10-07" }) && JSON.stringify(w.weekBounds([])) === JSON.stringify({ min: "", max: "" }));
{
  const tok = "range:2026-04-01..2026-04-29";
  const withRange = w.weekChoiceOptions(weeks, tok);
  check("the dropdowns list the active range first (so the box can show it)", withRange[0].value === tok && withRange[0].label === "1 Apr 2026 – 29 Apr 2026" && withRange.length === c.length + 1 && w.weekChoiceOptions(weeks).length === c.length && w.weekFilterOptions(weeks, tok)[1].value === tok);
}

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
