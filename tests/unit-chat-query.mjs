// Pure checks for lib/chat/query-index.ts: roster filters (chapter / status /
// where / includeZero), the "recent" scope and the slip_entries tool.
// Run: node tests/unit-chat-query.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/chat/query-index.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

const weeks = [
  { id: "w4", label: "Week 4", date: "2026-10-07" },
  { id: "w3", label: "Week 3", date: "2026-09-30" },
  { id: "w2", label: "Week 2", date: "2026-08-12" },
  { id: "w1", label: "Week 1", date: "2026-03-04" }, // far back: outside 6 months
];
const row = (w, key, name, over = {}) => ({
  w, m: key, n: name, rg: 0, ri: 0, ro: 0, rr: 0, oto: 0, vis: 0, te: 0, ta: 0, pr: 0, ab: 0, md: 0, su: 0, lv: 0, ...over,
});
const roster = [
  { key: "amit", name: "Amit", chapter: "BNI Influencers", home: true, active: true, category: null },
  { key: "bina", name: "Bina", chapter: "BNI Influencers", home: true, active: true, category: null },
  { key: "chet", name: "Chet", chapter: "BNI Influencers", home: true, active: false, category: null },
  { key: "dev", name: "Dev", chapter: "Energizers, Gurgaon, India", home: false, active: true, category: null },
];
const index = {
  weeks,
  rows: [
    row("w4", "amit", "Amit", { vis: 2, pr: 1 }),
    row("w3", "bina", "Bina", { rg: 3, ab: 1 }),
    row("w1", "chet", "Chet", { vis: 5 }), // outside the recent window
    row("w4", "dev", "Dev", { vis: 7 }),
  ],
  roster,
  entries: [
    { t: "visitor", w: "w4", a: "Amit", b: "Guest One" },
    { t: "visitor", w: "w3", a: "Amit", b: "Guest Two" },
    { t: "referral", w: "w3", a: "Bina", b: "Amit", io: "Inside" },
    { t: "tyfcb", w: "w4", a: "Amit", b: "Bina", amt: 5000 },
  ],
  homeChapter: "BNI Influencers",
};

// 1) active home members who brought 0 visitors in the last 6 months
let r = m.executeChapterQuery(
  {
    scope: { kind: "recent", months: 6 },
    chapter: "home",
    status: "active",
    where: { metric: "visitorsInvited", op: "eq", value: 0 },
    metrics: ["visitorsInvited"],
    topN: 100,
  },
  index,
);
check("0-visitor query returns only Bina (Amit brought 2, Chet inactive, Dev other chapter)", r.rowCount === 1 && r.rows[0].name === "Bina", JSON.stringify(r.rows));
check("recent 6 months drops the March week (and weeks with no data)", r.scope.weeks === 2 && !r.scope.matched.includes("Week 1"), JSON.stringify(r.scope));

// 2) chapter alias spellings all mean the home chapter
for (const alias of ["BNI Influencer", "Influencers", "BNI Influencers", "our chapter"]) {
  const x = m.executeChapterQuery({ scope: { kind: "all" }, chapter: alias, status: "active", topN: 100 }, index);
  check(`chapter alias "${alias}" = home (2 active members)`, x.rowCount === 2, String(x.rowCount));
}

// 3) another chapter by partial name (leading BNI ignored)
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "BNI Energizers" }, index);
check("other chapter filter finds Dev", r.rowCount === 1 && r.rows[0].name === "Dev", JSON.stringify(r.rows));

// 4) recent N weeks counts back from the newest week WITH data
r = m.executeChapterQuery({ scope: { kind: "recent", weeks: 2 }, metrics: ["visitorsInvited"] }, index);
check("recent 2 weeks = Week 4 + Week 3", r.scope.weeks === 2, JSON.stringify(r.scope));

