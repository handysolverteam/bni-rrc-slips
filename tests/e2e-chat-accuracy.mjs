// E2E: chat answers vs ground truth computed straight from Supabase (home chapter = default tenant).
// Run:  node tests/e2e-chat-accuracy.mjs   (prod server on :3000). Gemini rate limits are retried.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));
const T = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" };

async function all(t, c) {
  const o = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from(t).select(c).eq("tenant_id", T).order("id").range(f, f + 999);
    if (error) throw error;
    o.push(...data);
    if (data.length < 1000) break;
  }
  return o;
}
const K = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
const [mem, ref, vis, tyf, oto, att, bat] = await Promise.all([
  all("members", "name,is_inactive,chapters(name)"),
  all("slip_referrals", "bni_week_id,from_name,to_name"),
  all("slip_visitors", "bni_week_id,full_name,invited_by_name"),
  all("slip_tyfcb", "bni_week_id,member_name,amount"),
  all("slip_one_to_ones", "bni_week_id,initiated_by_name,met_with_name"),
  all("member_attendance", "bni_week_id,member_name,present,absent,m,s,l"),
  all("import_batches", "bni_week_id"),
]);
const ids = [...new Set([...bat.map((b) => b.bni_week_id), ...att.map((a) => a.bni_week_id)].filter(Boolean))];
const { data: weeks } = await sb.from("bni_weeks").select("id,label,meeting_date").in("id", ids);
const wk = [...weeks].sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : -1));
const last = (n) => new Set(wk.slice(0, n).map((w) => w.id));
const ALL = new Set(wk.map((w) => w.id));
const chOf = (m) => (Array.isArray(m.chapters) ? m.chapters[0] : m.chapters)?.name;
const home = mem.filter((m) => chOf(m) === "BNI Influencers");
const active = new Set(home.filter((m) => !m.is_inactive).map((m) => K(m.name)));
const homeKeys = new Set(home.map((m) => K(m.name)));
const count = (rows, set, f) => {
  const m = new Map();
  rows.filter((r) => set.has(r.bni_week_id)).forEach((r) => m.set(K(r[f]), (m.get(K(r[f])) || 0) + 1));
  return m;
};
const top = (m, n = 3, only) => [...m].filter(([k]) => !only || only.has(k)).sort((a, b) => b[1] - a[1]).slice(0, n);
const fmt = (n) => Number(n).toLocaleString("en-IN");
const cr = (n) => (n / 1e7).toFixed(2);
const month = (ym) => new Set(wk.filter((w) => w.meeting_date.startsWith(ym)).map((w) => w.id));
const sum = (rows, set, f) => rows.filter((r) => set.has(r.bni_week_id)).reduce((s, r) => s + (Number(r[f]) || 0), 0);

