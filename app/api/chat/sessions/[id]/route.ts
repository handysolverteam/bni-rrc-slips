import { getSupabaseServer } from "@/lib/supabase/server";

/** Rename a chat session. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const title = String(body.title ?? "").trim().slice(0, 120);
    if (!title) return Response.json({ error: "Title is required." }, { status: 400 });

    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id)
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

/** Delete a chat session and all its messages. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sb = getSupabaseServer();
    const { error } = await sb.from("chat_sessions").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to delete chat." },
      { status: 500 },
    );
  }
}
