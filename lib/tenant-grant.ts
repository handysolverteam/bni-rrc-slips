import type { SupabaseClient } from "@supabase/supabase-js";

/** Fixed id created by supabase/migrations/004_tenants.sql (backfill target). */
export const DEFAULT_TENANT_ID = "d1000000-0000-4000-8000-000000000001";

/**
 * Open sign-in: a signed-in Google account with no membership yet is granted
 * the Home Chapter on the spot, so first-time users land on the data instead
 * of the "No chapter access" screen (no SQL, no admin UI).
 *
 * Idempotent — PK upsert with `ignoreDuplicates`, so concurrent bootstrap
 * requests and repeat visits never error or duplicate a row.
 *
 * Returns the Home Chapter tenant id, or `null` when the grant failed (the
 * `tenants` row is missing or the write was rejected) so the caller can fall
 * back to `{ uid, noAccess: true }`.
 *
 * Only the browser (session-cookie) path calls this. Service callers with
 * `x-user-uid` are never auto-granted, so scripts/tests can still detect a
 * membership that does not exist.
 */
export async function grantHomeChapter(
  sb: SupabaseClient,
  uid: string,
): Promise<string | null> {
  if (!uid) return null;
  try {
    const { data: tenant } = await sb
      .from("tenants")
      .select("id")
      .eq("id", DEFAULT_TENANT_ID)
      .maybeSingle();
    if (!tenant) return null;

    const { error } = await sb
      .from("tenant_members")
      .upsert(
        { tenant_id: DEFAULT_TENANT_ID, uid },
        { onConflict: "tenant_id,uid", ignoreDuplicates: true },
      );
    if (error) return null;
    return DEFAULT_TENANT_ID;
  } catch {
    return null;
  }
}