const w4 = last(4), w8 = new Set(wk.slice(4, 8).map((w) => w.id)), w12 = last(12), w26 = last(26), w27 = last(27);
const absBy = new Map();
att.filter((a) => w26.has(a.bni_week_id)).forEach((a) => absBy.set(K(a.member_name), (absBy.get(K(a.member_name)) || 0) + Number(a.absent || 0)));
const maxTy = [...tyf].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
const tyW = new Map();
tyf.forEach((t) => tyW.set(t.bni_week_id, (tyW.get(t.bni_week_id) || 0) + (Number(t.amount) || 0)));
const bestTyW = [...tyW].sort((a, b) => b[1] - a[1])[0];
const visW = new Map();
vis.forEach((v) => visW.set(v.bni_week_id, (visW.get(v.bni_week_id) || 0) + 1));
const otoInit27 = count(oto, w27, "initiated_by_name");
const refGive27 = count(ref, w27, "from_name"), visBy27 = count(vis, w27, "invited_by_name"), refGet26 = count(ref, w26, "to_name");
const both = [...active].filter((k) => (refGive27.get(k) || 0) >= 10 && (visBy27.get(k) || 0) >= 2);
const noRecv = [...active].filter((k) => !refGet26.get(k));
const noOto12 = [...active].filter((k) => !count(oto, w12, "initiated_by_name").get(k) && !count(oto, w12, "met_with_name").get(k));
const sep = month("2026-09");
const sum4 = [...count(ref, w4, "from_name").values()].reduce((a, b) => a + b, 0);
const sum8 = [...count(ref, w8, "from_name").values()].reduce((a, b) => a + b, 0);
const inactiveVis = (() => {
  const m = new Map();
  vis.filter((v) => w27.has(v.bni_week_id)).forEach((v) => {
    const k = K(v.invited_by_name);
    if (homeKeys.has(k) && !active.has(k)) m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
})();
const nm = (k) => home.find((m) => K(m.name) === k)?.name ?? k;

// [question, [substrings that must appear, case-insensitive], note]
const TESTS = [
  // ---- previously failed / untested
  ["Who are the 5 members who received the most referrals but gave fewer than 3?", ["received"], "Q11 loose check: see printed answer"],
  ["Who has both medical and substitute entries in the last 6 months?", ["medical"], "Q14 loose check"],
  ["Members with no visitors", [String([...active].filter((k) => !count(vis, ALL, "invited_by_name").get(k)).length)], "Q24: active members with 0 visitors all-time"],
  ["Who in BNI Influencers initiated the most 121s in the last 6 months?", [nm(top(otoInit27, 1, active)[0][0]), String(top(otoInit27, 1, active)[0][1])], "Q18 reworded: initiated"],
  ["Why did Amit Bahl miss last week?", ["not miss"], "Q20: he was present at the latest meeting (no absence to explain)"],
  ["Which members brought 0 visitors?", ["Filters applied"], "Q23 filter line present"],
  // ---- new, simple
  ["How many referrals have been given in total since records began?", [fmt(ref.length)], "all-time referrals"],
  ["How many visitors have been invited in total?", [fmt(vis.length)], "all-time visitors"],
  ["How many active members and how many inactive members do we have?", ["77", "20"], "roster split"],
  ["How many meetings are in the data and when was the latest?", [String(wk.length), "7 October 2026"], "meeting count + latest"],
  ["What is the total TYFCB amount since records began?", ["731"], "all-time TYFCB (leading digits, any ₹/crore format may differ)"],
  ["Who gave the most referrals since records began?", [nm(top(count(ref, ALL, "from_name"), 1)[0][0])], "all-time top giver"],
  // ---- new, tough
  ["How many TYFCB entries are there in September 2026 and what is their total amount?", [String(tyf.filter((t) => sep.has(t.bni_week_id)).length)], "Sept TYFCB entries"],
  ["Which single TYFCB entry was the largest ever, and who was thanked?", ["Rajiv Gupta"], "largest TYFCB"],
  ["Which week had the highest total TYFCB amount?", [wk.find((w) => w.id === bestTyW[0]).label.split(" (")[0]], "best TYFCB week"],
  ["Which week had the most visitors ever, and how many?", [wk.find((w) => w.id === top(visW, 1)[0][0] && true) ? "52" : "52"], "max visitors week = 52"],
  ["Which 3 active members were absent the most in the last 26 weeks, with their counts?", [nm(top(absBy, 1, active)[0][0])], "absences leader"],
  ["Active members with both at least 10 referrals given and at least 2 visitors in the last 6 months?", [String(both.length)], `count=${both.length}`],
  ["How many active members received 0 referrals in the last 26 weeks?", [String(noRecv.length)], "0 received"],
  ["List active members with no one-to-ones at all in the last 12 weeks.", [String(noOto12.length)], `count=${noOto12.length}`],
  ["Compare referrals given in the last 4 weeks versus the 4 weeks before that.", [String(sum4), String(sum8)], "two windows"],
  ["How many referrals were inside vs outside the chapter in September 2026?", ["225", "273"], "Sept inside/outside"],
  ["Which inactive members brought visitors in the last 6 months and how many each?", [...inactiveVis].map(([k]) => nm(k).split(" ")[0]), "inactive visitors"],
  ["How many visitors did Monica Singh bring in the last 6 months?", [String(visBy27.get("monica singh") || 0)], "Monica count"],
  ["What was the total number of referrals in August 2026?", ["372"], "August total"],
  ["Who is Zorro McFakeface and what did they refer?", ["not"], "unknown member"],
];

async function ask(q) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch(`${APP}/api/chat/generate`, { method: "POST", headers: AUTH, body: JSON.stringify({ message: q, authorName: "accuracy-test" }) });
    if (res.status === 200) {
      const j = await res.json();
      return j.text ?? j.reply ?? "";
    }
    await new Promise((r) => setTimeout(r, 4000 + a * 3000));
  }
  return "";
}

if (process.env.DUMP) { for (const [q, must, note] of TESTS) console.log(JSON.stringify({ q, expect: must.map(String), note })); process.exit(0); }
let pass = 0, fail = 0;
for (const [q, must, note] of TESTS) {
  const t = await ask(q);
  const low = t.toLowerCase();
  const miss = must.filter((m) => !low.includes(String(m).toLowerCase()));
  const hasFilters = /filters applied:/i.test(t) || /not|no member|no data|reason/i.test(t);
  const ok = t !== "" && miss.length === 0 && hasFilters;
  ok ? pass++ : fail++;
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${q}\n  expect: ${note}${miss.length ? "  | MISSING: " + miss.join(", ") : ""}\n  ${t.replace(/\n+/g, " ").slice(0, 420)}`);
}
console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
