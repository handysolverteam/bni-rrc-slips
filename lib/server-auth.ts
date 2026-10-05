import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";

export const SESSION_COOKIE = "bni_session";
export const TENANT_COOKIE = "bni_tenant";

/** Fixed id created by supabase/migrations/004_tenants.sql (backfill target). */
export const DEFAULT_TENANT_ID = "d1000000-0000-4000-8000-000000000001";

export type Role = "admin" | "member";

export type TenantContext =
  /** Signed in, member of the returned active tenant (with that membership's role). */
  | { uid: string; tenantId: string; role: Role }
  /** Signed in, but no tenant_members rows for this uid (manual provisioning needed). */
  | { uid: string; noAccess: true }
  /** Server-to-server caller authenticated with the service-role key. Root (uid null,
   *  role admin) unless it sends x-user-uid to act as that user (then role/ownership
   *  come from that user's membership — no membership = noAccess). */
  | { uid: string | null; tenantId: string; service: true; role: Role }
  | null;

/**
 * Resolves the tenant for the current request. Two modes:
 *
 * 1. Browser: HttpOnly `bni_session` cookie (verified Firebase ID token) ->
 *    uid -> `tenant_members` -> active tenant + role from the `bni_tenant`
 *    cookie (falls back to the first membership when the cookie is
 *    absent/foreign).
 * 2. Server-to-server (e2e tests, scripts): `Authorization: Bearer <service
 *    role key>`; tenant via `x-tenant-id` header or `?tenant=` param,
 *    defaulting to the default tenant. Optional `x-user-uid` makes the call
 *    act as that user (role + chat ownership looked up from their membership).
 *
 * Returns null when unauthenticated — callers answer 401 (API) or redirect
 * to /login (pages). A membership-less uid gets `noAccess` so the UI can
 * print the provisioning SQL.
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
        .select("role")
        .eq("tenant_id", asked)
        .eq("uid", userHeader)
        .maybeSingle();
      if (!membership) return { uid: userHeader, noAccess: true };
      return { uid: userHeader, tenantId: asked, service: true, role: roleOf(membership.role) };
    }
    return { uid: null, tenantId: asked, service: true, role: "admin" };
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
    .select("tenant_id, role")
    .eq("uid", uid);
  if (!memberships || memberships.length === 0) return { uid, noAccess: true };

  const active = jar.get(TENANT_COOKIE)?.value;
  const match = memberships.find((m) => m.tenant_id === active) ?? memberships[0];
  return { uid, tenantId: match.tenant_id, role: roleOf(match.role) };
}

/** DB column is text; only 'member' is restrictive — anything else acts as admin. */
function roleOf(role: unknown): Role {
  return role === "member" ? "member" : "admin";
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
 * Write gate for admin-only API surfaces (import). Call after the null/noAccess
 * checks; returns 403 when the caller's role is 'member', else null.
 *
 *   const denied = adminOnly(ctx);
 *   if (denied) return denied;
 */
export function adminOnly(ctx: TenantContext): Response | null {
  if (!ctx || "noAccess" in ctx) return null;
  return ctx.role === "admin" ? null : forbidden("Admin access required.");
}

/**
 * Server-component page guard: redirects to /login when the session cookie
 * is missing/invalid (login bounces authed users back to /), and reports
 * noAccess so the page can render <NoAccess> instead of querying with a
 * tenant the user does not have. `role` drives admin-only UI (import).
 *
 *   const guard = await requirePageTenant();
 *   if ("noAccess" in guard) return <NoAccess uid={guard.uid} />;
 *   const tenantId = guard.tenantId;
 */
export async function requirePageTenant(): Promise<
  { uid: string; tenantId: string; role: Role } | { uid: string; noAccess: true }
> {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if ("noAccess" in ctx) return { uid: ctx.uid, noAccess: true };
  return { uid: ctx.uid ?? "", tenantId: ctx.tenantId, role: ctx.role };
}
