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

// 5) attendance metrics + ascending order
r = m.executeChapterQuery({ scope: { kind: "all" }, chapter: "home", metrics: ["attendanceAbsent"], orderBy: "+attendanceAbsent", topN: 10 }, index);
check("attendance metric present and ascending sort", r.rows[0].attendanceAbsent === 0 && r.rows.at(-1).attendanceAbsent === 1, JSON.stringify(r.rows));

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

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
