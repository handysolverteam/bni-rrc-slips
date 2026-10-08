// Pure checks for lib/monthly-top-share.ts (ranking + WhatsApp text), run via source regex-free eval.
import { readFileSync } from "node:fs";
import ts from "typescript";
const src = readFileSync(new URL("../lib/monthly-top-share.ts", import.meta.url), "utf8")
  .replace('import { whatsappShareUrl } from "@/lib/whatsapp";', 'const whatsappShareUrl = (t) => "https://wa.me/?text=" + encodeURIComponent(t);');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); };

const top = m.rankTop([
  { name: "Amit", value: 5 }, { name: " amit ", value: 7 }, { name: "Bina", value: 12 },
  { name: "Chet", value: 3 }, { name: "Dev", value: 11 }, { name: "", value: 99 }, { name: null, value: 99 }, { name: "Zero", value: 0 },
]);
check("merges names case-insensitively and sums", top[0].name === "Amit" && top[0].value === 12 || top[0].name === "Bina");
check("top 3 only, blanks and zeros dropped", top.length === 3 && !top.some((t) => t.name === "Zero" || t.name === ""), JSON.stringify(top));
check("ties break by name", m.rankTop([{ name: "B", value: 1 }, { name: "A", value: 1 }])[0].name === "A");
const month = { key: "2026-04", label: "April 2026", tyfcb: [{ name: "Amit", value: 1234567 }], referral: [{ name: "Bina", value: 9 }], visitor: [] };
const text = m.buildMonthShare(month);
check("share text has title, medal and rupee amount", text.includes("Top 3 · April 2026") && text.includes("🥇 Amit — ₹12,34,567"), text);
check("empty list prints a dash", text.includes("Visitors brought\n—"));
check("share url is wa.me with encoded text", m.monthShareUrl(month).startsWith("https://wa.me/?text=") && m.allShareUrl([month, month]).includes(encodeURIComponent("━")));
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
