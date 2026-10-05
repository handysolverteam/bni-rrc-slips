import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";
import { DEFAULT_TENANT_ID, grantHomeChapter } from "@/lib/tenant-grant";

export const SESSION_COOKIE = "bni_session";
export const TENANT_COOKIE = "bni_tenant";

/** Re-exported so existing imports keep working (defined in lib/tenant-grant). */
export { DEFAULT_TENANT_ID };

/**
 * Roles were removed (2026-10-05): every tenant member can import, browse,
 * export, toggle members and chat. `tenant_members.role` still exists in the
 * database but nothing reads it, so roles can be re-applied later.
 */
export type TenantContext =
  /** Signed in, member of the returned active tenant. */
  | { uid: string; tenantId: string }
  /** Signed in, but the Home Chapter auto-grant failed (its tenants row is
   *  missing) — the UI shows the uid + SQL fallback. */
  | { uid: string; noAccess: true }
  /** Server-to-server caller authenticated with the service-role key. Root (uid
   *  null) unless it sends x-user-uid to act as that user (then chat ownership
   *  comes from that uid; no membership = noAccess). */
  | { uid: string | null; tenantId: string; service: true }
  | null;

/**
 * Resolves the tenant for the current request. Two modes:
 *
 * 1. Browser: HttpOnly `bni_session` cookie (verified Firebase ID token) ->
 *    uid -> `tenant_members` -> active tenant from the `bni_tenant` cookie
 *    (falls back to the first membership when the cookie is absent/foreign).
 *    **Open sign-in**: a uid with zero memberships is auto-granted the Home
 *    Chapter first (`grantHomeChapter`), so a first Google sign-in works with
 *    no setup; `noAccess` survives only when that grant failed.
 * 2. Server-to-server (e2e tests, scripts): `Authorization: Bearer <service
 *    role key>`; tenant via `x-user-uid` header or `?tenant=` param,
 *    defaulting to the default tenant. Optional `x-user-uid` makes the call
 *    act as that user (chat ownership from that uid) — never auto-granted,
 *    so a missing membership still returns `noAccess`.
 *
 * Returns null when unauthenticated — callers answer 401 (API) or redirect
 * to /login (pages).
 */
export async function getTenantContext(req?: Request): Promise<TenantContext> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Route handlers pass the Request; server components read Next's headers().
  let authHeader: string | null;
  let tenantHeader: string | null;
  let tenantParam: string | null;
  let userHeader: string | null;
  if (req) {
    authHeader = req.headers.get("authorization");
    tenantHeader = req.headers.get("x-tenant-id");
    tenantParam = new URL(req.url).searchParams.get("tenant");
    userHeader = req.headers.get("x-user-uid");
  } else {
    const h = await headers();
    authHeader = h.get("authorization");
    tenantHeader = h.get("x-tenant-id");
    tenantParam = null;
    userHeader = h.get("x-user-uid");
  }
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
    const asked = tenantHeader || tenantParam || DEFAULT_TENANT_ID;
    const sb = getSupabaseServer();
    const { data } = await sb.from("tenants").select("id").eq("id", asked).maybeSingle();
    if (!data) return null;
    if (userHeader) {
      const { data: membership } = await sb
        .from("tenant_members")
        .select("tenant_id")
        .eq("tenant_id", asked)
        .eq("uid", userHeader)
        .maybeSingle();
      if (!membership) return { uid: userHeader, noAccess: true };
      return { uid: userHeader, tenantId: asked, service: true };
    }
    return { uid: null, tenantId: asked, service: true };
  }

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let uid: string;
  try {
    ({ uid } = await verifyFirebaseIdToken(token));
  } catch {
    return null;
  }

  const sb = getSupabaseServer();
  const { data: memberships } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("uid", uid);
  if (!memberships || memberships.length === 0) {
    // Open sign-in: grant the Home Chapter on first visit instead of
    // sending the user to the manual-provisioning screen.
    const granted = await grantHomeChapter(sb, uid);
    if (!granted) return { uid, noAccess: true };
    return { uid, tenantId: granted };
  }

  const active = jar.get(TENANT_COOKIE)?.value;
  const match = memberships.find((m) => m.tenant_id === active) ?? memberships[0];
  return { uid, tenantId: match.tenant_id };
}

/** Standard 401 body for API routes. */
export function unauthorized() {
  return Response.json({ error: "Not signed in." }, { status: 401 });
}

/** 403 for a signed-in user without access to the active/requested tenant. */
export function forbidden(message = "You do not have access to this chapter.") {
  return Response.json({ error: message }, { status: 403 });
}

/**
 * Server-component page guard: redirects to /login when the session cookie
 * is missing/invalid (login bounces authed users back to /), and reports
 * noAccess so the page can render <NoAccess> instead of querying with a
 * tenant the user does not have.
 *
 *   const guard = await requirePageTenant();
 *   if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
 *   const tenantId = guard.tenantId;
 */
export async function requirePageTenant(): Promise<
  { uid: string; tenantId: string } | { uid: string; noAccess: true }
> {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if ("noAccess" in ctx) return { uid: ctx.uid, noAccess: true };
  return { uid: ctx.uid ?? "", tenantId: ctx.tenantId };
}
