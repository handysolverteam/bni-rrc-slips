// Unit: open sign-in auto-grant (lib/tenant-grant.ts) — a first-time Google
// account is granted the Home Chapter instead of hitting the manual
// provisioning screen.
//
// Run:  node tests/unit-autogrant.mjs   (from the repo root)
// Needs .env.local (service key) + migrations 004/005 applied. Writes exactly
// one tenant_members row for a fake uid and removes it again.
// Node >= 22.18 strips the TypeScript types itself, so the module under test
// is imported directly.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { grantHomeChapter, DEFAULT_TENANT_ID } from "../lib/tenant-grant.ts";

const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const kv = (k) => ENV.split(/\r?\n/).find((l) => l.startsWith(k + "="))?.slice(k.length + 1);
const sb = createClient(kv("NEXT_PUBLIC_SUPABASE_URL"), kv("SUPABASE_SERVICE_ROLE_KEY"));

const FAKE_UID = "e2e-autogrant-0001";

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
const row = () => sb.from("tenant_members").select("tenant_id, uid").eq("uid", FAKE_UID).maybeSingle();

// pre-clean so re-runs are idempotent
await sb.from("tenant_members").delete().eq("uid", FAKE_UID);

// The grant is designed to fail when the Home Chapter row is missing, so that
// row must exist for the rest of this test to mean anything.
{
  const { data: home } = await sb.from("tenants").select("id").eq("id", DEFAULT_TENANT_ID).maybeSingle();
  check("home chapter tenants row exists", !!home, JSON.stringify(home));
}

// 1) first visit: a uid with no membership gets the Home Chapter
{
  const first = await grantHomeChapter(sb, FAKE_UID);
  check("first call grants the Home Chapter", first === DEFAULT_TENANT_ID, String(first));
  const after = await row();
  check(
    "membership row written for that uid",
    after.data?.tenant_id === DEFAULT_TENANT_ID && after.data?.uid === FAKE_UID,
    JSON.stringify(after.data),
  );
}

// 2) repeat + concurrent calls are idempotent (bootstrap can run twice at once)
{
  const [second, third] = await Promise.all([
    grantHomeChapter(sb, FAKE_UID),
    grantHomeChapter(sb, FAKE_UID),
  ]);
  check(
    "repeat/concurrent calls still return the Home Chapter",
    second === DEFAULT_TENANT_ID && third === DEFAULT_TENANT_ID,
    JSON.stringify([second, third]),
  );
  const { count } = await sb
    .from("tenant_members")
    .select("uid", { count: "exact", head: true })
    .eq("uid", FAKE_UID);
  check("still exactly one row (no duplicates)", count === 1, String(count));
}

// 3) guard: an empty uid is never granted
check("empty uid is rejected", (await grantHomeChapter(sb, "")) === null, "");

// cleanup + baseline restored
await sb.from("tenant_members").delete().eq("uid", FAKE_UID);
{
  const after = await row();
  check("cleanup removed the row", !after.data, JSON.stringify(after.data));
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
