// E2E: Slips AI Chat — the AI must see ALL weeks/members (no data caps) and
// answer meeting-date questions from the per-week snapshot.
//
// Run:  node tests/e2e-chat-weekly.mjs   (from the repo root)
// Ground truth is read live from Supabase, so the test stays valid as data grows.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

async function all(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}
const key = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
const num = (v) => {
  const n = Number(String(v ?? 0).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ---- ground truth ---------------------------------------------------------
const [{ count: weekCount }, { count: memberCount }, weeks] = await Promise.all([
  sb.from("bni_weeks").select("id", { count: "exact" }).limit(1),
  sb.from("members").select("id", { count: "exact" }).limit(1),
  all("bni_weeks", "id,label,meeting_date"),
]);
weeks.sort((a, b) => String(b.meeting_date).localeCompare(String(a.meeting_date)));
const [ref, oto, tyf, vis] = await Promise.all([
  all("slip_referrals", "bni_week_id,from_name,to_name,inside_outside"),
  all("slip_one_to_ones", "bni_week_id,initiated_by_is_other_chapter,met_with_is_other_chapter"),
  all("slip_tyfcb", "bni_week_id,member_name,amount"),
  all("slip_visitors", "bni_week_id"),
]);
// Use the latest week that actually has slips — a future/empty week would
// make every expected number trivially 0.
const weeksWithSlips = new Set(
  [...ref, ...oto, ...tyf, ...vis].map((r) => r.bni_week_id).filter(Boolean),
);
const w = weeks.find((x) => weeksWithSlips.has(x.id));
if (!w) throw new Error("no week with slips found");
const wr = ref.filter((r) => r.bni_week_id === w.id);
const truth = {
  weeks: weekCount,
  members: memberCount,
  referrals: wr.length,
  oneToOnes: oto
    .filter((r) => r.bni_week_id === w.id)
    .reduce((n, r) => n + (r.initiated_by_is_other_chapter === true || r.met_with_is_other_chapter === true ? 1 : 2), 0),
  visitors: vis.filter((r) => r.bni_week_id === w.id).length,
  tyfcbEntries: tyf.filter((r) => r.bni_week_id === w.id).length,
  tyfcbAmount: Math.round(tyf.filter((r) => r.bni_week_id === w.id).reduce((n, r) => n + num(r.amount), 0)),
  uniqueGivers: new Set(wr.map((r) => key(r.from_name)).filter(Boolean)).size,
  uniqueTyfcbReceivers: new Set(tyf.filter((r) => r.bni_week_id === w.id).map((r) => key(r.member_name)).filter(Boolean)).size,
};
console.log(`ground truth: ${w.label} ->`, JSON.stringify(truth));

// ---- ask the chat ---------------------------------------------------------
// Free-tier Gemini throttles burst runs (429/503 across models) — retry with
// backoff so a rate-limit blip does not cascade into false failures.
async function ask(message) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${APP}/api/chat/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && typeof data.text === "string" && data.text.trim();
    if (ok) return { ok, text: data.text, error: data.error };
    if (attempt < 3) await new Promise((r) => setTimeout(r, 30_000));
    else return { ok, text: data.text ?? "", error: data.error };
  }
}
const numbersIn = (text) =>
  (String(text).match(/\d[\d,]*/g) ?? []).map((s) => Number(s.replace(/,/g, "")));
const hasAll = (text, expected) => {
  const got = new Set(numbersIn(text));
  return expected.every((n) => got.has(n));
};
const day = new Date(`${w.meeting_date}T00:00:00Z`);
const dateWords = day.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// 1) The screenshot scenario: numbers for one specific meeting date.
let a = await ask(
  `For the ${dateWords} meeting, reply with ONLY these five numbers separated by single spaces: referrals, oneToOnes, visitors, TYFCB entries, TYFCB amount.`,
);
check("chat generate responds", a.ok, a.error || `${a.text.slice(0, 80)}...`);
check(
  `per-week numbers for ${dateWords}`,
  a.ok && hasAll(a.text, [truth.referrals, truth.oneToOnes, truth.visitors, truth.tyfcbEntries, truth.tyfcbAmount]),
  `need ${truth.referrals}/${truth.oneToOnes}/${truth.visitors}/${truth.tyfcbEntries}/${truth.tyfcbAmount} got [${numbersIn(a.text).join(", ")}]`,
);

// 2) Data coverage: all weeks and members visible (was capped at 60 / 500).
a = await ask("Reply with ONLY two numbers separated by one space: how many BNI meeting weeks and how many members exist in the data?");
check(
  "no data caps (weeks, members)",
  a.ok && hasAll(a.text, [truth.weeks, truth.members]),
  `need ${truth.weeks}/${truth.members} got [${numbersIn(a.text).join(", ")}]`,
);

// 2b) "Latest week" must land on the newest week WITH data — newer weeks can
// be an upcoming meeting with no slips yet (the empty-week trap).
a = await ask(
  "Give the numbers for the latest week. Reply with ONLY these five numbers separated by single spaces: referrals, oneToOnes, visitors, TYFCB entries, TYFCB amount.",
);
check(
  "'latest week' answers the newest week with data",
  a.ok && hasAll(a.text, [truth.referrals, truth.oneToOnes, truth.visitors, truth.tyfcbEntries, truth.tyfcbAmount]),
  `need ${truth.referrals}/${truth.oneToOnes}/${truth.visitors}/${truth.tyfcbEntries}/${truth.tyfcbAmount} got [${numbersIn(a.text).join(", ")}]`,
);

// 3) Per-week unique member counts (the other screenshot questions).
a = await ask(
  `For the ${dateWords} meeting, reply with ONLY two numbers separated by one space: unique members who gave referrals, and unique members who received TYFCB.`,
);
check(
  "per-week unique member counts",
  a.ok && hasAll(a.text, [truth.uniqueGivers, truth.uniqueTyfcbReceivers]),
  `need ${truth.uniqueGivers}/${truth.uniqueTyfcbReceivers} got [${numbersIn(a.text).join(", ")}]`,
);

// 4) Unknown date must not crash or hallucinate a week.
a = await ask("What were the slip numbers for the meeting on 1 January 1900? If no such meeting exists, say so.");
check("unknown date handled gracefully", a.ok, a.error || a.text.slice(0, 120).replace(/\s+/g, " "));

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
