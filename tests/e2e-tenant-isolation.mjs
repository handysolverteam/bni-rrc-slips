// E2E: multi-tenant isolation — a second tenant's rows must never appear in
// another tenant's API responses, pages, exports or chat history.
//
// Run:  node tests/e2e-tenant-isolation.mjs   (from the repo root)
// Requires supabase/migrations/004_tenants.sql to be applied.
// Server-to-server auth: service-role bearer + x-tenant-id header.
// Self-cleaning: removes every row it creates, then re-checks the baseline.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const KEY = kv("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), KEY);

const DEFAULT_T = "d1000000-0000-4000-8000-000000000001";
const ISO_T = "e2000000-0000-4000-8000-000000000002"; // fixed id: re-runs are idempotent
const ISO_NAME = "E2E Isolation Chapter";
const MARKER = "E2E Iso Giver";
const MEMBER = "E2E Iso Person";
const BATCH_FILE = "e2e-iso.csv";
const CHAT_TITLE = "E2E Iso Chat";

const AUTH = { Authorization: `Bearer ${KEY}` };
const asT = (t) => ({ ...AUTH, "x-tenant-id": t });

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const getJson = (path, headers) => fetch(`${APP}${path}`, { headers }).then((r) => r.json());
const getHtml = (path, headers) => fetch(`${APP}${path}`, { headers }).then((r) => r.text());

