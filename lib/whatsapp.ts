/**
 * Share a chat (or a single message) to WhatsApp with no backend: the text is
 * url-encoded into a `wa.me` link that opens WhatsApp with the message already
 * in the composer. The member picks the recipient and presses send there, so
 * the app itself never transmits or stores anything.
 */

/** URL budget for one shared transcript — long enough for a normal chat,
 *  short enough that every browser and WhatsApp still accept the link. */
export const SHARE_MAX_CHARS = 6000;

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
 * `You:` / `Slips AI:` block per turn. Over `SHARE_MAX_CHARS` the OLDEST
 * turns are dropped (newest matter most for a forwarded answer) behind an
 * explicit "(Earlier messages omitted)" note; the newest turn is never cut,
 * so a single huge reply stays readable instead of ending mid-sentence.
 * Returns "" when there is nothing to share (greeting-only chat).
 */
export function formatChatTranscript(messages: ShareMessage[], title = ""): string {
  const turns = messages
    .filter((m) => !(m.sender === "ai" && m.text.trim().startsWith(GREETING_PREFIX)))
    .map(renderTurn);
  if (turns.length === 0) return "";

  const heading = title.trim();
  const header = heading && heading !== "New chat" ? `${heading}\n\n` : "";
  const join = (lines: string[]) => header + lines.join("\n\n");
  const full = join(turns);
  if (full.length <= SHARE_MAX_CHARS) return full;

  const note = "(Earlier messages omitted)\n\n";
  const fits = (lines: string[]) => (header + note + lines.join("\n\n")).length <= SHARE_MAX_CHARS;
  let first = 0;
  while (first < turns.length - 1 && !fits(turns.slice(first))) first += 1;
  // first === 0 → nothing could be dropped (one oversized turn): share it as
  // written instead of claiming turns were omitted.
  if (first === 0) return full;
  return header + note + turns.slice(first).join("\n\n");
}
