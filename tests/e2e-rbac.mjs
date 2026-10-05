// E2E: RBAC — admin has full access, member is read-only, and every user
// only ever sees their own chats.
//
// Run:  node tests/e2e-rbac.mjs   (from the repo root)
// Requires supabase/migrations/004_tenants.sql + 005_rbac.sql to be applied.
// Server-to-server auth: service-role bearer + x-user-uid to act as a user.
// Self-cleaning: removes the fake memberships/sessions it creates.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const APP = "http://localhost:3000";
const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const KEY = kv("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), KEY);

const DEFAULT_T = "d1000000-0000-4000-8000-000000000001";
const ADMIN_UID = "e2e-rbac-admin-0001"; // fake uids: safe to insert/delete
const MEMBER_UID = "e2e-rbac-member-0002";
const NOBODY_UID = "e2e-rbac-nobody-0003";
const FAKE_UIDS = [ADMIN_UID, MEMBER_UID, NOBODY_UID];

const AUTH = { Authorization: `Bearer ${KEY}` };
const asRoot = AUTH; // plain service key: root, no owner scoping
const asAdmin = { ...AUTH, "x-user-uid": ADMIN_UID };
const asMember = { ...AUTH, "x-user-uid": MEMBER_UID };
const asNobody = { ...AUTH, "x-user-uid": NOBODY_UID };

const TITLE = "Slips Audit Report for 30/09/2026\n";
const HEAD = "From,To,Slip Type,Inside/Outside,TYFCB Amount,CEU Credits,Detail\n";
const CSV = TITLE + HEAD + "E2E RBAC Giver,E2E RBAC Receiver,Referral,Tier 1,,,\n";

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const getJson = (path, headers) => fetch(`${APP}${path}`, { headers }).then((r) => r.json());
const getHtml = (path, headers) => fetch(`${APP}${path}`, { headers }).then((r) => r.text());

function postCsv(path, headers) {
  const form = new FormData();
  form.append("file", new File([CSV], "rbac.csv", { type: "text/csv" }));
  return fetch(`${APP}${path}`, { method: "POST", body: form, headers });
}

async function batchCount() {
  const { count } = await sb
    .from("import_batches")
    .select("id", { count: "exact" })
    .eq("tenant_id", DEFAULT_T)
    .limit(1);
  return count ?? 0;
}

async function memberCount() {
  const { count } = await sb
    .from("tenant_members")
    .select("uid", { count: "exact" })
    .eq("tenant_id", DEFAULT_T)
    .limit(1);
  return count ?? 0;
}

async function sessionIdsFor(uid) {
  if (uid === null) {
    const { data, error } = await sb
      .from("chat_sessions")
      .select("id")
      .is("owner_uid", null)
      .eq("tenant_id", DEFAULT_T)
      .like("title", "E2E RBAC%");
    if (error) return [];
    return (data ?? []).map((r) => r.id);
  }
  const { data } = await sb.from("chat_sessions").select("id").eq("owner_uid", uid);
  return (data ?? []).map((r) => r.id);
}

// ---- cleanup (also used for pre-clean so re-runs are idempotent) ----------
async function preClean() {
  const ids = [
    ...(await sessionIdsFor(ADMIN_UID)),
    ...(await sessionIdsFor(MEMBER_UID)),
    ...(await sessionIdsFor(null)), // only this test's root-created sessions
  ];
  if (ids.length > 0) await sb.from("chat_messages").delete().in("session_id", ids);
  if (ids.length > 0) await sb.from("chat_sessions").delete().in("id", ids);
  await sb.from("tenant_members").delete().in("uid", FAKE_UIDS);
}

// Migration 005 sanity probe: without owner_uid every chat check would 500
// with a confusing error — fail fast with the fix instead.
{
  const { error } = await sb.from("chat_sessions").select("owner_uid").limit(1);
  if (error) {
    console.log(`FAIL  chat_sessions.owner_uid missing  :: ${error.message}`);
    console.log("      apply supabase/migrations/005_rbac.sql in the Supabase SQL editor, then re-run.");
    process.exit(1);
  }
}

await preClean();
const baseMemberships = await memberCount();
const baseBatches = await batchCount();

// ---- setup: an admin + a member in the default tenant ---------------------
{
  const { error } = await sb.from("tenant_members").insert([
    { tenant_id: DEFAULT_T, uid: ADMIN_UID, role: "admin" },
    { tenant_id: DEFAULT_T, uid: MEMBER_UID, role: "member" },
  ]);
  if (error) {
    console.log(`FAIL  provision admin+member  :: ${error.message}`);
    console.log("      (is supabase/migrations/005_rbac.sql applied?)");
    process.exit(1);
  }
}

// ---- 1) roles are resolved for every caller shape -------------------------
{
  const root = await getJson("/api/tenant", asRoot);
  check("service root -> role admin", root.role === "admin", JSON.stringify(root.role));
  const a = await getJson("/api/tenant", asAdmin);
  check("x-user-uid admin -> role admin", a.role === "admin" && a.noAccess === false, JSON.stringify({ role: a.role, noAccess: a.noAccess }));
  const m = await getJson("/api/tenant", asMember);
  check("x-user-uid member -> role member", m.role === "member" && m.noAccess === false, JSON.stringify({ role: m.role, noAccess: m.noAccess }));
  const n = await getJson("/api/tenant", asNobody);
  check("x-user-uid without membership -> noAccess", n.noAccess === true, JSON.stringify(n));
}

// ---- 2) member cannot import; admin can -----------------------------------
{
  const before = await batchCount();
  const deniedPreview = await postCsv("/api/import/preview", asMember);
  const deniedBody = await deniedPreview.json().catch(() => ({}));
  check("member import preview -> 403", deniedPreview.status === 403, `status=${deniedPreview.status} body=${JSON.stringify(deniedBody)}`);
  const deniedImport = await postCsv("/api/import/report", asMember);
  const deniedImportBody = await deniedImport.json().catch(() => ({}));
  check("member import report -> 403", deniedImport.status === 403, `status=${deniedImport.status} body=${JSON.stringify(deniedImportBody)}`);
  const afterDenied = await batchCount();
  check("member 403 wrote nothing", afterDenied === before, `before=${before} after=${afterDenied}`);

  const allowed = await postCsv("/api/import/preview", asAdmin);
  const allowedBody = await allowed.json().catch(() => ({}));
  check("admin import preview -> 200", allowed.status === 200, `status=${allowed.status} body=${JSON.stringify(allowedBody).slice(0, 160)}`);
  const afterAdmin = await batchCount();
  check("preview wrote no batch", afterAdmin === before, `before=${before} after=${afterAdmin}`);
}

// ---- 3) pages: import UI is admin-only ------------------------------------
// Note: client-component subtrees render at hydration (not in the fetch
// text), but the server-rendered home hero button and the root loading
// skeleton both mention the button — so compare occurrence counts: the
// admin's home flight carries one MORE "Import Report XLS" (the real hero).
const count = (t, s) => t.split(s).length - 1;
{
  const adminHome = await getHtml("/", asAdmin);
  const memberHome = await getHtml("/", asMember);
  const a = count(adminHome, "Import Report XLS");
  const m = count(memberHome, "Import Report XLS");
  check("home (admin) renders the Import button, (member) does not", a > m, `admin=${a} member=${m}`);

  const memberImport = await fetch(`${APP}/import`, { headers: asMember, redirect: "manual" });
  const loc = memberImport.headers.get("location") ?? "";
  const locPath = loc.replace(/^https?:\/\/[^/]+/, "");
  const text = memberImport.status < 300 || memberImport.status >= 400 ? await memberImport.text() : "";
  const wentHome =
    (memberImport.status >= 300 && memberImport.status < 400 && locPath === "/") ||
    text.includes("NEXT_REDIRECT;replace;/;");
  check("/import (member) redirects home", wentHome, `status=${memberImport.status} location=${loc}`);

  const adminImport = await fetch(`${APP}/import`, { headers: asAdmin, redirect: "manual" });
  const adminText = adminImport.status === 200 ? await adminImport.text() : "";
  check(
    "/import (admin) renders, not redirected",
    adminImport.status === 200 && !adminText.includes("NEXT_REDIRECT;replace;/;"),
    `status=${adminImport.status}`,
  );

  const reportMember = await getHtml("/report", asMember);
  check(
    "report (member) still renders read-only",
    reportMember.includes("Week Report"),
    `len=${reportMember.length}`,
  );
}

// ---- 4) chats are per user ------------------------------------------------
let adminSession = null;
let memberSession = null;
let rootSession = null;
{
  const create = (headers, title) =>
    fetch(`${APP}/api/chat/sessions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => r.json());
  adminSession = (await create(asAdmin, "E2E RBAC Admin Chat")).session;
  memberSession = (await create(asMember, "E2E RBAC Member Chat")).session;
  rootSession = (await create(asRoot, "E2E RBAC Root Chat")).session;
  check("sessions created for all three callers", !!adminSession && !!memberSession && !!rootSession, JSON.stringify({ adminSession, memberSession, rootSession }));

  const listAdmin = await getJson("/api/chat/sessions", asAdmin);
  const listMember = await getJson("/api/chat/sessions", asMember);
  const listRoot = await getJson("/api/chat/sessions", asRoot);
  const ids = (l) => (l.sessions ?? []).map((s) => s.id);
  check(
    "admin sees only own chat",
    ids(listAdmin).includes(adminSession?.id) && !ids(listAdmin).includes(memberSession?.id) && !ids(listAdmin).includes(rootSession?.id),
    JSON.stringify(ids(listAdmin)),
  );
  check(
    "member sees only own chat",
    ids(listMember).includes(memberSession?.id) && !ids(listMember).includes(adminSession?.id) && !ids(listMember).includes(rootSession?.id),
    JSON.stringify(ids(listMember)),
  );
  check(
    "service root sees every chat of the tenant",
    ids(listRoot).includes(adminSession?.id) && ids(listRoot).includes(memberSession?.id) && ids(listRoot).includes(rootSession?.id),
    `len=${ids(listRoot).length}`,
  );

  if (adminSession && memberSession) {
    await sb.from("chat_messages").insert({ session_id: adminSession.id, sender: "user", text: "rbac admin only" });
    const ownerRead = await fetch(`${APP}/api/chat/sessions/${adminSession.id}/messages`, { headers: asAdmin });
    const ownerBody = await ownerRead.json().catch(() => ({}));
    check("owner reads own messages", ownerRead.status === 200 && ownerBody.messages?.length === 1, `status=${ownerRead.status}`);
    const crossRead = await fetch(`${APP}/api/chat/sessions/${adminSession.id}/messages`, { headers: asMember });
    check("other user's messages -> 404", crossRead.status === 404, `status=${crossRead.status}`);
    const crossRename = await fetch(`${APP}/api/chat/sessions/${adminSession.id}`, {
      method: "PATCH",
      headers: { ...asMember, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "stolen" }),
    });
    check("other user's rename -> 404", crossRename.status === 404, `status=${crossRename.status}`);
    const crossDelete = await fetch(`${APP}/api/chat/sessions/${adminSession.id}`, { method: "DELETE", headers: asMember });
    check("other user's delete -> 404", crossDelete.status === 404, `status=${crossDelete.status}`);
    const stillThere = await sb.from("chat_sessions").select("id").eq("id", adminSession.id).maybeSingle();
    check("denied delete left the session intact", !!stillThere.data, JSON.stringify(stillThere.data));
  }
}

// ---- 5) active/inactive members: admin toggle, member sees only active ------
{
  // Pick a member row that has no same-named sibling in another chapter, so a
  // name appearing/leaving the payload is unambiguous.
  const { data: rows } = await sb.from("members").select("id,name").eq("tenant_id", DEFAULT_T).order("name");
  const names = (rows ?? []).map((r) => String(r.name));
  const dupes = new Set(names.filter((n, i) => names.indexOf(n) !== i));
  const target = (rows ?? []).find((r) => !dupes.has(String(r.name)));
  if (!target) {
    check("found a unique member to toggle", false, "no unique member name");
  } else {
    const patch = (headers, body) =>
      fetch(`${APP}/api/members/${target.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const nameIn = (t, s) => t.includes(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    const memberPageBefore = await getHtml("/members", asMember);
    check(
      "member page has no Active column",
      !memberPageBefore.includes('\\"key\\":\\"active\\"'),
      "flight payload",
    );
    const adminPage = await getHtml("/members", asAdmin);
    check("admin page has the Active column", adminPage.includes('\\"key\\":\\"active\\"'), "flight payload");

    const denied = await patch(asMember, { isInactive: true });
    const deniedBody = await denied.json().catch(() => ({}));
    check("member toggle -> 403", denied.status === 403, `status=${denied.status} body=${JSON.stringify(deniedBody)}`);

    // Visibility is checked through the `q` name search so the answer does not
    // depend on the row landing in the first page of 760 members.
    const byName = (headers) =>
      getJson(`/api/members?pageSize=150&q=${encodeURIComponent(target.name)}`, headers);
    const total = (headers) => getJson("/api/members?pageSize=1", headers).then((d) => d.total);

    const totalAdmin0 = await total(asAdmin);
    const flipped = await patch(asAdmin, { isInactive: true });
    const flippedBody = await flipped.json().catch(() => ({}));
    check(
      "admin toggle marks the member inactive",
      flipped.status === 200 && flippedBody.isInactive === true,
      `status=${flipped.status} body=${JSON.stringify(flippedBody)}`,
    );

    const totalAdmin = await total(asAdmin);
    const totalMember = await total(asMember);
    check(
      "totals: member sees one row fewer than admin",
      totalMember === totalAdmin - 1 && totalAdmin === totalAdmin0,
      `memberTotal=${totalMember} adminTotal=${totalAdmin} baseline=${totalAdmin0}`,
    );
    const memberRows = (await byName(asMember)).rows ?? [];
    const adminRows = (await byName(asAdmin)).rows ?? [];
    check(
      "member API hides the inactive row",
      !memberRows.some((r) => r.id === target.id),
      `searchRows=${memberRows.length}`,
    );
    check(
      "admin API still lists the inactive row",
      adminRows.some((r) => r.id === target.id),
      `searchRows=${adminRows.length}`,
    );
    const adminPage2 = await getHtml("/members", asAdmin);
    const memberPage2 = await getHtml("/members", asMember);
    check("member page drops the inactive name", !nameIn(memberPage2, target.name), `name=${target.name}`);
    check("admin page keeps the inactive name", nameIn(adminPage2, target.name), `name=${target.name}`);
    check(
      "member page total counts active rows only",
      memberPage2.includes(`\\"total\\":${totalMember}`),
      `expected total=${totalMember}`,
    );

    const bad = await patch(asAdmin, { isInactive: "yes" });
    check("non-boolean flag -> 400", bad.status === 400, `status=${bad.status}`);
    const unknown = await fetch(`${APP}/api/members/00000000-0000-0000-0000-000000000000`, {
      method: "PATCH",
      headers: { ...asAdmin, "Content-Type": "application/json" },
      body: JSON.stringify({ isInactive: true }),
    });
    check("unknown member id -> 404", unknown.status === 404, `status=${unknown.status}`);
    const restore = await patch(asAdmin, { isInactive: false });
    check("admin toggle restores the member", restore.status === 200, `status=${restore.status}`);
    const totalAdmin1 = await total(asAdmin);
    check(
      "totals back to the pre-toggle baseline",
      totalAdmin1 === totalAdmin0,
      `before=${totalAdmin0} after=${totalAdmin1}`,
    );
    const flag = await sb.from("members").select("is_inactive").eq("id", target.id).maybeSingle();
    check("row left active again", flag.data?.is_inactive === false, JSON.stringify(flag.data));
  }
}

// ---- 6) cleanup + baselines restored --------------------------------------
await preClean();
const afterMemberships = await memberCount();
const afterBatches = await batchCount();
check(
  "cleanup restores membership + batch baselines",
  afterMemberships === baseMemberships && afterBatches === baseBatches,
  JSON.stringify({ afterMemberships, baseMemberships, afterBatches, baseBatches }),
);
const leftovers = await sb
  .from("chat_sessions")
  .select("id")
  .in("owner_uid", [ADMIN_UID, MEMBER_UID]);
check("no leftover fake sessions", (leftovers.data ?? []).length === 0, JSON.stringify(leftovers.data));

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
