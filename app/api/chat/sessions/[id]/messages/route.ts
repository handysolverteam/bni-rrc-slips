import { getSupabaseServer } from "@/lib/supabase/server";

/** List messages of a chat session, oldest first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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
