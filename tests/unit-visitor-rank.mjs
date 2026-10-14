// Pure checks for lib/visitor-ranking-share.ts: merging months, least-to-most order, "brought none", WhatsApp text.
// Run: node tests/unit-visitor-rank.mjs
import { readFileSync } from "node:fs";
import ts from "typescript";

// The module imports lib/whatsapp via an alias; stub it so the pure functions load stand-alone.
const src = readFileSync(new URL("../lib/visitor-ranking-share.ts", import.meta.url), "utf8").replace(
  'import { whatsappShareUrl } from "@/lib/whatsapp";',
  "const whatsappShareUrl = (t) => `https://wa.me/?text=${encodeURIComponent(t)}`;",
);
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0;
let fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`);
};

const counts = {
  "2026-09": { "Sunil Bindra": 2, "amit gupta": 1, "Zed  Ali": 4 },
  "2026-10": { "Sunil  Bindra": 1, "Amit Gupta": 2, "Neha Goel": 1 },
  "2026-03": { "Old Member": 9 },
};
const r = m.mergeRanking(counts, ["2026-09", "2026-10"]);
check("months are summed per member, names merge case/space-insensitively", r.find((x) => x.name === "Sunil Bindra")?.count === 3 && r.find((x) => x.name === "amit gupta")?.count === 3, JSON.stringify(r));
check("least to most, ties by name", JSON.stringify(r.map((x) => x.name)) === JSON.stringify(["Neha Goel", "amit gupta", "Sunil Bindra", "Zed Ali"]), JSON.stringify(r.map((x) => [x.name, x.count])));
check("only the picked months count", !r.some((x) => x.name === "Old Member"));
check("empty selection -> empty ranking", m.mergeRanking(counts, []).length === 0);
check("zero / blank / NaN counts are ignored", m.mergeRanking({ a: { "": 3, X: 0, Y: Number.NaN, Z: 1 } }, ["a"]).length === 1);

const none = m.namesWithNone(["Amit Gupta", "Pia Roy", "Neha Goel", "Bob Lal"], r);
check("brought-none list = pool minus those with visitors (case-insensitive), sorted", JSON.stringify(none) === JSON.stringify(["Bob Lal", "Pia Roy"]), JSON.stringify(none));

const text = m.buildRankingShare("Last 6 months", r, none);
check("share: heading, groups by count ascending, total, none line", /^★ \*Visitors brought · Last 6 months\*/.test(text) && text.indexOf("*1 visitor*") < text.indexOf("*3 visitors*") && text.indexOf("*3 visitors*") < text.indexOf("*4 visitors*") && /Total: 11 visitors from 4 members/.test(text) && /\*Brought none\* \(2\)/.test(text), text);
check("share: plural / singular wording", text.includes("*1 visitor* (1)") && text.includes("*3 visitors* (2)"));
// WhatsApp for Windows shows emoji as "?" — only basic-multilingual-plane symbols may be used.
check("share text uses no emoji (only BMP characters)", [...text].every((c) => c.codePointAt(0) <= 0xffff));
check("share: empty ranking says so", m.buildRankingShare("May 2026", [], []).includes("No visitors recorded."));
check("share url is a wa.me link with encoded text", m.rankingShareUrl("a b\nc").startsWith("https://wa.me/?text=a%20b%0Ac"));

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
