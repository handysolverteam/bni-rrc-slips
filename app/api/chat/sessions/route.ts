import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** List the caller's chat sessions, most recently active first (tenant + owner scoped). */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const sb = getSupabaseServer();
    let query = sb
      .from("chat_sessions")
      .select("id,title,created_at,updated_at")
      .eq("tenant_id", ctx.tenantId);
    // Per-user chats: a caller with a uid only ever sees its own sessions
    // (plain service callers have no uid — root view of the tenant).
    if (ctx.uid) query = query.eq("owner_uid", ctx.uid);
    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ sessions: data ?? [] });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to list chats." },
      { status: 500 },
    );
  }
}

/** Start a new (empty) chat session owned by the caller in the active tenant. */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("chat_sessions")
      .insert({
        title: String(body.title ?? "New chat").slice(0, 120) || "New chat",
        tenant_id: ctx.tenantId,
        // owner_uid only when a uid exists (plain service calls stay unowned).
        ...(ctx.uid ? { owner_uid: ctx.uid } : {}),
      })
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ session: data });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to create chat." },
      { status: 500 },
    );
  }
}