// 4b) inactive members are left out unless explicitly asked for
r = m.executeChapterQuery({ scope: { kind: "all" }, metrics: ["visitorsInvited"], topN: 100 }, index);
check("default: home chapter + ACTIVE members only — inactive Chet and other-chapter Dev are not counted", !r.rows.some((x) => x.name === "Chet") && !r.rows.some((x) => x.name === "Dev") && r.memberStatus === "active", JSON.stringify(r.rows));
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "all", status: "any", metrics: ["visitorsInvited"], topN: 100 }, index);
check("chapter all + status any lifts both defaults (Chet and Dev appear)", r.rows.some((x) => x.name === "Chet") && r.rows.some((x) => x.name === "Dev"), JSON.stringify(r.rows.map((x) => x.name)));
r = m.executeChapterQuery({ scope: { kind: "all" }, status: "active", metrics: ["visitorsInvited"], topN: 100 }, index);
check("status active excludes Chet", !r.rows.some((x) => x.name === "Chet") && r.memberStatus === "active", JSON.stringify(r.rows));
r = m.executeChapterQuery({ scope: { kind: "all" }, status: "any", metrics: ["visitorsInvited"], topN: 100 }, index);
check("status any includes Chet", r.rows.some((x) => x.name === "Chet"));
r = m.executeChapterQuery({ scope: { kind: "all" }, status: "inactive", metrics: ["visitorsInvited"], topN: 100 }, index);
check("status inactive = only Chet", r.rowCount === 1 && r.rows[0].name === "Chet", JSON.stringify(r.rows));
r = m.executeChapterQuery({ scope: { kind: "all" }, includeZero: true, metrics: ["visitorsInvited"], topN: 100 }, index);
check("includeZero with the defaults lists the home chapter's ACTIVE roster only", !r.rows.some((x) => x.name === "Chet") && r.rows.some((x) => x.name === "Bina") && r.rows.some((x) => x.name === "Amit"), JSON.stringify(r.rows.map((x) => x.name)));
r = m.executeChapterQuery({ scope: { kind: "all" }, includeZero: true, chapter: "all", status: "any", metrics: ["visitorsInvited"], topN: 100 }, index);
check("includeZero with chapter all + status any lists everyone (inactive too)", r.rows.some((x) => x.name === "Chet") && r.rows.some((x) => x.name === "Bina"), JSON.stringify(r.rows.map((x) => x.name)));
r = m.executeChapterQuery({ scope: { kind: "all" }, members: ["chet"], metrics: ["visitorsInvited"] }, index);
check("a named member is never filtered by the defaults", r.rows.length === 1 && r.rows[0].name === "Chet" && /Member: chet/.test(r.basis.filtersSummary), JSON.stringify(r.basis));

// basis: every result says which chapter / members / period it covers
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "home", status: "active", metrics: ["visitorsInvited"] }, index);
check("basis names the home chapter, active members and the period", r.basis?.chapter === "BNI Influencers (home chapter)" && r.basis?.members === "active members only" && /meeting/.test(r.basis?.period), JSON.stringify(r.basis));
r = m.executeChapterQuery({ scope: { kind: "all" }, metrics: ["visitorsInvited"] }, index);
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "all", status: "any", metrics: ["visitorsInvited"] }, index);
check("chapter all -> basis says all chapters", /^all chapters in the data/.test(r.basis?.chapter ?? ""), JSON.stringify(r.basis));
r = m.executeChapterQuery({ scope: { kind: "all" }, status: "any", metrics: ["visitorsInvited"] }, index);
check("status any -> basis says active and inactive", r.basis?.members === "all members (active and inactive)", JSON.stringify(r.basis));
check("slip_entries carries a basis too (default = active members of the home chapter)", m.executeSlipEntries({ type: "visitor" }, index).basis?.members === "active members only" && /named member/.test(m.executeSlipEntries({ type: "visitor", member: "amit" }, index).basis?.members));

// every result lists the filters it applied ("none" when it applied none)
r = m.executeChapterQuery({ scope: { kind: "all" }, metrics: ["visitorsInvited"] }, index);
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "all", status: "any", metrics: ["visitorsInvited"] }, index);
check("chapter all + status any -> filtersApplied empty + summary says none", r.basis.filtersApplied.length === 0 && /^none/.test(r.basis.filtersSummary), JSON.stringify(r.basis));
r = m.executeChapterQuery({ scope: { kind: "all" }, metrics: ["visitorsInvited"] }, index);
check("no arguments -> the defaults are listed (home chapter, active only)", r.basis.filtersSummary === "Home chapter (BNI Influencers) · active members only", JSON.stringify(r.basis));
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "home", status: "active", metrics: ["visitorsInvited"] }, index);
check("home + active -> both listed", JSON.stringify(r.basis.filtersApplied) === JSON.stringify(["Chapter: BNI Influencers (home chapter)", "Members: active only"]), JSON.stringify(r.basis.filtersApplied));
r = m.executeChapterQuery({ scope: { kind: "all" }, status: "inactive", metrics: ["visitorsInvited"] }, index);
check("inactive -> home chapter + inactive only", JSON.stringify(r.basis.filtersApplied) === JSON.stringify(["Chapter: BNI Influencers (home chapter)", "Members: inactive only"]), JSON.stringify(r.basis.filtersApplied));

