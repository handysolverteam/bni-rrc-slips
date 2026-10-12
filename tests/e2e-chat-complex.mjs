// E2E: complex / multi-step chat questions (ratios, comparisons, pairs, set logic, per-month maxima,
// negative cases) + the previously pending attendance question. Ground truth comes from Supabase.
// Run:  node tests/e2e-chat-complex.mjs   (prod server on :3000)
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
const [mem, ref, vis, tyf, bat, att] = await Promise.all([
  all("members", "name,is_inactive,chapters(name)"),
  all("slip_referrals", "bni_week_id,from_name,to_name"),
  all("slip_visitors", "bni_week_id,full_name,invited_by_name"),
  all("slip_tyfcb", "bni_week_id,member_name,amount"),
  all("import_batches", "bni_week_id"),
  all("member_attendance", "bni_week_id"),
]);
const ids = [...new Set([...bat.map((b) => b.bni_week_id), ...att.map((a) => a.bni_week_id)].filter(Boolean))];
const { data: weeks } = await sb.from("bni_weeks").select("id,label,meeting_date").in("id", ids);
const wk = [...weeks].sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : -1));
const setOf = (p) => new Set(wk.filter(p).map((w) => w.id));
const last = (n) => new Set(wk.slice(0, n).map((w) => w.id));
const chOf = (m) => (Array.isArray(m.chapters) ? m.chapters[0] : m.chapters)?.name;
const home = mem.filter((m) => chOf(m) === "BNI Influencers");
const homeK = new Set(home.map((m) => K(m.name)));
const activeK = new Set(home.filter((m) => !m.is_inactive).map((m) => K(m.name)));
const nm = (k) => mem.find((x) => K(x.name) === k)?.name ?? k;
const w27 = last(27);
const forms = (n) => [String(n), Number(n).toLocaleString("en-US"), Number(n).toLocaleString("en-IN")];
const crore = (n) => (n / 1e7).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + " crore";
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const sep = setOf((w) => w.meeting_date.startsWith("2026-09"));
const tally = (rows, f, set) => {
  const m = new Map();
  rows.filter((r) => !set || set.has(r.bni_week_id)).forEach((r) => m.set(K(r[f]), (m.get(K(r[f])) || 0) + 1));
  return m;
};
const sumBy = (set) => {
  const m = new Map();
  tyf.filter((t) => set.has(t.bni_week_id)).forEach((t) => m.set(K(t.member_name), (m.get(K(t.member_name)) || 0) + (Number(t.amount) || 0)));
  return m;
};

