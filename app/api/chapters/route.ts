import { cookies } from "next/headers";
import { createChapterTenant } from "@/lib/chapter-target";
import { TENANT_COOKIE, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * Add a chapter (a new tenant with its own home chapter row), make the caller
 * a member and switch to it. Used by Settings → "Add a chapter".
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext(request);
  if (!ctx) return unauthorized();
  if ("noAccess" in ctx || "service" in ctx || !ctx.uid) {
    return Response.json({ error: "Sign in to add a chapter." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const made = await createChapterTenant(ctx.uid, name);
  if ("error" in made) return Response.json({ error: made.error }, { status: 400 });

  const jar = await cookies();
  jar.set(TENANT_COOKIE, made.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.VERCEL === "1",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ ok: true, tenantId: made.id, name: made.name });
}