// 5) attendance metrics + ascending order
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "home", metrics: ["attendanceAbsent"], orderBy: "+attendanceAbsent", topN: 10 }, index);
check("attendance metric present and ascending sort", r.rows[0].attendanceAbsent === 0 && r.rows.at(-1).attendanceAbsent === 1, JSON.stringify(r.rows));

// slip_entries: with no member named, only ACTIVE members' slips unless asked
let ee = m.executeSlipEntries({ type: "visitor" }, { ...index, entries: [...index.entries, { t: "visitor", w: "w1", a: "Chet", b: "Old Guest" }] });
check("slip_entries default: an inactive inviter's visitors are hidden", !ee.entries.some((x) => x.visitor === "Old Guest"), JSON.stringify(ee.entries.map((x) => x.visitor)));
ee = m.executeSlipEntries({ type: "visitor", status: "any", chapter: "all" }, { ...index, entries: [...index.entries, { t: "visitor", w: "w1", a: "Chet", b: "Old Guest" }] });
check("slip_entries status any + chapter all lists them", ee.entries.some((x) => x.visitor === "Old Guest"));
ee = m.executeSlipEntries({ type: "visitor", status: "active" }, { ...index, entries: [...index.entries, { t: "visitor", w: "w1", a: "Chet", b: "Old Guest" }] });
check("slip_entries status active hides them", !ee.entries.some((x) => x.visitor === "Old Guest"));
ee = m.executeSlipEntries({ type: "visitor", member: "chet" }, { ...index, entries: [...index.entries, { t: "visitor", w: "w1", a: "Chet", b: "Old Guest" }] });
check("slip_entries naming the member explicitly still answers", ee.entries.some((x) => x.visitor === "Old Guest"));

// 6) slip_entries: guests of a member with dates, newest first
let e = m.executeSlipEntries({ type: "visitor", member: "amit", role: "first" }, index);
check("visitor entries carry dates, newest first", e.count === 2 && e.entries[0].date === "2026-10-07" && e.entries[0].visitor === "Guest One", JSON.stringify(e.entries));
e = m.executeSlipEntries({ type: "tyfcb" }, index);
check("tyfcb entry carries amount", e.entries[0].amount === 5000 && e.entries[0].memberThanked === "Amit");
e = m.executeSlipEntries({ member: "bina" }, index);
check("either-side member filter spans types", e.count === 2, String(e.count));

// 7) tool declarations expose the new arguments
check("tool declares chapter/status/where/recent", ["chapter", "status", "where", "includeZero"].every((k) => k in m.CHAPTER_QUERY_TOOL.parameters.properties) && m.CHAPTER_QUERY_TOOL.parameters.properties.scope.properties.kind.enum.includes("recent"));
check("slip_entries tool declared", m.SLIP_ENTRIES_TOOL.name === "slip_entries");

// the snapshot's monthly totals are the whole-chapter basis for total questions (checked on source)
const snapSrc = readFileSync(new URL("../lib/chat/snapshot.ts", import.meta.url), "utf8");
check("snapshot carries monthly whole-chapter totals", snapSrc.includes("monthly: MonthStat[]") && snapSrc.includes("byMonth"));
const gemSrc = readFileSync(new URL("../lib/chat/gemini.ts", import.meta.url), "utf8");
check("prompt: totals come from monthly[] / weekly[]", gemSrc.includes("TOTALS vs MEMBER LISTS"));
check("prompt: default filters + always shown + informative", gemSrc.includes("DEFAULT FILTERS") && gemSrc.includes("Filters applied:") && gemSrc.includes("INFORMATIVE ANSWERS") && gemSrc.includes("Whole chapter for reference") && !gemSrc.includes("APPLY ONLY WHEN RELEVANT"));

