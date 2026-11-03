import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** GET /api/members/emails -> { members: [{ name, email }] }: the chapter's ACTIVE members that have an email (email-share picker). */
export async function GET(req: Request) {
  try {
    const ctx = await getTenantContext(req);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const { data, error } = await getSupabaseServer()
      .from("members")
      .select("name, email")
      .eq("tenant_id", ctx.tenantId)
      .eq("is_inactive", false)
      .not("email", "is", null)
      .neq("email", "")
      .order("name")
      .limit(1000);
    if (error) throw new Error(error.message);
    return Response.json({ members: data ?? [] });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
