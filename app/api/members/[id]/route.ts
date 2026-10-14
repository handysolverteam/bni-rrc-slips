import { getSupabaseServer } from "@/lib/supabase/server";
import { clearDistinctCache } from "@/lib/distinct";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * PATCH /api/members/{id}  { isInactive?: boolean, category?: string, company?: string, phone?: string }
 * Active/inactive toggle and the editable Category / Company / Phone boxes, open to any signed-in member of the active tenant
 * (roles were removed). Tenant-scoped: the id must belong to the caller's
 * active tenant, so a crafted id from another chapter is a 404.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getTenantContext(req);
  if (!auth) return unauthorized();
  if ("noAccess" in auth) return forbidden();

  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "Missing member id." }, { status: 400 });

  let body: { isInactive?: unknown; category?: unknown; company?: unknown; phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const update: Record<string, unknown> = {};
  if (body.isInactive !== undefined) {
    if (typeof body.isInactive !== "boolean") {
      return Response.json({ error: "`isInactive` must be a boolean." }, { status: 400 });
    }
    update.is_inactive = body.isInactive;
  }
  // Free-text columns edited in place on the members table (blank clears the value).
  const TEXT_FIELDS = { category: 200, company: 200, phone: 40 } as const;
  for (const field of Object.keys(TEXT_FIELDS) as (keyof typeof TEXT_FIELDS)[]) {
    const v = body[field];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.length > TEXT_FIELDS[field]) {
      return Response.json({ error: `\`${field}\` must be a string of at most ${TEXT_FIELDS[field]} characters.` }, { status: 400 });
    }
    update[field] = v.replace(/\s+/g, " ").trim() || null;
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: "Nothing to update: send `isInactive`, `category`, `company` and/or `phone`." }, { status: 400 });
  }

  const { data, error } = await getSupabaseServer()
    .from("members")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select("id, is_inactive, category, company, phone")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Member not found." }, { status: 404 });
  // The active/inactive flag feeds the active-only dropdown options, which are
  // cached 5 minutes: drop them or the toggle would not show up right away.
  clearDistinctCache();
  return Response.json({ id: data.id, isInactive: data.is_inactive, category: data.category, company: data.company, phone: data.phone });
}