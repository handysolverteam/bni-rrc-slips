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
// Multi-tenant: the app scopes every query by tenant. Tests authenticate as
// server-to-server callers (service-role bearer) against the default tenant.
const TENANT = "d1000000-0000-4000-8000-000000000001";
const AUTH = { Authorization: `Bearer ${kv("SUPABASE_SERVICE_ROLE_KEY")}` };

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

async function all(table, columns, { tenantScoped = true } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns);
    if (tenantScoped) q = q.eq("tenant_id", TENANT);
    const { data, error } = await q.range(from, from + 999);
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
// Weeks in the chat snapshot = the weeks THIS tenant has imported (the chat
// answers "how many meeting weeks exist" from that list).
const [{ count: memberCount }, weeks, batchWeeks] = await Promise.all([
  sb.from("members").select("id", { count: "exact" }).eq("tenant_id", TENANT).limit(1),
  all("bni_weeks", "id,label,meeting_date", { tenantScoped: false }),
  all("import_batches", "bni_week_id"),
]);
const importedWeekIds = new Set(batchWeeks.map((b) => b.bni_week_id).filter(Boolean));
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
  weeks: importedWeekIds.size,
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
async function ask(message, sessionId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${APP}/api/chat/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ message, sessionId }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && typeof data.text === "string" && data.text.trim();
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    if (ok) return { ok, text: data.text, suggestions, error: data.error };
    if (attempt < 3) await new Promise((r) => setTimeout(r, 30_000));
    else return { ok, text: data.text ?? "", suggestions, error: data.error };
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

// 5) The chips under the composer follow the conversation: every answer ends
//    with a SUGGESTIONS: block that the server strips out of the reply and
//    returns separately (this session is deleted at the end of the run).
const ses = await sb
  .from("chat_sessions")
  .insert({ tenant_id: TENANT, title: "suggestion chips test" })
  .select("id")
  .single();
if (ses.error) throw new Error(`chat_sessions insert: ${ses.error.message}`);
const suggestSessionId = ses.data.id;

a = await ask("Who invited the most visitors overall, and how many did they bring?", suggestSessionId);
const sugg = a.suggestions;
check(
  "follow-up suggestions returned with the answer",
  a.ok && sugg.length >= 3 && sugg.length <= 5 && sugg.every((q) => typeof q === "string" && q.endsWith("?") && q.length <= 120),
  `got ${JSON.stringify(sugg)}`,
);
check(
  "suggestions block never shows in the answer text",
  a.ok && !/SUGGESTIONS:/i.test(a.text) && !/\[suggestions:/.test(a.text),
  a.text.slice(-140).replace(/\s+/g, " "),
);
check(
  "suggestions are about the latest thread (visitors)",
  sugg.some((q) => /visit|guest|invit/i.test(q)),
  `got ${JSON.stringify(sugg)}`,
);
// The chips must survive a reload, so they ride along as a hidden marker on
// the persisted AI row (split back off by the chat UI's splitAttached).
const persisted = await sb
  .from("chat_messages")
  .select("sender,text")
  .eq("session_id", suggestSessionId)
  .order("created_at", { ascending: false });
const aiRow = (persisted.data ?? []).find((r) => r.sender === "ai");
check(
  "suggestions persisted as a hidden [suggestions: …] marker",
  !!aiRow && /\n\[suggestions: [^\]]+\]$/.test(aiRow.text ?? ""),
  (aiRow?.text ?? "(no ai row)").slice(-140).replace(/\s+/g, " "),
);
await sb.from("chat_sessions").delete().eq("id", suggestSessionId);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
