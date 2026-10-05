// Unit: WhatsApp share helpers (lib/whatsapp.ts) — pure URL/transcript logic,
// no server and no Gemini needed.
//
// Run:  node tests/unit-whatsapp.mjs   (from the repo root)
// Node >= 22.18 strips the TypeScript types itself, so the actual module under
// test is imported directly — no transpiler and no duplicated implementation.
import { formatChatTranscript, whatsappShareUrl, SHARE_MAX_CHARS } from "../lib/whatsapp.ts";

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);

const greeting = { sender: "ai", text: "Hi! I'm your Slips AI. Ask me anything about referrals, one-to-ones, visitors, TYFCB, or members." };
const you = (text) => ({ sender: "user", text });
const bot = (text) => ({ sender: "ai", text });

// 1) URL building — the text must be url-encoded (spaces, &, ?, non-ASCII).
check(
  "share link encodes the text",
  whatsappShareUrl("Who gave the most & best?") ===
    `https://wa.me/?text=${encodeURIComponent("Who gave the most & best?")}` &&
    whatsappShareUrl("a b").includes("a%20b") &&
    whatsappShareUrl("x").startsWith("https://wa.me/?text="),
  whatsappShareUrl("Who gave the most & best?").slice(0, 60),
);

// 2) A greeting-only chat has nothing worth sending.
check(
  "greeting-only chat shares nothing",
  formatChatTranscript([greeting]) === "",
  JSON.stringify(formatChatTranscript([greeting]).slice(0, 40)),
);

// 3) Transcript labels + greeting skipped + header from the chat title.
const thread = [greeting, you("How many visitors last week?"), bot("11 visitors were invited last week.")];
const full = formatChatTranscript(thread, "Visitors question");
check(
  "transcript: title header, You:/Slips AI:, no greeting",
  full.startsWith("Visitors question\n\n") &&
    full.includes("You: How many visitors last week?") &&
    full.includes("Slips AI: 11 visitors were invited last week.") &&
    !full.includes("Hi! I'm your Slips AI"),
  JSON.stringify(full),
);

// 4) "New chat" is a placeholder, not a useful heading.
check(
  "placeholder title is dropped",
  !formatChatTranscript([you("q")], "New chat").startsWith("New chat"),
  JSON.stringify(formatChatTranscript([you("q")], "New chat").slice(0, 30)),
);

// 5) Attachments travel as a readable [file: …] line.
const withFile = formatChatTranscript([{ sender: "user", text: "Check this", attachments: [{ name: "report.xlsx" }] }]);
check(
  "attachment names are included",
  withFile.includes("You: Check this") && withFile.includes("[file: report.xlsx]"),
  JSON.stringify(withFile),
);

// 6) An empty-text message that is only an attachment still renders.
const onlyFile = formatChatTranscript([{ sender: "user", text: "   ", attachments: [{ name: "a.csv" }] }]);
check("file-only message renders", onlyFile.includes("[file: a.csv]") && !onlyFile.includes("(empty)"), JSON.stringify(onlyFile));

// 7) Long transcript: oldest turns are dropped behind an explicit note and the
//    newest turn (the answer being forwarded) stays intact.
const long = Array.from({ length: 40 }, (_, i) =>
  i % 2 === 0 ? you(`question number ${i} ${"x".repeat(380)}`) : bot(`answer number ${i} ${"y".repeat(380)}`),
);
const cut = formatChatTranscript(long, "Long chat");
check(
  "over budget: oldest turns dropped, newest kept",
  cut.includes("(Earlier messages omitted)") &&
    cut.includes(`answer number 39`) &&
    !cut.includes("question number 0 ") &&
    cut.length <= SHARE_MAX_CHARS + 60,
  `len=${cut.length} budget=${SHARE_MAX_CHARS}`,
);

// 8) A single oversized turn is shared whole rather than cut mid-sentence.
const huge = formatChatTranscript([bot("z".repeat(SHARE_MAX_CHARS + 500))]);
check(
  "one huge turn is never cut",
  huge.endsWith("z".repeat(SHARE_MAX_CHARS + 500)) && !huge.includes("(Earlier messages omitted)"),
  `len=${huge.length}`,
);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
