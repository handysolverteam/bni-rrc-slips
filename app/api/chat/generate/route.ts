import { getCachedSlipsSnapshot } from "@/lib/chat/snapshot-cache";
import { askGemini, type ChatHistoryMessage } from "@/lib/chat/gemini";

/** Per-request message cap (DoS + LLM cost guard). */
const MAX_CHAT_MESSAGE_LENGTH = 2000;

/** Gemini + snapshot can exceed the default serverless timeout. */
export const maxDuration = 60;

/**
 * Chat generate endpoint. Builds a live snapshot of the slips database
 * server-side and asks Gemini (server key). Replies with generated text only.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    message?: string;
    history?: ChatHistoryMessage[];
    sessionId?: string;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "Missing message." }, { status: 400 });
  }
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    return Response.json({ error: "Message is too long." }, { status: 400 });
  }

  try {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      return Response.json(
        { error: "GEMINI_API_KEY is not configured on the server." },
        { status: 500 },
      );
    }

    const snapshot = await getCachedSlipsSnapshot();
    const text = await askGemini(message, snapshot, body.history ?? []);

    if (!text || !text.trim()) {
      return Response.json(
        { error: "The AI did not respond. Please try again in a moment." },
        { status: 502 },
      );
    }

    if (body.sessionId) {
      await persistChatTurn(body.sessionId, message, text).catch(() => {});
    }

    return Response.json({ text, source: "gemini", sessionId: body.sessionId ?? null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to generate a reply." },
      { status: 500 },
    );
  }
}

/**
 * Best-effort persistence: stores both sides of the turn and bumps the
 * session. A still-untitled session takes its title from the first question.
 * Failures never break the reply (already generated).
 */
async function persistChatTurn(sessionId: string, userText: string, aiText: string) {
  const { getSupabaseServer } = await import("@/lib/supabase/server");
  const sb = getSupabaseServer();

  const { data: session } = await sb
    .from("chat_sessions")
    .select("id,title")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return;

  await sb.from("chat_messages").insert([
    { session_id: sessionId, sender: "user", text: userText },
    { session_id: sessionId, sender: "ai", text: aiText },
  ]);

  const updates: Record<string, string> = { updated_at: new Date().toISOString() };
  if (!session.title || session.title === "New chat") {
    updates.title = userText.slice(0, 60);
  }
  await sb.from("chat_sessions").update(updates).eq("id", sessionId);
}
