import { cookies } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase/server";
import { TENANT_COOKIE, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Current tenant + every tenant this user may switch to (+ active role). */
export async function GET(request: Request) {
  const ctx = await getTenantContext(request);
  if (!ctx) return unauthorized();
  if ("noAccess" in ctx) {
    return Response.json({ uid: ctx.uid, tenant: null, tenants: [], noAccess: true });
  }
  if ("service" in ctx) {
    const sb = getSupabaseServer();
    const { data } = await sb.from("tenants").select("id, name").eq("id", ctx.tenantId).maybeSingle();
    return Response.json({
      uid: ctx.uid,
      tenant: data ?? null,
      tenants: data ? [data] : [],
      noAccess: false,
      role: ctx.role,
    });
  }

  const sb = getSupabaseServer();
  const { data: rows } = await sb
    .from("tenant_members")
    .select("tenant_id, tenants(id, name)")
    .eq("uid", ctx.uid);
  const tenants = (rows ?? [])
    .map((r) => r.tenants as { id: string; name: string } | { id: string; name: string }[] | null)
    .flatMap((t) => (Array.isArray(t) ? t : t ? [t] : []));
  const active = tenants.find((t) => t.id === ctx.tenantId) ?? tenants[0] ?? null;
  return Response.json({ uid: ctx.uid, tenant: active, tenants, noAccess: false, role: ctx.role });
}

/** Switch the active tenant — 403 unless the caller is a member. */
export async function POST(request: Request) {
  const ctx = await getTenantContext(request);
  if (!ctx) return unauthorized();
  if ("service" in ctx) {
    return Response.json({ error: "Service callers pass x-tenant-id per request instead." }, { status: 400 });
  }
  if ("noAccess" in ctx) {
    return Response.json({ error: "You do not have access to any chapter yet." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { tenantId?: unknown } | null;
  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
  if (!tenantId) return Response.json({ error: "Missing tenantId." }, { status: 400 });

  const sb = getSupabaseServer();
  const { data: membership } = await sb
    .from("tenant_members")
    .select("tenant_id")
    .eq("uid", ctx.uid)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!membership) {
    return Response.json({ error: "You are not a member of that chapter." }, { status: 403 });
  }

  const jar = await cookies();
  jar.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.VERCEL === "1",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ ok: true, tenantId });
}
