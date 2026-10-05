import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** chat_messages has no tenant_id of its own — scope through its session.
 *  Tenant + (when the caller has a uid) owner: another user's session 404s. */
async function requireOwnSession(
  ctx: { tenantId: string; uid?: string | null },
  sessionId: string,
): Promise<Response | null> {
  const sb = getSupabaseServer();
  let query = sb
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("tenant_id", ctx.tenantId);
  if (ctx.uid) query = query.eq("owner_uid", ctx.uid);
  const { data } = await query.maybeSingle();
  if (!data) return Response.json({ error: "Chat not found." }, { status: 404 });
  return null;
}

/** List messages of a chat session, oldest first. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const { id } = await params;
    const denied = await requireOwnSession(ctx, id);
    if (denied) return denied;
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("chat_messages")
      .select("id,sender,text,created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ messages: data ?? [] });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load messages." },
      { status: 500 },
    );
  }
}

/** Clear all messages of a chat session (keeps the session). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const { id } = await params;
    const denied = await requireOwnSession(ctx, id);
    if (denied) return denied;
    const sb = getSupabaseServer();
    const { error } = await sb.from("chat_messages").delete().eq("session_id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to clear chat." },
      { status: 500 },
    );
  }
}
