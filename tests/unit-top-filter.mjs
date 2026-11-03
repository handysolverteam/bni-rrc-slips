// Pure checks for the Top 3 member filters (lib/top-filter.ts): default = active members of the Home Chapter, multi-select
// status / chapter, "all" lifts a restriction, name matching.
// Run: node tests/unit-top-filter.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const opts = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } };
const src = readFileSync(new URL("../lib/top-filter.ts", import.meta.url), "utf8");
const f = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(src, opts).outputText).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

const HOME = "home-id";
const OTHER = "pratham-id";
const members = [
  { name: "Suryaditya Bose", inactive: false, chapterId: HOME },
  { name: "Rajiv Gupta", inactive: true, chapterId: HOME },
  { name: "Kunnal  Gupta", inactive: false, chapterId: HOME },
  { name: "Visiting Vik", inactive: false, chapterId: OTHER },
  { name: "Old Otto", inactive: true, chapterId: OTHER },
  { name: "Twin Name", inactive: true, chapterId: HOME },
  { name: "Twin Name", inactive: false, chapterId: OTHER },
];
const pass_ = (filter, name) => f.makeNameMatcher(members, filter)(name);

// ---- defaults
const def = f.parseTopFilter({}, HOME);
check("default = active members of the Home Chapter", JSON.stringify(def) === JSON.stringify({ statuses: ["active"], chapters: [HOME] }));
check("default lets active home members through and drops the inactive one (Rajiv Gupta)", pass_(def, "Suryaditya Bose") && !pass_(def, "Rajiv Gupta"));
check("default drops other-chapter members and names that are no member at all", !pass_(def, "Visiting Vik") && !pass_(def, "Stranger Danger") && !pass_(def, null) && !pass_(def, ""));
check("names match case-insensitively with collapsed spaces", pass_(def, "  suryaditya   BOSE ") && pass_(def, "Kunnal Gupta"));
check("the default is recognised as the default", f.isDefaultTopFilter(def, HOME) && !f.isDefaultTopFilter(f.parseTopFilter({ status: "all" }, HOME), HOME));
check("a Home Chapter without members: no chapter restriction", JSON.stringify(f.parseTopFilter({}, null)) === JSON.stringify({ statuses: ["active"], chapters: null }) && f.isDefaultTopFilter(f.parseTopFilter({}, null), null));

// ---- status
const inactive = f.parseTopFilter({ status: "inactive" }, HOME);
check("status=inactive: only inactive members (of the home chapter)", pass_(inactive, "Rajiv Gupta") && !pass_(inactive, "Suryaditya Bose") && !pass_(inactive, "Old Otto"));
check("status=active,inactive (both ticked) = everybody on that axis", f.parseTopFilter({ status: "active,inactive" }, HOME).statuses === null && f.parseTopFilter({ status: "all" }, HOME).statuses === null);
check("an unreadable status falls back to the default", JSON.stringify(f.parseTopFilter({ status: "banana" }, HOME).statuses) === JSON.stringify(["active"]));

// ---- chapter (multi-select, by id)
const other = f.parseTopFilter({ chapter: OTHER }, HOME, [HOME, OTHER]);
check("chapter=<id>: that chapter instead of the home chapter", JSON.stringify(other.chapters) === JSON.stringify([OTHER]) && pass_(other, "Visiting Vik") && !pass_(other, "Suryaditya Bose"));
const both = f.parseTopFilter({ chapter: `${HOME},${OTHER}` }, HOME, [HOME, OTHER]);
check("several chapters at once (multi-select)", pass_(both, "Suryaditya Bose") && pass_(both, "Visiting Vik") && !pass_(both, "Rajiv Gupta"));
check("an unknown chapter id is ignored (default stays)", JSON.stringify(f.parseTopFilter({ chapter: "nope" }, HOME, [HOME, OTHER]).chapters) === JSON.stringify([HOME]));
check("chapter=all lifts the chapter restriction", f.parseTopFilter({ chapter: "all" }, HOME).chapters === null);

// ---- combinations
const everyone = f.parseTopFilter({ status: "all", chapter: "all" }, HOME);
check("all + all: every name passes, also names that match no member", pass_(everyone, "Rajiv Gupta") && pass_(everyone, "Old Otto") && pass_(everyone, "Stranger Danger"));
const allChapterActive = f.parseTopFilter({ chapter: "all" }, HOME);
check("active + all chapters: active members of any chapter, non-members dropped", pass_(allChapterActive, "Visiting Vik") && pass_(allChapterActive, "Suryaditya Bose") && !pass_(allChapterActive, "Rajiv Gupta") && !pass_(allChapterActive, "Stranger Danger"));
const inactiveAll = f.parseTopFilter({ status: "inactive", chapter: "all" }, HOME);
check("inactive + all chapters", pass_(inactiveAll, "Rajiv Gupta") && pass_(inactiveAll, "Old Otto") && !pass_(inactiveAll, "Visiting Vik"));
check("a name that exists in two chapters passes when ANY of its rows matches (Twin Name: inactive@home, active@other)", pass_(f.parseTopFilter({ status: "active", chapter: OTHER }, HOME), "Twin Name") && !pass_(def, "Twin Name") && pass_(f.parseTopFilter({ status: "inactive" }, HOME), "Twin Name"));

// ---- description line
const nameOf = (id) => ({ [HOME]: "BNI Influencers", [OTHER]: "Pratham" })[id];
check("description: default / everyone / mixed", f.describeTopFilter(def, nameOf) === "Active members · BNI Influencers" && f.describeTopFilter(everyone, nameOf) === "All members · all chapters" && f.describeTopFilter(f.parseTopFilter({ status: "inactive", chapter: `${HOME},${OTHER}` }, HOME), nameOf) === "Inactive members · BNI Influencers + Pratham");

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
