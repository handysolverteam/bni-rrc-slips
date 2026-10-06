/**
 * Share a chat (or a single message) to WhatsApp with no backend: the text is
 * url-encoded into a `wa.me` link that opens WhatsApp with the message already
 * in the composer. The member picks the recipient and presses send there, so
 * the app itself never transmits or stores anything.
 */

/**
 * URL budget for one shared transcript. Sized so a REAL conversation is
 * always shared whole — the previous 6 000 cut off the oldest turns of a
 * normal chat, which read as "the share lost most of the conversation".
 * 20 000 characters is ~25+ exchanges (far past WhatsApp's own 65 536-char
 * message limit) and still well inside every browser's URL limit once the
 * percent-encoding is applied.
 */
export const SHARE_MAX_CHARS = 20_000;

/** One message as the chat holds it (markers already split off). */
export type ShareMessage = {
  sender: "user" | "ai";
  text: string;
  attachments?: { name: string }[];
};

/** `https://wa.me/?text=…` opens WhatsApp prefilled; no phone number means
 *  the share/contact picker rather than a fixed chat. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** What a chat share will actually send. `included < total` means older turns
 *  had to be dropped for the URL budget — the UI says so BEFORE sharing
 *  instead of leaving a note at the top of the message. */
export type ChatShare = { text: string; total: number; included: number };

/** The bot's opening line (GREETING in components/ChatBox.tsx) — it appears in
 *  every chat and says nothing about this conversation, so a shared transcript
 *  starts at the first real question. */
const GREETING_PREFIX = "Hi! I'm your Slips AI.";

function renderTurn(m: ShareMessage): string {
  const who = m.sender === "user" ? "You" : "Slips AI";
  const files = (m.attachments ?? []).map((a) => a.name).filter(Boolean);
  const body = m.text.trim() || (files.length > 0 ? "" : "(empty)");
  return [body ? `${who}: ${body}` : who + ":", files.length > 0 ? `[file: ${files.join(", ")}]` : ""]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Whole conversation as WhatsApp text: optional chat-title header, one
 * `You:` / `Slips AI:` block per turn. Only a transcript past
 * `SHARE_MAX_CHARS` loses anything, and then the OLDEST turns go (the newest
 * answer is the point of the forward) behind an explicit
 * "(Earlier messages omitted)" note; a single oversized turn is kept whole
 * rather than cut mid-sentence. `text` is "" for a greeting-only chat.
 */
export function buildChatShare(messages: ShareMessage[], title = ""): ChatShare {
  const turns = messages
    .filter((m) => !(m.sender === "ai" && m.text.trim().startsWith(GREETING_PREFIX)))
    .map(renderTurn);
  if (turns.length === 0) return { text: "", total: 0, included: 0 };

  const heading = title.trim();
  const header = heading && heading !== "New chat" ? `${heading}\n\n` : "";
  const full = header + turns.join("\n\n");
  if (full.length <= SHARE_MAX_CHARS) return { text: full, total: turns.length, included: turns.length };

  const note = "(Earlier messages omitted)\n\n";
  const fits = (lines: string[]) => (header + note + lines.join("\n\n")).length <= SHARE_MAX_CHARS;
  let first = 0;
  while (first < turns.length - 1 && !fits(turns.slice(first))) first += 1;
  // first === 0 → nothing could be dropped (one oversized turn): share it as
  // written instead of claiming turns were omitted.
  if (first === 0) return { text: full, total: turns.length, included: turns.length };
  return {
    text: header + note + turns.slice(first).join("\n\n"),
    total: turns.length,
    included: turns.length - first,
  };
}