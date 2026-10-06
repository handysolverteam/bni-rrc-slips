// E2E: chat ownership (per-user) + the open, role-free active/inactive toggle.
// These are the two behaviours that survived the removal of roles (2026-10-05):
//   - each user only ever sees their OWN chat sessions/messages;
//   - every member of a chapter can flip members active/inactive, and everyone
//     sees inactive rows (no admin/member split any more).
//
// Run:  node tests/e2e-chat-ownership.mjs   (from the repo root)
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
const USER_A = "e2e-owner-a-0001"; // fake uids: safe to insert/delete
const USER_B = "e2e-owner-b-0002";
const NOBODY_UID = "e2e-owner-none-0003";
const FAKE_UIDS = [USER_A, USER_B, NOBODY_UID];

const AUTH = { Authorization: `Bearer ${KEY}` };
const asRoot = AUTH; // plain service key: root, no owner scoping
const asA = { ...AUTH, "x-user-uid": USER_A };
const asB = { ...AUTH, "x-user-uid": USER_B };
const asNobody = { ...AUTH, "x-user-uid": NOBODY_UID };

const TITLE_PREFIX = "E2E ChatOwn";

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const getJson = (path, headers) => fetch(`${APP}${path}`, { headers }).then((r) => r.json());
const getHtml = (path, headers) => fetch(`${APP}${path}`, { headers }).then((r) => r.text());

/**
 * The shell server-renders only a spinner; page content ships as element
 * trees in the RSC flight payload. Decode the pushed segments into one
 * string so assertions can search the rendered tree.
 */
function flight(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // segment not a plain string row — skip
    }
  }
  return out.join("");
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
    // Only this test's root-created sessions carry the title prefix.
    const { data, error } = await sb
      .from("chat_sessions")
      .select("id")
      .is("owner_uid", null)
      .eq("tenant_id", DEFAULT_T)
      .like("title", `${TITLE_PREFIX}%`);
    if (error) return [];
    return (data ?? []).map((r) => r.id);
  }
  const { data } = await sb.from("chat_sessions").select("id").eq("owner_uid", uid);
  return (data ?? []).map((r) => r.id);
}

