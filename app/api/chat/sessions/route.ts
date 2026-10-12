import { accountLabel, accountsFor } from "@/lib/chat/accounts";
import { getSupabaseServer } from "@/lib/supabase/server";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** A missing `owner_name` column means migration 009 has not been run yet. */
const noColumn = (message: string | undefined): boolean => /owner_name/i.test(message ?? "");

const cleanName = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * List the chapter's chat sessions, most recently active first — EVERY
 * account's chats (the page groups them per account). `mine` marks the caller's
 * own; the others are read-only for the caller. `?name=` is the caller's own
 * display name: it back-fills `owner_name` on that caller's older chats.
 * (Plain service callers have no uid: everything is "mine".)
 */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantContext(request);
    if (!ctx) return unauthorized();
    if ("noAccess" in ctx) return forbidden();
    const sb = getSupabaseServer();

    const me = cleanName(new URL(request.url).searchParams.get("name"));
    if (ctx.uid && me) {
      // Best effort: label this account's unlabeled chats (ignored without migration 009).
      await sb
        .from("chat_sessions")
        .update({ owner_name: me })
        .eq("tenant_id", ctx.tenantId)
        .eq("owner_uid", ctx.uid)
        .is("owner_name", null);
    }

    const list = (cols: string) =>
      sb
        .from("chat_sessions")
        .select(cols)
        .eq("tenant_id", ctx.tenantId)
        .order("updated_at", { ascending: false })
        .limit(300);
    let res = await list("id,title,created_at,updated_at,owner_uid,owner_name");
    if (res.error && noColumn(res.error.message)) res = await list("id,title,created_at,updated_at,owner_uid");
    if (res.error) return Response.json({ error: res.error.message }, { status: 500 });

    const rows = (res.data ?? []) as unknown as Record<string, unknown>[];
    // Name every owner from the account itself (works without migration 009); the
    // stored `owner_name` only wins when the account lookup has nothing.
    const accounts = await accountsFor(rows.map((s) => String(s.owner_uid ?? "")));
    const sessions = rows.map((s) => {
      const acct = accounts.get(String(s.owner_uid ?? ""));
      return {
        ...s,
        owner_name: accountLabel(acct) || ((s.owner_name as string | null | undefined) ?? null),
        owner_email: acct?.email ?? null,
        mine: !ctx.uid || s.owner_uid === ctx.uid,
      };
    });
    return Response.json({ sessions });
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
    const body = (await request.json().catch(() => ({}))) as { title?: string; ownerName?: string };
    const sb = getSupabaseServer();
    const base: Record<string, unknown> = {
      title: String(body.title ?? "New chat").slice(0, 120) || "New chat",
      tenant_id: ctx.tenantId,
      // owner_uid only when a uid exists (plain service calls stay unowned).
      ...(ctx.uid ? { owner_uid: ctx.uid } : {}),
    };
    const ownerName = ctx.uid ? cleanName(body.ownerName) : "";
    let res = await sb
      .from("chat_sessions")
      .insert(ownerName ? { ...base, owner_name: ownerName } : base)
      .select()
      .single();
    if (res.error && noColumn(res.error.message)) res = await sb.from("chat_sessions").insert(base).select().single();
    if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
    return Response.json({ session: res.data });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to create chat." },
      { status: 500 },
    );
  }
}
