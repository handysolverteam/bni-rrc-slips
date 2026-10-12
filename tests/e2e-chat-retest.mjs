// E2E: re-test of every chat question that earlier failed, was answered wrongly or was never verified.
// Run:  node tests/e2e-chat-retest.mjs   (prod server on :3000)
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
const [mem, ref, vis, oto, att, bat] = await Promise.all([
  all("members", "name,is_inactive,chapters(name)"),
  all("slip_referrals", "bni_week_id,from_name,to_name"),
  all("slip_visitors", "bni_week_id,full_name,invited_by_name"),
  all("slip_one_to_ones", "bni_week_id,initiated_by_name,met_with_name"),
  all("member_attendance", "bni_week_id,member_name,absent,m,s"),
  all("import_batches", "bni_week_id"),
]);
const ids = [...new Set([...bat.map((b) => b.bni_week_id), ...att.map((a) => a.bni_week_id)].filter(Boolean))];
const { data: weeks } = await sb.from("bni_weeks").select("id,label,meeting_date").in("id", ids);
const wk = [...weeks].sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : -1));
const last = (n) => new Set(wk.slice(0, n).map((w) => w.id));
const chOf = (m) => (Array.isArray(m.chapters) ? m.chapters[0] : m.chapters)?.name;
const home = mem.filter((m) => chOf(m) === "BNI Influencers");
const homeK = new Set(home.map((m) => K(m.name)));
const w4 = last(4), w27 = last(27);
const nm = (k) => mem.find((x) => K(x.name) === k)?.name ?? k;
const tally = (rows, f, set) => {
  const m = new Map();
  rows.filter((r) => !set || set.has(r.bni_week_id)).forEach((r) => m.set(K(r[f]), (m.get(K(r[f])) || 0) + 1));
  return m;
};
// #11: received most referrals (all-time) while giving fewer than 3
const got = tally(ref, "to_name"), gave = tally(ref, "from_name");
const q11 = [...got].filter(([k]) => (gave.get(k) || 0) < 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
// #14: both medical and substitute entries in the last 6 months (home chapter members)
const ms = new Map();
att.filter((a) => w27.has(a.bni_week_id)).forEach((a) => {
  const c = ms.get(K(a.member_name)) ?? { m: 0, s: 0 };
  c.m += Number(a.m || 0);
  c.s += Number(a.s || 0);
  ms.set(K(a.member_name), c);
});
const q14 = [...ms].filter(([k, c]) => c.m > 0 && c.s > 0 && homeK.has(k)).map(([k]) => nm(k));
const top4 = [...tally(ref, "from_name", w4)].sort((a, b) => b[1] - a[1])[0];
const vaini = [...tally(oto, "initiated_by_name", w27)].find(([k]) => k === "vaini mehra")?.[1] ?? 0;

// [question, [substrings that must appear], optional regex, optional forbidden substrings, note]
const TESTS = [
  ["Who gave the most referrals in the last 4 weeks?", [nm(top4[0]), String(top4[1])], /filters applied:\s*none/i, [], "no active/home filter"],
  ["How many members are in our chapter?", ["97"], /filters applied:[^\n]*(home|influencers)/i, [], "home chapter line"],
  ["How many one-to-ones did Vaini Mehra initiate in the last 6 months?", [String(vaini)], null, [], "was an empty reply"],
  ["Top 3 referral givers in October 2026", ["Rajesh Kumar Agarwal"], /filters applied:\s*none/i, [], "no home filter"],
  ["How many visitors did Rajan Sharma bring?", [], /no member|not found|could not find|couldn't find|no record|does not (contain|appear)|no data/i, ["has invited 2 visitors"], "no look-alike substitution"],
  ["Who are the 5 members who received the most referrals but gave fewer than 3?", q11.map(([k]) => nm(k)), null, [], "#11 verified vs DB"],
  ["Who has both medical and substitute entries in the last 6 months?", [String(q14.length), ...q14.slice(0, 4)], null, [], `#14 verified vs DB (${q14.length} home members)`],
  ["How many members are there including inactive ones?", ["97"], null, ["832"], "#3"],
  ["Who gave the most referrals in the last 4 weeks, and in the last 12 weeks?", ["Ranjan K Sapra", "Vaini Mehra"], null, [], "#6 two windows"],
  ["List all TYFCB entries above ₹10 lakh in the last 6 months with who was thanked.", ["72"], null, ["sample"], "#16"],
  ["How many members from other chapters have we imported?", ["735"], null, [], "#17"],
  ["Who in BNI Influencers initiated the most 121s in the last 6 months?", ["Kompal Bhardwaj", "47"], null, [], "#18 initiated"],
  ["Why did Amit Bahl miss last week?", ["not miss"], null, [], "#20"],
  ["Active members with both at least 10 referrals given and at least 2 visitors in the last 6 months?", ["25"], null, [], "combined conditions"],
  ["What chapter Ashwani Kumar belongs to?", ["Alchemist", "Influencers"], null, [], "member in two chapters"],
  ["Members with no visitors", ["21"], null, [], "#24 all-time"],
  ["Which members brought 0 visitors?", ["21"], /filters applied:/i, [], "#23"],
  ["How many active members are there in BNI Influencers?", ["77"], null, [], "member count after name-clash fix"],
];

async function ask(q) {
  for (let a = 0; a < 7; a++) {
    const res = await fetch(`${APP}/api/chat/generate`, { method: "POST", headers: AUTH, body: JSON.stringify({ message: q, authorName: "retest" }) });
    if (res.status === 200) return (await res.json()).text ?? "";
    await new Promise((r) => setTimeout(r, 3000 + a * 3000));
  }
  return "";
}

let pass = 0, fail = 0;
for (const [q, must, re, not, note] of TESTS) {
  const t = await ask(q);
  const low = t.toLowerCase();
  const miss = must.filter((m) => !low.includes(String(m).toLowerCase()));
  const forbidden = not.filter((s) => low.includes(s.toLowerCase()));
  const reOk = !re || re.test(t);
  const ok = t !== "" && miss.length === 0 && forbidden.length === 0 && reOk;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${q}\n  (${note})${miss.length ? " MISSING: " + miss.join(", ") : ""}${forbidden.length ? " FORBIDDEN: " + forbidden.join(", ") : ""}${reOk ? "" : " PATTERN NOT MATCHED"}\n  ${t.replace(/\n+/g, " ").slice(0, 700)}\n`);
}
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
