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
check("share text: bold title, numbered rows, rupee amount", text.includes("*Top 3 · April 2026*") && text.includes("1. Amit — ₹12,34,567") && text.includes("₹ *TYFCB — amount received*"), text);
check("empty list says No data", text.includes("*Visitors brought*\nNo data"));
check("share url is wa.me with encoded text", m.monthShareUrl(month).startsWith("https://wa.me/?text=") && m.allShareUrl([month, month]).includes(encodeURIComponent("――――")));
// WhatsApp on Windows shows characters outside the basic plane (emoji) as "�" via wa.me links.
// ...and characters WhatsApp treats as emoji even inside the basic plane (➕ ❌ ✅ ⭐ …) fail the same way.
const astral = /[\u{10000}-\u{10FFFF}]|\p{Emoji_Presentation}/u;
check("month share has no emoji (basic-plane symbols only)", !astral.test(text) && !astral.test(m.buildAllShare([month, month])));

// the attendance (rolling period) share follows the same rules
const psrc = readFileSync(new URL("../lib/palms-share.ts", import.meta.url), "utf8")
  .replace('import type { PalmsBucketGroup } from "@/lib/palms-buckets";', "")
  .replace('import { whatsappShareUrl } from "@/lib/whatsapp";', 'const whatsappShareUrl = (t) => "https://wa.me/?text=" + encodeURIComponent(t);');
const pjs = ts.transpileModule(psrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const pm = await import("data:text/javascript;base64," + Buffer.from(pjs).toString("base64"));
const groups = [
  { key: "absent", buckets: [{ label: "3+ Absents", count: 2, names: ["Neha Goel", "Rajiv Gupta"] }, { label: "2 Absents", count: 0, names: [] }, { label: "1 Absent", count: 1, names: ["Viraj Bansal"] }] },
  { key: "medical", buckets: [{ label: "3+ Medicals", count: 1, names: ["Abhay Goenka"] }] },
  { key: "substitute", buckets: [{ label: "1 Substitute", count: 0, names: [] }] },
];
const pt = pm.buildPalmsStatsShare("10 Apr 2026", "8 Oct 2026", 26, groups);
check("attendance share: bold heading + date line", pt.includes("*Attendance — last 6 months (26 weeks)*") && pt.includes("10 Apr 2026 – 8 Oct 2026 · 26 meetings"), pt);
check("attendance share: one block per letter, bullets per bucket", pt.includes("✗ *Absent*\n• *3+ times* (2): Neha Goel, Rajiv Gupta\n• *1 time* (1): Viraj Bansal") && pt.includes("✚ *Medical*\n• *3+ times* (1): Abhay Goenka"), pt);
check("attendance share: empty buckets and empty groups are left out", !pt.includes("2 times") && !pt.includes("Substitute"), pt);
check("attendance share has no emoji", !astral.test(pt));
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