// groupBy keeps names intact (a regex slip once turned every lowercase 's' into a space)
ee = m.executeSlipEntries({ type: "visitor", status: "any", chapter: "all", groupBy: "first" }, { ...index, entries: [{ t: "visitor", w: "w4", a: "Sunil  Bindra", b: "G1" }, { t: "visitor", w: "w4", a: "Sunil Bindra", b: "G2" }] });
check("slip_entries groupBy: names intact and whitespace-normalised", ee.groups?.length === 1 && ee.groups[0].name === "Sunil Bindra" && ee.groups[0].count === 2, JSON.stringify(ee.groups));

// the BNI window: 'last 6 months' = ends on the newest meeting, starts the day after the same date 6 months earlier
{
  const dates = ["2026-04-01", "2026-04-08", "2026-04-15", "2026-04-22", "2026-04-29", "2026-05-06", "2026-05-13", "2026-05-20", "2026-05-27", "2026-06-03", "2026-06-10", "2026-06-17", "2026-06-24", "2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07"];
  const wk = dates.map((d, i) => ({ id: "x" + i, label: "Week " + i, date: d })).reverse();
  const big = { weeks: wk, rows: wk.map((w) => row(w.id, "k1", "Amit", { vis: 1 })), roster: [], entries: [], homeChapter: "BNI Influencers" };
  const six = m.executeChapterQuery({ scope: { kind: "recent", months: 6 }, chapter: "all", status: "any", metrics: ["visitorsInvited"] }, big);
  check("recent months 6 = 27 meetings, 8 Apr .. 7 Oct (the BNI window)", six.scope.weeks === 27 && six.scope.from === "2026-04-08" && six.scope.to === "2026-10-07", JSON.stringify(six.scope).slice(0, 160));
  const w26 = m.executeChapterQuery({ scope: { kind: "recent", value: "6 months" }, chapter: "all", status: "any", metrics: ["visitorsInvited"] }, big);
  check("a 'value' of '6 months' is the same window", w26.scope.weeks === 27);
  const four = m.executeChapterQuery({ scope: { kind: "recent", weeks: 4 }, chapter: "all", status: "any", metrics: ["visitorsInvited"] }, big);
  check("an explicit 'last 4 weeks' stays 4 meetings", four.scope.weeks === 4);
}

// filter guard: a filter the question gives no cue for is dropped
const gsrc = readFileSync(new URL("../lib/chat/filter-guard.ts", import.meta.url), "utf8");
const g = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(gsrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText).toString("base64"));
const HC = "BNI Influencers";
const gd = (args, q) => g.guardFilters(args, q, HC);
check("guard: plain ranking -> forced to home chapter + active (model tried to widen)", (() => { const r = gd({ chapter: "all", status: "any" }, "Who gave the most referrals in the last 4 weeks?"); return r.chapter === "home" && r.status === "active"; })());
check("guard: 'across all chapters' lifts the chapter default", gd({ chapter: "home" }, "Top givers across all chapters in October").chapter === "all");
check("guard: 'inactive members' -> inactive", gd({ status: "active" }, "Which inactive members brought visitors?").status === "inactive");
check("guard: 'including inactive' / 'active and inactive' / 'all members' -> any", ["How many members including inactive ones?", "Active and inactive members who gave referrals", "List all members who brought visitors"].every((q) => gd({ status: "active" }, q).status === "any"));
check("guard: the model cannot widen status without a cue", gd({ status: "any" }, "Top 3 givers in October").status === "active");
check("guard: a named member is never filtered", (() => { const r = gd({ members: ["Neha Goel"], chapter: "home", status: "active" }, "How many visitors did Neha Goel bring?"); return r.chapter === undefined && r.status === undefined; })());
check("guard: another chapter named in the question is kept", gd({ chapter: "Alchemist" }, "Top givers in Alchemist").chapter === "Alchemist");
check("guard: another chapter NOT named in the question is dropped to home", gd({ chapter: "Alchemist" }, "Top givers in October").chapter === "home");
check("guard: follow-up inherits the cue from the history text", gd({ status: "active" }, "How many did they bring? inactive members only").status === "inactive");

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