// ---- cleanup (also used for pre-clean so re-runs are idempotent) ----------
async function preClean() {
  const ids = [
    ...(await sessionIdsFor(USER_A)),
    ...(await sessionIdsFor(USER_B)),
    ...(await sessionIdsFor(null)),
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

// ---- setup: two members of the default tenant (no role column needed) ------
{
  const { error } = await sb.from("tenant_members").insert([
    { tenant_id: DEFAULT_T, uid: USER_A },
    { tenant_id: DEFAULT_T, uid: USER_B },
  ]);
  if (error) {
    console.log(`FAIL  provision two members  :: ${error.message}`);
    console.log("      (is supabase/migrations/004_tenants.sql applied?)");
    process.exit(1);
  }
}

// ---- 1) tenant resolution carries no role ---------------------------------
{
  const a = await getJson("/api/tenant", asA);
  check("member A resolves a tenant", a.noAccess === false && !!a.tenant, JSON.stringify(a));
  check("tenant payload has no role field", !("role" in a), JSON.stringify(a));
  const n = await getJson("/api/tenant", asNobody);
  check("x-user-uid without membership -> noAccess", n.noAccess === true, JSON.stringify(n));
}

// ---- 2) chats are per user ------------------------------------------------
let sessionA = null;
let sessionB = null;
{
  const create = (headers, title) =>
    fetch(`${APP}/api/chat/sessions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => r.json());
  sessionA = (await create(asA, `${TITLE_PREFIX} A Chat`)).session;
  sessionB = (await create(asB, `${TITLE_PREFIX} B Chat`)).session;
  const sessionRoot = (await create(asRoot, `${TITLE_PREFIX} Root Chat`)).session;
  check(
    "sessions created for both users + root",
    !!sessionA && !!sessionB && !!sessionRoot,
    JSON.stringify({ sessionA, sessionB, sessionRoot }),
  );

  const ids = (l) => (l.sessions ?? []).map((s) => s.id);
  const listA = ids(await getJson("/api/chat/sessions", asA));
  const listB = ids(await getJson("/api/chat/sessions", asB));
  const listRoot = ids(await getJson("/api/chat/sessions", asRoot));
  check(
    "user A sees only own chat",
    listA.includes(sessionA?.id) && !listA.includes(sessionB?.id) && !listA.includes(sessionRoot?.id),
    JSON.stringify(listA),
  );
  check(
    "user B sees only own chat",
    listB.includes(sessionB?.id) && !listB.includes(sessionA?.id) && !listB.includes(sessionRoot?.id),
    JSON.stringify(listB),
  );
  check(
    "service root sees every chat of the tenant",
    listRoot.includes(sessionA?.id) && listRoot.includes(sessionB?.id) && listRoot.includes(sessionRoot?.id),
    `len=${listRoot.length}`,
  );

  if (sessionA) {
    await sb.from("chat_messages").insert({ session_id: sessionA.id, sender: "user", text: "owner only" });
    const ownerRead = await fetch(`${APP}/api/chat/sessions/${sessionA.id}/messages`, { headers: asA });
    const ownerBody = await ownerRead.json().catch(() => ({}));
    check("owner reads own messages", ownerRead.status === 200 && ownerBody.messages?.length === 1, `status=${ownerRead.status}`);

    const crossRead = await fetch(`${APP}/api/chat/sessions/${sessionA.id}/messages`, { headers: asB });
    check("other user's messages -> 404", crossRead.status === 404, `status=${crossRead.status}`);
    const crossRename = await fetch(`${APP}/api/chat/sessions/${sessionA.id}`, {
      method: "PATCH",
      headers: { ...asB, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "stolen" }),
    });
    check("other user's rename -> 404", crossRename.status === 404, `status=${crossRename.status}`);
    const crossDelete = await fetch(`${APP}/api/chat/sessions/${sessionA.id}`, { method: "DELETE", headers: asB });
    check("other user's delete -> 404", crossDelete.status === 404, `status=${crossDelete.status}`);
    const stillThere = await sb.from("chat_sessions").select("id").eq("id", sessionA.id).maybeSingle();
    check("denied delete left the session intact", !!stillThere.data, JSON.stringify(stillThere.data));
  }
}

// ---- 3) active/inactive toggle is open to every member --------------------
{
  // Pick a member row with no same-named sibling, so a name appearing/leaving
  // the payload is unambiguous.
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
    // Checked through the `q` name search so the answer does not depend on the
    // row landing in the first page of the member list.
    const byName = (headers) =>
      getJson(`/api/members?pageSize=150&q=${encodeURIComponent(target.name)}`, headers);
    const total = (headers) => getJson("/api/members?pageSize=1", headers).then((d) => d.total);
    const nameIn = (t, s) => t.includes(String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    check("member page has the Active column (A)", (await getHtml("/members", asA)).includes('\\"key\\":\\"active\\"'), "flight payload");
    check("member page has the Active column (B)", (await getHtml("/members", asB)).includes('\\"key\\":\\"active\\"'), "flight payload");

    const total0 = await total(asA);
    const flipped = await patch(asB, { isInactive: true }); // B is not an admin
    const flippedBody = await flipped.json().catch(() => ({}));
    check(
      "any member can mark inactive",
      flipped.status === 200 && flippedBody.isInactive === true,
      `status=${flipped.status} body=${JSON.stringify(flippedBody)}`,
    );

    const rowsA = (await byName(asA)).rows ?? [];
    const rowsB = (await byName(asB)).rows ?? [];
    check(
      "everyone's API lists the inactive row",
      rowsA.some((r) => r.id === target.id) && rowsB.some((r) => r.id === target.id),
      `a=${rowsA.length} b=${rowsB.length}`,
    );
    check(
      "inactive rows are not filtered out of totals",
      (await total(asA)) === total0 && (await total(asB)) === total0,
      `baseline=${total0}`,
    );
    check(
      "page shows the inactive name to both users",
      nameIn(await getHtml("/members", asA), target.name) && nameIn(await getHtml("/members", asB), target.name),
      `name=${target.name}`,
    );

    // Requirement: active/inactive counts under the title + an Active
    // checkbox filter that hides inactive rows.
    const decM = flight(await getHtml("/members", asA));
    const cAll = await sb.from("members").select("id", { count: "exact", head: true }).eq("tenant_id", DEFAULT_T);
    const cAct = await sb
      .from("members").select("id", { count: "exact", head: true })
      .eq("tenant_id", DEFAULT_T).eq("is_inactive", false);
    const nAll = cAll.count ?? 0;
    const nAct = cAct.count ?? 0;
    const fmtN = (n) => n.toLocaleString("en-IN");
    check(
      "members title shows 'N active · M inactive'",
      decM.includes(`${fmtN(nAct)} active \u00b7 ${fmtN(nAll - nAct)} inactive`),
      `${nAct} active / ${nAll - nAct} inactive`,
    );
    check(
      "members page ships the Active checkbox filter",
      decM.includes('"activeToggle"') && decM.includes('"label":"Active"'),
      "",
    );
    const atSlice = (dec) => {
      const a = dec.indexOf('"activeToggle":');
      return a < 0 ? "" : dec.slice(a, a + 140);
    };
    check("plain page renders the checkbox unchecked", atSlice(decM).includes('"checked":false'), atSlice(decM));
    check("active=1 renders the checkbox checked", atSlice(flight(await getHtml("/members?active=1", asA))).includes('"checked":true'), "");

    // The rows prop sits between "rows":[ and "filterable": in the flight
    // payload, so the name check is scoped to table rows (the name column
    // filter options still list every member either way).
    const rowsSliceOf = (dec) => {
      const a = dec.indexOf('"rows":[');
      if (a < 0) return "";
      const b = dec.indexOf('"filterable":', a);
      return b > a ? dec.slice(a, b) : dec.slice(a, a + 40000);
    };
    const qName = encodeURIComponent(target.name);
    const decQ = flight(await getHtml(`/members?q=${qName}`, asA));
    const decQa = flight(await getHtml(`/members?q=${qName}&active=1`, asA));
    check(
      "active=1 hides the inactive row (unfiltered search still shows it)",
      rowsSliceOf(decQ).includes(String(target.name)) && !rowsSliceOf(decQa).includes(String(target.name)),
      `unfiltered=${rowsSliceOf(decQ).slice(0, 160)}`,
    );

    const bad = await patch(asA, { isInactive: "yes" });
    check("non-boolean flag -> 400", bad.status === 400, `status=${bad.status}`);
    const unknown = await fetch(`${APP}/api/members/00000000-0000-0000-0000-000000000000`, {
      method: "PATCH",
      headers: { ...asA, "Content-Type": "application/json" },
      body: JSON.stringify({ isInactive: true }),
    });
    check("unknown member id -> 404", unknown.status === 404, `status=${unknown.status}`);
    const restore = await patch(asA, { isInactive: false });
    check("toggle restores the member", restore.status === 200, `status=${restore.status}`);
    const flag = await sb.from("members").select("is_inactive").eq("id", target.id).maybeSingle();
    check("row left active again", flag.data?.is_inactive === false, JSON.stringify(flag.data));
  }
}

// ---- 4) cleanup + baselines restored --------------------------------------
await preClean();
const afterMemberships = await memberCount();
check(
  "cleanup restores the membership baseline",
  afterMemberships === baseMemberships,
  JSON.stringify({ afterMemberships, baseMemberships }),
);
const leftovers = await sb.from("chat_sessions").select("id").in("owner_uid", [USER_A, USER_B]);
check("no leftover fake sessions", (leftovers.data ?? []).length === 0, JSON.stringify(leftovers.data));

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);