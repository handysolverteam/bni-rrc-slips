import { getSupabaseServer } from "@/lib/supabase/server";
import { clearDistinctCache } from "@/lib/distinct";
import { adminOnly, forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * PATCH /api/members/{id}  { isInactive: boolean }
 * Admin-only active/inactive toggle. Tenant-scoped: the id must belong to the
 * caller's active tenant, so a crafted id from another chapter is a 404.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getTenantContext(req);
  if (!auth) return unauthorized();
  if ("noAccess" in auth) return forbidden();
  const denied = adminOnly(auth);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) return Response.json({ error: "Missing member id." }, { status: 400 });

  let isInactive: unknown;
  try {
    ({ isInactive } = await req.json());
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof isInactive !== "boolean") {
    return Response.json({ error: "`isInactive` must be a boolean." }, { status: 400 });
  }

  const { data, error } = await getSupabaseServer()
    .from("members")
    .update({ is_inactive: isInactive })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select("id, is_inactive")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Member not found." }, { status: 404 });
  // The active/inactive flag feeds the active-only dropdown options, which are
  // cached 5 minutes: drop them or the toggle would not show up right away.
  clearDistinctCache();
  return Response.json({ id: data.id, isInactive: data.is_inactive });
}