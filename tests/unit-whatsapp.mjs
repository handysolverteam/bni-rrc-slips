// Unit: WhatsApp share helpers (lib/whatsapp.ts) — pure URL/transcript logic,
// no server and no Gemini needed.
//
// Run:  node tests/unit-whatsapp.mjs   (from the repo root)
// Node >= 22.18 strips the TypeScript types itself, so the actual module under
// test is imported directly — no transpiler and no duplicated implementation.
import { buildChatShare, whatsappShareUrl, SHARE_MAX_CHARS } from "../lib/whatsapp.ts";

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
  buildChatShare([greeting]).text === "",
  JSON.stringify(buildChatShare([greeting]).text.slice(0, 40)),
);

// 3) Transcript labels + greeting skipped + header from the chat title.
const thread = [greeting, you("How many visitors last week?"), bot("11 visitors were invited last week.")];
const full = buildChatShare(thread, "Visitors question");
check(
  "transcript: title header, You:/Slips AI:, no greeting",
  full.text.startsWith("Visitors question\n\n") &&
    full.text.includes("You: How many visitors last week?") &&
    full.text.includes("Slips AI: 11 visitors were invited last week.") &&
    !full.text.includes("Hi! I'm your Slips AI"),
  JSON.stringify(full.text),
);
check("no truncation reported for a short chat", full.total === 2 && full.included === 2, `total=${full.total} included=${full.included}`);

// 4) "New chat" is a placeholder, not a useful heading.
check(
  "placeholder title is dropped",
  !buildChatShare([you("q")], "New chat").text.startsWith("New chat"),
  JSON.stringify(buildChatShare([you("q")], "New chat").text.slice(0, 30)),
);

// 5) Attachments travel as a readable [file: …] line.
const withFile = buildChatShare([{ sender: "user", text: "Check this", attachments: [{ name: "report.xlsx" }] }]);
check(
  "attachment names are included",
  withFile.text.includes("You: Check this") && withFile.text.includes("[file: report.xlsx]"),
  JSON.stringify(withFile.text),
);

// 6) An empty-text message that is only an attachment still renders.
const onlyFile = buildChatShare([{ sender: "user", text: "   ", attachments: [{ name: "a.csv" }] }]);
check(
  "file-only message renders",
  onlyFile.text.includes("[file: a.csv]") && !onlyFile.text.includes("(empty)"),
  JSON.stringify(onlyFile.text),
);

// 7) REGRESSION: a realistic long chat (12 exchanges, ~600-char answers) is
//    shared WHOLE — the old 6 000-char budget silently cut these in half.
const realistic = Array.from({ length: 24 }, (_, i) =>
  i % 2 === 0
    ? you(`question ${i} about the chapter's slips ${"q".repeat(150)}`)
    : bot(`answer ${i} with the numbers you asked for ${"a".repeat(400)}`),
);
const wholeChat = buildChatShare(realistic, "Long real chat");
check(
  "realistic 24-message chat is shared whole",
  wholeChat.included === wholeChat.total &&
    wholeChat.text.includes("question 0 ") &&
    wholeChat.text.includes("answer 23 ") &&
    !wholeChat.text.includes("(Earlier messages omitted)"),
  `len=${wholeChat.text.length} total=${wholeChat.total} included=${wholeChat.included} budget=${SHARE_MAX_CHARS}`,
);

// 8) Only a transcript past the budget drops turns — oldest first, newest kept,
//    with an explicit note and an honest included/total count for the UI.
const huge = Array.from({ length: 120 }, (_, i) =>
  i % 2 === 0 ? you(`question ${i} ${"q".repeat(300)}`) : bot(`answer ${i} ${"a".repeat(300)}`),
);
const cut = buildChatShare(huge, "Very long chat");
check(
  "over budget: oldest turns dropped, newest kept, counts honest",
  cut.text.includes("(Earlier messages omitted)") &&
    cut.text.includes("answer 119") &&
    !cut.text.includes("question 0 ") &&
    cut.included < cut.total &&
    cut.text.length <= SHARE_MAX_CHARS + 40,
  `len=${cut.text.length} total=${cut.total} included=${cut.included} budget=${SHARE_MAX_CHARS}`,
);

// 9) A single oversized turn is shared whole rather than cut mid-sentence.
const one = buildChatShare([bot("z".repeat(SHARE_MAX_CHARS + 500))]);
check(
  "one huge turn is never cut",
  one.text.endsWith("z".repeat(SHARE_MAX_CHARS + 500)) &&
    !one.text.includes("(Earlier messages omitted)") &&
    one.included === one.total,
  `len=${one.text.length}`,
);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);