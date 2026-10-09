import { clearDistinctCache } from "@/lib/distinct";
import { clearSlipsSnapshotCache } from "@/lib/chat/snapshot-cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/**
 * Choose which chapter is the Home Chapter of the active tenant. The name must
 * be one of the tenant's own chapters. New (non-bold) names in slip imports
 * file here, and PALMS members are added here.
 */
export async function PATCH(request: Request) {
  const ctx = await getTenantContext(request);
  if (!ctx) return unauthorized();
  if ("noAccess" in ctx) return forbidden();

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return Response.json({ error: "Choose a chapter." }, { status: 400 });

  const sb = getSupabaseServer();
  const { data: chapter } = await sb
    .from("chapters")
    .select("name")
    .eq("tenant_id", ctx.tenantId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (!chapter) return Response.json({ error: "That chapter does not exist in this chapter's data." }, { status: 400 });

  const { error } = await sb
    .from("tenants")
    .update({ home_chapter_name: (chapter as { name: string }).name })
    .eq("id", ctx.tenantId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  clearDistinctCache();
  clearSlipsSnapshotCache();
  return Response.json({ ok: true, homeChapter: (chapter as { name: string }).name });
}