async function count(table, tenantId) {
  const { count: c } = await sb
    .from(table)
    .select("id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .limit(1);
  return c ?? 0;
}

// ---- 0) auth guards -------------------------------------------------------
{
  const r = await fetch(`${APP}/api/members`);
  check("API without auth -> 401", r.status === 401, `status=${r.status}`);
  // The shell flushes before the page guard runs, so the redirect may arrive
  // as a NEXT_REDIRECT digest in the flight payload instead of a 3xx status.
  const p = await fetch(`${APP}/members`, { redirect: "manual" });
  const loc = p.headers.get("location") ?? "";
  const text = p.status < 300 || p.status >= 400 ? await p.text() : "";
  const wentToLogin =
    (p.status >= 300 && p.status < 400 && loc.includes("/login")) ||
    text.includes("NEXT_REDIRECT;replace;/login");
  check("page without auth goes to /login", wentToLogin, `status=${p.status} location=${loc}`);
  const r403 = await fetch(`${APP}/api/members`, { headers: { ...AUTH, "x-tenant-id": "00000000-0000-4000-8000-000000000099" } });
  check("unknown tenant -> 401 (no such tenant)", r403.status === 401, `status=${r403.status}`);
}

// ---- 1) setup: a second tenant with its own rows --------------------------
async function preClean() {
  await sb.from("chat_messages").delete().in(
    "session_id",
    (await sb.from("chat_sessions").select("id").eq("tenant_id", ISO_T).then((r) => (r.data ?? []).map((x) => x.id))),
  );
  await sb.from("chat_sessions").delete().eq("tenant_id", ISO_T);
  for (const t of ["slip_referrals", "slip_one_to_ones", "slip_tyfcb", "slip_visitors", "slip_ceus", "members", "chapters", "import_batches"]) {
    await sb.from(t).delete().eq("tenant_id", ISO_T);
  }
  await sb.from("tenants").delete().eq("id", ISO_T);
}

await preClean();

const baseDefault = {
  members: await count("members", DEFAULT_T),
  referrals: await count("slip_referrals", DEFAULT_T),
  batches: await count("import_batches", DEFAULT_T),
};

const { data: isoTenant, error: isoErr } = await sb
  .from("tenants")
  .insert({ id: ISO_T, name: ISO_NAME, home_chapter_name: "E2E Iso Home" })
  .select()
  .single();
if (isoErr) {
  console.log(`FAIL  create second tenant  :: ${isoErr.message}`);
  process.exit(1);
}
const { data: isoWeek } = await sb
  .from("bni_weeks")
  .select("id,label")
  .eq("meeting_date", "2026-09-30")
  .maybeSingle();
const weekId = isoWeek?.id ?? null;
check("shared week 40 exists (global calendar)", !!weekId, String(weekId));

let isoSessionId = null;
if (weekId) {
  const { data: isoChapter } = await sb
    .from("chapters")
    .insert({ name: "E2E Iso Chapter", tenant_id: ISO_T })
    .select("id")
    .single();
  await sb.from("members").insert({ name: MEMBER, tenant_id: ISO_T, chapter_id: isoChapter.id });
  const { data: isoBatch } = await sb
    .from("import_batches")
    .insert({ filename: BATCH_FILE, bni_week_id: weekId, tenant_id: ISO_T })
    .select("id")
    .single();
  await sb.from("slip_referrals").insert({
    tenant_id: ISO_T,
    bni_week_id: weekId,
    import_batch_id: isoBatch.id,
    from_name: MARKER,
    to_name: "E2E Iso Receiver",
    inside_outside: "Inside",
  });
  const { data: isoSession } = await sb
    .from("chat_sessions")
    .insert({ title: CHAT_TITLE, tenant_id: ISO_T })
    .select("id")
    .single();
  isoSessionId = isoSession.id;
  await sb.from("chat_messages").insert({ session_id: isoSessionId, sender: "user", text: "iso hello" });
}

// ---- 2) API responses are scoped ------------------------------------------
if (weekId) {
  const dMembers = await getJson("/api/members", asT(DEFAULT_T));
  check(
    "members API (default): total + no second-tenant rows",
    dMembers.total === baseDefault.members && (dMembers.rows ?? []).every((r) => r.name !== MEMBER),
    `total=${dMembers.total} base=${baseDefault.members}`,
  );
  const iMembers = await getJson("/api/members", asT(ISO_T));
  check(
    "members API (second tenant): only its own member",
    iMembers.total === 1 && iMembers.rows?.[0]?.name === MEMBER,
    `total=${iMembers.total} rows=${JSON.stringify((iMembers.rows ?? []).map((r) => r.name))}`,
  );

  const dRefs = await getJson("/api/referrals", asT(DEFAULT_T));
  check(
    "referrals API (default): no second-tenant slip",
    (dRefs.rows ?? []).every((r) => r.from_name !== MARKER) && dRefs.total === baseDefault.referrals,
    `total=${dRefs.total} base=${baseDefault.referrals}`,
  );
  const iRefs = await getJson("/api/referrals", asT(ISO_T));
  check(
    "referrals API (second tenant): only its own slip",
    iRefs.total === 1 && iRefs.rows?.[0]?.from_name === MARKER,
    `total=${iRefs.total}`,
  );

  const dBatches = await getJson("/api/import/batches", asT(DEFAULT_T));
  check(
    "import batches API (default): no second-tenant batch",
    (dBatches.batches ?? []).every((b) => b.filename !== BATCH_FILE) && dBatches.batches?.length === baseDefault.batches,
    `len=${dBatches.batches?.length} base=${baseDefault.batches}`,
  );
  const iBatches = await getJson("/api/import/batches", asT(ISO_T));
  check(
    "import batches API (second tenant): only its own batch",
    iBatches.batches?.length === 1 && iBatches.batches[0].filename === BATCH_FILE,
    `len=${iBatches.batches?.length}`,
  );

  const iWeeks = await getJson("/api/weeks", asT(ISO_T));
  check(
    "weeks API (second tenant): only weeks it imported",
    Array.isArray(iWeeks.weeks) && iWeeks.weeks.length === 1 && iWeeks.weeks[0].id === weekId,
    `len=${iWeeks.weeks?.length}`,
  );

  // Report export: the second tenant's row must not leak into the default export.
  const dExp = await getJson(`/api/report/export?week=${weekId}&tab=all&format=json`, asT(DEFAULT_T));
  const dRefRows = (dExp.sections ?? []).find((s) => s.title === "Referral")?.rows ?? [];
  const iExp = await getJson(`/api/report/export?week=${weekId}&tab=all&format=json`, asT(ISO_T));
  const iRefRows = (iExp.sections ?? []).find((s) => s.title === "Referral")?.rows ?? [];
  check(
    "export JSON (default): no second-tenant row",
    dRefRows.every((r) => r[1] !== MARKER),
    `rows=${dRefRows.length}`,
  );
  check(
    "export JSON (second tenant): exactly its own row",
    iRefRows.length === 1 && iRefRows[0][1] === MARKER,
    JSON.stringify(iRefRows),
  );
}

// ---- 3) chat sessions + messages are scoped --------------------------------
{
  const dSess = await getJson("/api/chat/sessions", asT(DEFAULT_T));
  check(
    "chat sessions (default): no second-tenant session",
    (dSess.sessions ?? []).every((s) => s.title !== CHAT_TITLE),
    `len=${dSess.sessions?.length}`,
  );
  if (isoSessionId) {
    const iSess = await getJson("/api/chat/sessions", asT(ISO_T));
    check(
      "chat sessions (second tenant): its own session",
      (iSess.sessions ?? []).some((s) => s.id === isoSessionId && s.title === CHAT_TITLE),
      `len=${iSess.sessions?.length}`,
    );
    const denied = await fetch(`${APP}/api/chat/sessions/${isoSessionId}/messages`, { headers: asT(DEFAULT_T) });
    check("cross-tenant message read -> 404", denied.status === 404, `status=${denied.status}`);
    const deniedDel = await fetch(`${APP}/api/chat/sessions/${isoSessionId}/messages`, { headers: asT(DEFAULT_T), method: "DELETE" });
    check("cross-tenant message clear -> 404", deniedDel.status === 404, `status=${deniedDel.status}`);
    const ownDel = await fetch(`${APP}/api/chat/sessions/${isoSessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "stolen" }),
      headers: { ...asT(DEFAULT_T), "Content-Type": "application/json" },
    });
    check("cross-tenant rename rejected", !ownDel.ok, `status=${ownDel.status}`);
    const iMsgs = await getJson(`/api/chat/sessions/${isoSessionId}/messages`, asT(ISO_T));
    check("own-tenant message read works", iMsgs.messages?.length === 1, `len=${iMsgs.messages?.length}`);
    const stillThere = await sb.from("chat_messages").select("id").eq("session_id", isoSessionId);
    check("denied clear did not delete anything", (stillThere.data ?? []).length === 1, `len=${stillThere.data?.length}`);
  }
}

// ---- 4) pages are scoped (rows live in the RSC flight payload) ------------
if (weekId) {
  const isoHtml = await getHtml("/members", asT(ISO_T));
  const dfltHtml = await getHtml("/members", asT(DEFAULT_T));
  const q = String.fromCharCode(34), bs = String.fromCharCode(92);
  const rowIn = (html, name) => html.includes(bs + q + "name" + bs + q + ":" + bs + q + name + bs + q);
  check("members page (second tenant): shows its member", rowIn(isoHtml, MEMBER), "flight payload");
  check("members page (default): hides second-tenant member", !rowIn(dfltHtml, MEMBER), "flight payload");
  check(
    "members page (default): shows its own data",
    dfltHtml.includes(bs + q + "name" + bs + q),
    "flight payload has rows",
  );
}

// ---- 5) cleanup + baseline restored ---------------------------------------
await preClean();
const afterDefault = {
  members: await count("members", DEFAULT_T),
  referrals: await count("slip_referrals", DEFAULT_T),
  batches: await count("import_batches", DEFAULT_T),
};
const tenantGone = await sb.from("tenants").select("id").eq("id", ISO_T).maybeSingle();
check(
  "cleanup restores default-tenant baselines",
  afterDefault.members === baseDefault.members &&
    afterDefault.referrals === baseDefault.referrals &&
    afterDefault.batches === baseDefault.batches &&
    !tenantGone.data,
  JSON.stringify({ afterDefault, baseDefault, tenantGone: tenantGone.data ?? null }),
);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
