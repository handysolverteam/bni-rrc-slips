import { getCachedSlipsData } from "@/lib/chat/snapshot-cache";
import { askGemini, type ChatAttachment, type ChatHistoryMessage } from "@/lib/chat/gemini";
import { spreadsheetToText } from "@/lib/chat/attachment-text";
import { forbidden, getTenantContext, unauthorized } from "@/lib/server-auth";

/** Per-request message cap (DoS + LLM cost guard). */
const MAX_CHAT_MESSAGE_LENGTH = 2000;

/** Attachment caps — mirrored in components/ChatBox.tsx (client-side). */
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL = 8 * 1024 * 1024;
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};
const SPREADSHEET_EXTS = new Set(["xls", "xlsx", "csv"]);

/** Gemini + snapshot can exceed the default serverless timeout. */
export const maxDuration = 60;

/**
 * Chat generate endpoint. Builds a live snapshot of the slips database
 * server-side and asks Gemini (server key). Replies with generated text only.
 * Optional `attachments` (base64) are validated here: images/PDF pass through
 * to Gemini inline; spreadsheets are converted to capped text first.
 */
export async function POST(request: Request) {
  const ctx = await getTenantContext(request);
  if (!ctx) return unauthorized();
  if ("noAccess" in ctx) return forbidden();

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    history?: ChatHistoryMessage[];
    sessionId?: string;
    attachments?: { name?: string; mime?: string; data?: string }[];
    replyTo?: { sender?: string; text?: string };
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message = body.message?.trim() ?? "";
  const attachments = parseAttachments(body.attachments);
  if ("error" in attachments) {
    return Response.json({ error: attachments.error }, { status: 400 });
  }
  if (!message && attachments.value.length === 0) {
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

    const { snapshot, index } = await getCachedSlipsData(ctx.tenantId);
    const result = await askGemini(
      message + buildReplyContext(body.replyTo),
      snapshot,
      index,
      body.history ?? [],
      attachments.value,
    );

    if (!result.text || !result.text.trim()) {
      const detail = result.detail ? ` (${result.detail})` : "";
      console.error("Gemini generate failed", { detail: result.detail ?? "unknown" });
      return Response.json(
        { error: `The AI did not respond${detail}. Please try again in a moment.` },
        { status: 502 },
      );
    }
    const text = result.text;
    const suggestions = result.suggestions ?? [];
    // The suggestion chips must survive a reload/session switch, so they ride
    // along as a hidden marker on the AI row — the same mechanism as
    // [tagged:]/[attached:], split off for display by splitAttached().
    const suggestionMarker = suggestions.length
      ? `\n[suggestions: ${suggestions.join(" | ")}]`
      : "";

    if (body.sessionId) {
      // Persist the typed message plus [tagged: snippet] / [attached: name]
      // markers — the chat UI splits them back into the Tagged chip and file
      // chips when the history reloads.
      const tag = (() => {
        const raw =
          body.replyTo && typeof body.replyTo === "object" ? body.replyTo.text : "";
        const text = typeof raw === "string" ? raw.trim() : "";
        const snippet = text
          .replace(/\s+/g, " ")
          .replace(/\]/g, "")
          .trim()
          .slice(0, 60);
        return snippet ? `[tagged: ${snippet}]` : "";
      })();
      const storedText = [message, tag, ...attachments.value.map((a) => `[attached: ${a.name}]`)]
        .filter((part) => part.length > 0)
        .join("\n");
      // Best-effort only, but never silent: a failed save is logged so a
      // reply shown on screen can't vanish from history unnoticed. The
      // tenant scope means another chapter's sessionId writes nothing; the
      // owner scope (when the caller has a uid) means another user's
      // sessionId writes nothing either.
      await persistChatTurn(
        body.sessionId,
        ctx.tenantId,
        ctx.uid,
        storedText,
        text + suggestionMarker,
      ).catch((e) =>
        console.error("Chat history save failed", {
          sessionId: body.sessionId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }

    return Response.json({
      text,
      source: "gemini",
      sessionId: body.sessionId ?? null,
      suggestions,
    });
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
 * Failures never break the reply (already generated). Scoped by tenant AND,
 * when the caller has a uid, by owner (a foreign sessionId persists nothing).
 */
async function persistChatTurn(
  sessionId: string,
  tenantId: string,
  uid: string | null,
  userText: string,
  aiText: string,
) {
  const { getSupabaseServer } = await import("@/lib/supabase/server");
  const sb = getSupabaseServer();

  let sessionQuery = sb
    .from("chat_sessions")
    .select("id,title")
    .eq("id", sessionId)
    .eq("tenant_id", tenantId);
  if (uid) sessionQuery = sessionQuery.eq("owner_uid", uid);
  const { data: session } = await sessionQuery.maybeSingle();
  if (!session) return;

  await sb.from("chat_messages").insert([
    { session_id: sessionId, sender: "user", text: userText },
    { session_id: sessionId, sender: "ai", text: aiText },
  ]).then(({ error }) => {
    if (error) throw new Error(`chat_messages insert: ${error.message}`);
  });

  const updates: Record<string, string> = { updated_at: new Date().toISOString() };
  if (!session.title || session.title === "New chat") {
    // First non-marker line becomes the session title.
    const titleSource =
      userText.split("\n").find((l) => l && !l.startsWith("[attached:") && !l.startsWith("[tagged:")) ??
      userText;
    updates.title = titleSource.slice(0, 60);
  }
  await sb.from("chat_sessions").update(updates).eq("id", sessionId).then(({ error }) => {
    if (error) throw new Error(`chat_sessions update: ${error.message}`);
  });
}

/**
 * Validate + classify incoming attachments. Spreadsheets are converted to
 * capped text here (they cannot travel inline to Gemini); images/PDFs pass
 * through as base64 for inlineData parts. Any rejection returns { error }.
 */
function parseAttachments(
  incoming: unknown,
): { value: ChatAttachment[] } | { error: string } {
  if (incoming === undefined || incoming === null) return { value: [] };
  if (!Array.isArray(incoming)) return { error: "Invalid attachments." };
  if (incoming.length > MAX_ATTACHMENTS) {
    return { error: `You can attach up to ${MAX_ATTACHMENTS} files.` };
  }
  const allowed = Object.keys(EXT_MIME).join(", ");
  const value: ChatAttachment[] = [];
  let total = 0;
  for (const raw of incoming) {
    const a = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; data?: unknown };
    const name = typeof a.name === "string" ? a.name.trim().slice(0, 160) : "";
    const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
    const mime = EXT_MIME[ext];
    if (!name || !mime) {
      return { error: `Unsupported file: ${name || "unnamed"}. Allowed: ${allowed}.` };
    }
    const data = typeof a.data === "string" ? a.data.replace(/\s+/g, "") : "";
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return { error: `Corrupt file data: ${name}.` };
    }
    const bytes = Math.floor((data.length * 3) / 4);
    if (bytes > MAX_ATTACHMENT_BYTES) {
      return { error: `${name} is larger than 4MB.` };
    }
    total += bytes;
    if (total > MAX_ATTACHMENT_TOTAL) {
      return { error: "Attachments exceed 8MB in total." };
    }
    if (SPREADSHEET_EXTS.has(ext)) {
      let text: string;
      try {
        text = spreadsheetToText(name, data);
      } catch {
        return { error: `Could not read spreadsheet "${name}".` };
      }
      value.push({ name, kind: "text", text });
    } else {
      value.push({ name, kind: "inline", mime, data });
    }
  }
  return { value };
}

/**
 * The "Tagged …" bar: the tagged text is sent to Gemini as context for THIS
 * turn only — the stored message text stays clean (no quote markup).
 */
function buildReplyContext(raw: unknown): string {
  const r = (raw && typeof raw === "object" ? raw : {}) as { sender?: unknown; text?: unknown };
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH) : "";
  if (!text) return "";
  const who = r.sender === "ai" ? "your (the AI's) earlier response" : "their own earlier message";
  return `\n\nTAGGED MESSAGE — the user tagged ${who}:\n"""${text}"""`;
}
