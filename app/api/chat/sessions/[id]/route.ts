import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Scope helper: tenant + (when the caller has a uid) owner — so users only
 *  ever touch their own chats; plain service callers (no uid) touch all. */
function scope(ctx: { tenantId: string; uid?: string | null }, sb: ReturnType<typeof getSupabaseServer>) {
  let query = sb.from("chat_sessions").select("id").eq("tenant_id", ctx.tenantId);
  if (ctx.uid) query = query.eq("owner_uid", ctx.uid);
  return query;
}

/** Rename a chat session (tenant + owner scoped: another's session 404s). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const title = String(body.title ?? "").trim().slice(0, 120);
    if (!title) return Response.json({ error: "Title is required." }, { status: 400 });

    const sb = getSupabaseServer();
    const { data: exists } = await scope(ctx, sb).eq("id", id).maybeSingle();
    if (!exists) return Response.json({ error: "Chat not found." }, { status: 404 });
    const { data, error } = await sb
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ session: data });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to rename chat." },
      { status: 500 },
    );
  }
}

/** Delete a chat session and all its messages (tenant + owner scoped). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const { id } = await params;
    const sb = getSupabaseServer();
    const { data: exists } = await scope(ctx, sb).eq("id", id).maybeSingle();
    if (!exists) return Response.json({ error: "Chat not found." }, { status: 404 });
    const { error } = await sb
      .from("chat_sessions")
      .delete()
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to delete chat." },
      { status: 500 },
    );
  }
}
