import { getSupabaseServer } from "@/lib/supabase/server";

/** List chat sessions, most recently active first. */
export async function GET() {
  try {
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("chat_sessions")
      .select("id,title,created_at,updated_at")
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

/** Start a new (empty) chat session. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("chat_sessions")
      .insert({ title: String(body.title ?? "New chat").slice(0, 120) || "New chat" })
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