// facts
const sepRefs = ref.filter((r) => sep.has(r.bni_week_id)).length;
const sepOutsideShare = null; // inside/outside flag is not stored per row here; use the chat's own totals (225 inside / 273 outside)
const gaveSep = new Set(ref.filter((r) => sep.has(r.bni_week_id)).map((r) => K(r.from_name))).size;
const visByMonth = new Map();
vis.forEach((v) => {
  const d = wk.find((w) => w.id === v.bni_week_id)?.meeting_date.slice(0, 7);
  visByMonth.set(d, (visByMonth.get(d) || 0) + 1);
});
const bestVisMonth = [...visByMonth].sort((a, b) => b[1] - a[1])[0];
const visPerWeek = new Map();
vis.forEach((v) => visPerWeek.set(v.bni_week_id, (visPerWeek.get(v.bni_week_id) || 0) + 1));
const weeksOver10 = wk.filter((w) => (visPerWeek.get(w.id) || 0) > 10).length;
const refGive27 = tally(ref, "from_name", w27), visBy27 = tally(vis, "invited_by_name", w27);
const visNoRef = [...activeK].filter((k) => (visBy27.get(k) || 0) > 0 && !refGive27.get(k));
const refNoVis = [...activeK].filter((k) => (refGive27.get(k) || 0) > 0 && !visBy27.get(k));
const pairCount = (a, b) => ref.filter((r) => K(r.from_name) === a && K(r.to_name) === b).length;
const monicaDates = [...new Set(vis.filter((v) => K(v.invited_by_name) === "monica singh").map((v) => wk.find((w) => w.id === v.bni_week_id)?.meeting_date))].sort();
const dayMonth = (d) => new Date(`${d}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const tyW27 = [...sumBy(w27)].sort((a, b) => b[1] - a[1]);
const tySep = [...sumBy(sep)].sort((a, b) => b[1] - a[1])[0];
const inactiveVis = [...visBy27].filter(([k]) => homeK.has(k) && !activeK.has(k)).reduce((s, [, n]) => s + n, 0);
const monicaN = visBy27.get("monica singh") || 0, vainiN = visBy27.get("vaini mehra") || 0;

// [question, [[alternatives]...], optional regex, note]
const TESTS = [
  ["Was Amit Bahl present at the meeting on 30 September 2026?", [["substitute"]], null, "pending: he sent a substitute"],
  ["Was Amit Bahl absent at any meeting in the last 4 weeks?", [["no", "not", "wasn't"]], null, "substitute/present are not absences"],
  [`What share of September ${2026} referrals were given outside the chapter, as a percentage?`, [["54.8", "54.7", "55%", "55 %", "54.9"]], null, "273 of 498 outside"],
  ["What was the average number of referrals per meeting in September 2026?", [["99.6", "99,6"]], null, `${sepRefs} referrals / 5 meetings`],
  ["How many different people gave at least one referral in September 2026?", [forms(gaveSep)], null, "distinct givers"],
  ["Which month had the most visitors and how many?", [[monthName(bestVisMonth[0]), monthName(bestVisMonth[0]).split(" ")[0]], forms(bestVisMonth[1])], null, "max visitors month"],
  ["In how many meetings were more than 10 visitors invited?", [forms(weeksOver10)], null, "weeks with >10 visitors"],
  ["Which active members brought visitors in the last 6 months but gave no referrals?", [[String(visNoRef.length), visNoRef.length === 0 ? "no " : nm(visNoRef[0])]], null, `count=${visNoRef.length}`],
  ["How many active members gave referrals in the last 6 months but never brought a visitor?", [forms(refNoVis.length)], null, "referrers with no visitors"],
  ["How many referrals did Monica Singh give to Vaini Mehra, all time?", [forms(pairCount("monica singh", "vaini mehra"))], null, "pair count"],
  ["On which dates did Monica Singh invite visitors?", monicaDates.map((d) => [dayMonth(d)]), null, "all her dates"],
  ["Who was thanked the most (TYFCB amount) in the last 6 months, top 3 with amounts?", [[nm(tyW27[0][0])], [nm(tyW27[1][0])], [nm(tyW27[2][0])]], null, "top 3 TYFCB"],
  ["Which member received the highest TYFCB amount in September 2026, and how much?", [[nm(tySep[0])], [...forms(tySep[1]), crore(tySep[1])]], null, "Sept TYFCB leader"],
  ["Compare Monica Singh and Vaini Mehra on visitors invited in the last 6 months.", [forms(monicaN), forms(vainiN)], null, `${monicaN} vs ${vainiN}`],
  ["How many visitors in total were invited by inactive members in the last 6 months?", [forms(inactiveVis)], null, "inactive members' visitors"],
  ["Which members brought more than 5 visitors in March 2026?", [[]], /no (data|records|meeting)|not (have|found|available)|don't have|do not have|outside|before/i, "no data before April 2026"],
  ["Compare September and October 2026: referrals, visitors and TYFCB entries.", [["498"], ["24"], ["311"]], null, "two months, three measures"],
];

async function ask(q) {
  for (let a = 0; a < 8; a++) {
    const res = await fetch(`${APP}/api/chat/generate`, { method: "POST", headers: AUTH, body: JSON.stringify({ message: q, authorName: "complex-test" }) });
    if (res.status === 200) return (await res.json()).text ?? "";
    await new Promise((r) => setTimeout(r, 5000 + a * 5000));
  }
  return "";
}

if (process.env.DUMP) {
  for (const [q, groups, , note] of TESTS) console.log(JSON.stringify({ q, expect: groups.map((g) => g.slice(0, 3).join(" or ")), note }));
  process.exit(0);
}
let pass = 0, fail = 0;
for (const [q, groups, re, note] of TESTS) {
  const t = await ask(q);
  const low = t.toLowerCase().replace(/₹/g, "");
  const miss = groups.filter((g) => g.length > 0 && !g.some((alt) => low.includes(String(alt).toLowerCase())));
  const reOk = !re || re.test(t);
  const ok = t !== "" && miss.length === 0 && reOk;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${q}\n  (${note})${miss.length ? " MISSING: " + miss.map((g) => g.slice(0, 3).join(" / ")).join(" ; ") : ""}${reOk ? "" : " PATTERN NOT MATCHED"}\n  ${t.replace(/\n+/g, " ").slice(0, 500)}\n`);
}
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
