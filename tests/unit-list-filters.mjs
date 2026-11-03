// Pure checks for lib/list-filters.ts: the chapter column's "Home Chapter" option (blank cells), combined with other picks.
// Run: node tests/unit-list-filters.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/list-filters.ts", import.meta.url), "utf8");
const f = await import("data:text/javascript;base64," + Buffer.from(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};
// A query that records what it was asked.
const fake = () => {
  const calls = [];
  const q = {
    calls,
    ilike: (c, p) => (calls.push(["ilike", c, p]), q),
    in: (c, v) => (calls.push(["in", c, v]), q),
    or: (s) => (calls.push(["or", s]), q),
  };
  return q;
};
const run = (value) => f.applyColumnFilter(fake(), "other_chapter_member", value).calls;

check("the option is labelled with the home chapter's name", JSON.stringify(f.homeChapterOption("BNI Influencers")) === JSON.stringify({ value: "__home__", label: "Home Chapter (BNI Influencers)" }) && f.homeChapterOption("  ").label === "Home Chapter");
check("a single ordinary value keeps the fuzzy ilike", JSON.stringify(run("Pratham")) === JSON.stringify([["ilike", "other_chapter_member", "%Pratham%"]]));
check("several ordinary values keep the exact IN", JSON.stringify(run("A,B")) === JSON.stringify([["in", "other_chapter_member", ["A", "B"]]]));
check("Home Chapter alone = blank cells (NULL or empty string)", JSON.stringify(run("__home__")) === JSON.stringify([["or", "other_chapter_member.is.null,other_chapter_member.eq."]]));
check("Home Chapter + one chapter: blank OR that chapter (quoted)", JSON.stringify(run("__home__,Pratham")) === JSON.stringify([["or", 'other_chapter_member.is.null,other_chapter_member.eq.,other_chapter_member.in.("Pratham")']]));
const comma = f.encodeCommas("Pratham, Gurgaon, India"); // how a chapter name with commas travels in the URL
check("a chapter name with commas stays ONE value inside the quoted IN list", JSON.stringify(run(`__home__,${comma},Stars`)) === JSON.stringify([["or", 'other_chapter_member.is.null,other_chapter_member.eq.,other_chapter_member.in.("Pratham, Gurgaon, India","Stars")']]));
check("quotes and backslashes in a value are escaped", run('__home__,Say "hi"\\x')[0][1].endsWith('.in.("Say \\"hi\\"\\\\x")'), run('__home__,Say "hi"\\x')[0][1]);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
