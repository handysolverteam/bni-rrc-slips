// E2E: data-driven chat accuracy. Questions are GENERATED from the live database (every month,
// the latest weeks, the busiest members) and each answer is checked against numbers computed
// straight from Supabase — so it keeps working as data grows.
// Run:  node tests/e2e-chat-generated.mjs [filter-substring]   (prod server on :3000)
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
const [mem, ref, vis, tyf, att, bat] = await Promise.all([
  all("members", "name,is_inactive,chapters(name)"),
  all("slip_referrals", "bni_week_id,from_name,to_name"),
  all("slip_visitors", "bni_week_id,full_name,invited_by_name"),
  all("slip_tyfcb", "bni_week_id,member_name,amount"),
  all("member_attendance", "bni_week_id,member_name,absent"),
  all("import_batches", "bni_week_id"),
]);
const ids = [...new Set([...bat.map((b) => b.bni_week_id), ...att.map((a) => a.bni_week_id)].filter(Boolean))];
const { data: weeks } = await sb.from("bni_weeks").select("id,label,meeting_date").in("id", ids);
const wk = [...weeks].sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : -1));
const setOf = (pred) => new Set(wk.filter(pred).map((w) => w.id));
const last = (n) => new Set(wk.slice(0, n).map((w) => w.id));
const chOf = (m) => (Array.isArray(m.chapters) ? m.chapters[0] : m.chapters)?.name;
const nameCount = new Map();
mem.forEach((m) => nameCount.set(K(m.name), (nameCount.get(K(m.name)) || 0) + 1));
const home = mem.filter((m) => chOf(m) === "BNI Influencers");
const activeHome = home.filter((m) => !m.is_inactive && nameCount.get(K(m.name)) === 1);

const cnt = (rows, set, f, who) => rows.filter((r) => set.has(r.bni_week_id) && (!who || K(r[f]) === who)).length;
const sumAmt = (set, who) => tyf.filter((t) => set.has(t.bni_week_id) && (!who || K(t.member_name) === who)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
const forms = (n) => {
  const r = Math.round(n);
  return [String(r), r.toLocaleString("en-US"), r.toLocaleString("en-IN")];
};
const crore = (n) => [(n / 1e7).toFixed(2), (n / 1e7).toFixed(1)].map((s) => s.replace(/\.?0+$/, "") + " crore");
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// each test: [question, groups] — every group is a list of alternative substrings; ALL groups must match (any alternative).
const T_ = [];
const months = [...new Set(wk.map((w) => w.meeting_date.slice(0, 7)))].sort();
for (const ym of months) {
  const s = setOf((w) => w.meeting_date.startsWith(ym));
  const label = monthName(ym);
  T_.push([`How many referrals were given in ${label}?`, [forms(cnt(ref, s))], `month referrals ${ym}`]);
  T_.push([`How many visitors were invited in ${label}?`, [forms(cnt(vis, s))], `month visitors ${ym}`]);
  T_.push([`How many TYFCB entries were there in ${label}?`, [forms(cnt(tyf, s))], `month tyfcb entries ${ym}`]);
  T_.push([`What was the total TYFCB amount in ${label}?`, [[...forms(sumAmt(s)), ...crore(sumAmt(s))]], `month tyfcb amount ${ym}`]);
}
for (const w of wk.slice(0, 4)) {
  const s = new Set([w.id]);
  const d = new Date(`${w.meeting_date}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  T_.push([`How many visitors came in the meeting on ${d}?`, [forms(cnt(vis, s))], `week visitors ${d}`]);
  T_.push([`How many referrals were given in the week of ${d}?`, [forms(cnt(ref, s))], `week referrals ${d}`]);
}
const w12 = last(12), w27 = last(27), ALL = last(999);
const byRef = activeHome.map((m) => [m.name, cnt(ref, w12, "from_name", K(m.name))]).sort((a, b) => b[1] - a[1]);
const picks = [...byRef.slice(0, 5), ...byRef.slice(Math.floor(byRef.length / 2), Math.floor(byRef.length / 2) + 3), ...byRef.slice(-2)];
for (const [name] of picks) {
  T_.push([`How many referrals did ${name} give in the last 12 weeks?`, [forms(cnt(ref, w12, "from_name", K(name)))], `member ref12 ${name}`]);
  T_.push([`How many visitors did ${name} invite in the last 6 months?`, [forms(cnt(vis, w27, "invited_by_name", K(name)))], `member vis6m ${name}`]);
  T_.push([`How many referrals has ${name} received in total?`, [forms(cnt(ref, ALL, "to_name", K(name)))], `member received ${name}`]);
}
const topTy = activeHome.map((m) => [m.name, sumAmt(ALL, K(m.name))]).sort((a, b) => b[1] - a[1]).slice(0, 3);
for (const [name, amt] of topTy) T_.push([`What is the total TYFCB amount ${name} has been thanked for?`, [[...forms(amt), ...crore(amt)]], `member tyfcb ${name}`]);
// rankings
for (const ym of months.slice(-3)) {
  const s = setOf((w) => w.meeting_date.startsWith(ym));
  const m = new Map();
  vis.filter((v) => s.has(v.bni_week_id)).forEach((v) => m.set(K(v.invited_by_name), (m.get(K(v.invited_by_name)) || 0) + 1));
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  const nm = mem.find((x) => K(x.name) === top[0])?.name ?? top[0];
  T_.push([`Who invited the most visitors in ${monthName(ym)}?`, [[nm]], `top visitor inviter ${ym}`]);
}

async function ask(q) {
  for (let a = 0; a < 7; a++) {
    const res = await fetch(`${APP}/api/chat/generate`, { method: "POST", headers: AUTH, body: JSON.stringify({ message: q, authorName: "generated-test" }) });
    if (res.status === 200) return (await res.json()).text ?? "";
    await new Promise((r) => setTimeout(r, 3000 + a * 3000));
  }
  return "";
}

const only = process.argv[2];
let pass = 0, fail = 0;
for (const [q, groups, note] of T_) {
  if (only && !note.includes(only)) continue;
  const t = await ask(q);
  const low = t.toLowerCase().replace(/₹/g, "");
  const miss = groups.filter((g) => !g.some((alt) => low.includes(String(alt).toLowerCase())));
  const ok = t !== "" && miss.length === 0 && /filters applied:/i.test(t);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL  ${q}\n  ${note} | expected one of: ${miss.map((g) => g.slice(0, 4).join(" / ")).join(" ; ")}\n  ${t.replace(/\n+/g, " ").slice(0, 380)}\n`);
  else console.log(`PASS  ${q}`);
}
console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
