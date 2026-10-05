import type { SlipsSnapshot } from "./snapshot";
import { CHAPTER_QUERY_TOOL, executeChapterQuery, type QueryIndex } from "./query-index";

/**
 * Server-only Gemini client. The API key lives in GEMINI_API_KEY (server env),
 * never in the browser bundle. Falls back across verified models and reports
 * the safe failure reason when none responds.
 */

const ACTIVE_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

/**
 * Per-attempt budget. A production-sized prompt (~20k tokens) with the answer
 * budget below measured ~12.7s end to end, so 15s left too little room — a
 * timeout there falls through to a weaker fallback model. 20s keeps all three
 * fallbacks inside the route's `maxDuration = 60` (3 × 20s).
 */
const MODEL_ATTEMPT_TIMEOUT_MS = 20_000;

export type ChatHistoryMessage = { sender: "user" | "ai"; text: string };

export type GeminiResult = {
  text: string | null;
  detail?: string;
  /** Follow-up questions stripped from the reply (see extractSuggestions). */
  suggestions?: string[];
};

/**
 * One chat attachment. `inline` payloads (images/PDF) go to Gemini as
 * inlineData parts; spreadsheets arrive as server-extracted capped text.
 */
export type ChatAttachment =
  | { name: string; kind: "inline"; mime: string; data: string }
  | { name: string; kind: "text"; text: string };

type GeminiResponsePart = {
  text?: unknown;
  thought?: unknown;
  functionCall?: { name?: unknown; args?: unknown } | null;
};
type GeminiResponseCandidate = {
  content?: { parts?: unknown };
  finishReason?: unknown;
};
type GeminiResponseBody = {
  candidates?: unknown;
  promptFeedback?: { blockReason?: unknown };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A requested tool call. `part` is the raw part object as received — it must
 * be echoed back VERBATIM in the follow-up model turn (Gemini 3.x rejects the
 * continuation with 400 "missing thought_signature" if we rebuild it from
 * name/args only).
 */
export type ToolCall = { name: string; args: unknown; part: unknown };

/**
 * Thinking models can return thought parts alongside (or before) the final
 * answer. Only non-thought parts count — a reply is either answer text,
 * functionCall requests (chapter_query), or neither (with a note why).
 */
function analyzeReply(data: unknown): {
  text: string | null;
  calls: ToolCall[];
  note?: string;
  truncated?: boolean;
} {
  const body = asRecord(data);
  const candidates = body ? body.candidates : undefined;
  const candidate = asRecord(Array.isArray(candidates) ? candidates[0] : undefined);
  const parts = asRecord(candidate ? candidate.content : undefined)?.parts;
  const finishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : "";

  if (!Array.isArray(parts)) {
    const blockReason = asRecord(body ? body.promptFeedback : undefined)?.blockReason;
    return {
      text: null,
      calls: [],
      note:
        typeof blockReason === "string" && blockReason
          ? `blocked (${blockReason})`
          : "missing candidates/content/parts",
    };
  }

  const answers: string[] = [];
  const calls: ToolCall[] = [];
  let thoughtOnly = false;
  for (const part of parts as GeminiResponsePart[]) {
    if (!part) continue;
    if (part.thought === true) {
      if (typeof part.text === "string" && part.text.trim()) thoughtOnly = true;
      continue;
    }
    if (typeof part.text === "string" && part.text.trim()) answers.push(part.text.trim());
    const fc = asRecord(part.functionCall);
    if (fc && typeof fc.name === "string" && fc.name) {
      calls.push({ name: fc.name, args: fc.args ?? {}, part });
    }
  }
  if (answers.length > 0) {
    return {
      text: answers.join("\n\n").replace(/\*\*/g, "").trim(),
      calls,
      // MAX_TOKENS = the model ran out of budget mid-answer; tell the caller
      // so a partial list is never presented as complete.
      truncated: finishReason === "MAX_TOKENS",
    };
  }
  if (calls.length > 0) return { text: null, calls };

  if (thoughtOnly) return { text: null, calls: [], note: "thought parts only" };
  return {
    text: null,
    calls: [],
    note: finishReason ? `empty (${finishReason})` : "empty response",
  };
}

const SUGGESTIONS_HEADER = "SUGGESTIONS:";
const SUGGESTION_MAX_LEN = 120;
const MAX_SUGGESTIONS = 5;

/**
 * The model appends a `SUGGESTIONS:` block of follow-up questions (system
 * rule 7) so the chat can offer chips that match the current thread. Strip it
 * out of the answer and hand it back separately — the visible reply must not
 * show it. The block is only accepted when it runs to the end of the reply
 * and every non-blank line in it is a question: anything off-format keeps the
 * answer byte-for-byte as written, so no answer content can ever be swallowed
 * by a malformed tail (the client then just falls back to its starter chips).
 * `|` and `]` are removed because the marker form `[suggestions: q1 | q2]` is
 * parsed by the client's non-bracket regex.
 */
function extractSuggestions(raw: string): { text: string; suggestions: string[] } {
  const at = raw.lastIndexOf(SUGGESTIONS_HEADER);
  if (at < 0) return { text: raw, suggestions: [] };
  const suggestions: string[] = [];
  for (const line of raw.slice(at + SUGGESTIONS_HEADER.length).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const q = trimmed
      .replace(/^[\s\-•*0-9.)"'`]+/, "")
      .replace(/[\]\|]/g, "")
      .trim();
    if (!q) continue; // blank / marker-only line (e.g. the closing `**` of a bold header)
    if (!q.endsWith("?") || q.length > SUGGESTION_MAX_LEN) return { text: raw, suggestions: [] };
    if (suggestions.length < MAX_SUGGESTIONS) suggestions.push(q);
  }
  if (suggestions.length === 0) return { text: raw, suggestions: [] };
  return { text: raw.slice(0, at).replace(/\s+$/, ""), suggestions };
}

function buildSystemInstruction(snapshot: SlipsSnapshot): string {
  return [
    `You are the Slips AI assistant for ${snapshot.chapterName}, a BNI chapter.`,
    "You answer questions about the chapter's slips data: members, referrals given/received (inside/outside chapter), one-to-one meetings (121s), visitors invited, and TYFCB (Thank You For Contributing Business) amounts.",
    "members[] = ALL-TIME per-member totals since records began. Field meanings: chapter = the member's BNI chapter (blank Detail in the source file means the home chapter); referralsGiven = referrals this member gave to others; referralsReceived = referrals given to them; referralsInside/Outside = split of given referrals; oneToOnes = 121 meetings participated in; tyfcbTotal = TYFCB amount where this member was THANKED (the business/revenue went to the thanker, who is usually anonymous — only the To member is named in the file); visitorsInvited = prospects they brought; invitedVisitors = names of those prospects (answer name questions from this list).",
    "weekly[] = one entry per BNI meeting week, NEWEST FIRST (weekly[0] is the latest week). Each entry: label and meetingDate identify the meeting; referrals / referralsInside / referralsOutside = referrals given in that week (inside = to this chapter, outside = to another chapter); oneToOnes = that week's 121 count weighted like the report (two home members = 2, other-chapter side = 1); visitors = visitors invited that week; tyfcbEntries / tyfcbAmount = TYFCB count and amount that week; uniqueReferralGivers / uniqueReferralReceivers / uniqueTyfcbReceivers = distinct member counts for that week.",
    "Date questions: to answer things like '30 September meet', 'week of 30/09/2026' or a specific meeting date, match the date against weekly[] entries' meetingDate or label and answer ONLY from the matching entry. For 'this week', 'latest week' or 'give for latest week' use latestWithDataLabel (the newest week that actually has slips) — weekly[0] can be an upcoming week with no slips yet; if a matched week has all zeros, say that meeting has no slips yet and use latestWithDataLabel instead. recentWeeks lists the latest 12 week labels. If nothing matches the date, say which weeks exist (the nearest two or three) instead of guessing.",
    "MEMBER-LEVEL AND SCOPED QUESTIONS: use the chapter_query TOOL — it answers from the full member × week index for ANY scope (one meeting week, a month, a date range, the latest week, all-time) with optional member filters, metric selection, sorting and a row limit. Call it for every 'who did X' question with a time scope, every top-N/ranking over a period, every unique-count question for a period, inside/outside per-member splits, and any question naming members together with a scope. Answer ONLY from the tool result: scope (matched week labels; when nothing matched it includes unmatched + hint with the nearest weeks — relay that and ask which week they meant), rowCount (members matching before the row limit), distinct (unique givers/receivers/participants/tyfcb receivers counts), totals (sums), rows (per-member values, limited by topN). Use members[] only for plain all-time facts and weekly[] for whole-chapter week totals so simple questions stay fast. NEVER say data is unavailable, not possible, or 'not available in this snapshot' for a data question — first try chapter_query; only if every attempt genuinely fails, say the query could not be completed and suggest a simpler wording.",
    "ATTACHMENTS: the latest user turn may include image/PDF inline parts and/or extracted spreadsheet text parts. Answer faithfully from what an attachment actually shows — describe images/PDFs precisely; answer spreadsheet questions from the extracted text (it is capped, so say so if asked beyond it). When a question mixes an attachment with chapter slips data, use both. Never claim an attachment is missing when one was provided, and never invent attachment contents.",
    "",
    "---LIVE DATA SNAPSHOT---",
    JSON.stringify(snapshot),
    "",
    "CRITICAL RULES:",
    "1. DATA PRIMACY: take every name, count and amount ONLY from the snapshot above or a chapter_query tool result. NEVER invent members or numbers.",
    "2. If the data doesn't contain the answer, say so plainly.",
    "3. Never output UUIDs, internal IDs, or raw field names like visitorsInvited — always phrase values in plain words.",
    "4. Refer to each member by their exact snapshot name, with no parenthetical annotations.",
    "5. Format with short paragraphs and simple lists. Keep answers concise. Do not use asterisks for emphasis — plain text only, especially for member and chapter names.",
    "6. Always end with one relevant follow-up question.",
    `7. AFTER that question, as the very last lines of your reply, output a suggestions block: the line ${SUGGESTIONS_HEADER} and then 4 short follow-up questions, one per line, each ending with "?", with no bullets or numbering and each under ${SUGGESTION_MAX_LEN} characters. They are the questions a member is most likely to ask NEXT, grounded in the answer you just gave and in the snapshot (deeper or adjacent facts, not the follow-up question from rule 6 and not anything you already answered).`,
    "",
    "PREVIOUS CONVERSATION:",
  ].join("\n");
}

function formatHistory(history: ChatHistoryMessage[]): string {
  return (history ?? [])
    .slice(-10)
    .map((m) => `${m.sender === "user" ? "Member" : "Slips AI"}: ${String(m.text ?? "").slice(0, 1500)}`)
    .join("\n");
}

/** A reply cut short by the output budget: the text is partial, so the
 *  caller must say so rather than let the user read a clipped list as the
 *  whole answer. */
const TRUNCATION_NOTICE =
  "\n\n[This answer was cut short by the length limit — it is incomplete. Ask me again for the rest.]";

type ModelAttempt =
  | { kind: "text"; text: string; truncated?: boolean }
  | { kind: "calls"; calls: ToolCall[] }
  | { kind: "error"; detail: string; status?: number };

/**
 * One generateContent request. With useTools the payload carries the
 * chapter_query declaration, so the model may answer in text OR ask for data.
 * Failure details intentionally contain only model names, HTTP statuses and
 * response-shape notes — never the API key or upstream body.
 */
async function callModel(
  model: string,
  contents: unknown[],
  useTools: boolean,
  apiKey: string,
  temperature: number,
): Promise<ModelAttempt> {
  try {
    // Key travels in the header only -- never in the URL (server logs).
    // Keep each attempt short so all fallbacks fit the serverless budget.
    //
    // Budget numbers are measured, not guessed (see docs/SYSTEM.md). Thinking
    // tokens share the output budget, so the old 2048 cap let reasoning spend
    // ~1970 tokens and cut the answer off mid-list (finishReason MAX_TOKENS):
    // the model then promised N names and delivered far fewer. 4096 gives the
    // answer room, and the 512 thinking cap keeps a production-sized prompt
    // (~20k tokens) near 5s instead of ~11s — well inside the 15s per-attempt
    // timeout that the 3 tool rounds also have to fit into.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 512 },
        temperature,
      },
    };
    if (useTools) payload.tools = [{ functionDeclarations: [CHAPTER_QUERY_TOOL] }];
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MODEL_ATTEMPT_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "error", detail: `HTTP ${response.status}`, status: response.status };
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { kind: "error", detail: "invalid JSON" };
    }
    const reply = analyzeReply(data);
    if (reply.calls.length > 0) return { kind: "calls", calls: reply.calls };
    if (reply.text) return { kind: "text", text: reply.text, truncated: reply.truncated };
    return { kind: "error", detail: reply.note ?? "empty response" };
  } catch (error) {
    return {
      kind: "error",
      detail:
        error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error",
    };
  }
}

function executeToolCall(call: { name: string; args: unknown }, index: QueryIndex): unknown {
  if (call.name !== CHAPTER_QUERY_TOOL.name) {
    return { error: `Unknown tool: ${call.name}` };
  }
  try {
    return executeChapterQuery(call.args, index);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "query failed" };
  }
}

/**
 * Ask Gemini, allowing up to 3 rounds of chapter_query tool calls: the model
 * requests scoped member-level data, we execute it server-side against the
 * index (never in the prompt), feed the JSON back, and the model composes the
 * final answer. Falls back across models per round; a model that rejects the
 * tools payload is retried once without tools.
 */
export async function askGemini(
  prompt: string,
  snapshot: SlipsSnapshot,
  index: QueryIndex,
  history: ChatHistoryMessage[] = [],
  attachments: ChatAttachment[] = [],
  temperature = 0.2,
): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { text: null, detail: "missing GEMINI_API_KEY" };

  const attachmentParts: unknown[] = [];
  for (const a of attachments) {
    if (a.kind === "inline") {
      attachmentParts.push({ inlineData: { mimeType: a.mime, data: a.data } });
    } else {
      attachmentParts.push({
        text: `ATTACHED SPREADSHEET "${a.name}" (extracted to text):\n${a.text}`,
      });
    }
  }
  const attachmentNote =
    attachments.length > 0
      ? `\n\nFILE ATTACHMENTS IN THIS TURN: ${attachments.map((a) => a.name).join(", ")}`
      : "";

  const combinedPrompt = [
    buildSystemInstruction(snapshot),
    formatHistory(history) || "None",
    "",
    `LATEST MEMBER QUESTION: ${prompt || "(the user sent files without a question — summarize or ask what they want to know)"}`,
    attachmentNote,
  ].join("\n");

  const contents: unknown[] = [
    { role: "user", parts: [{ text: combinedPrompt }, ...attachmentParts] },
  ];
  const failures: string[] = [];
  const toolsBroken = new Set<string>();

  for (let round = 0; round < 3; round++) {
    let calls: ToolCall[] | null = null;
    for (const model of ACTIVE_GEMINI_MODELS) {
      const useTools = !toolsBroken.has(model);
      let attempt = await callModel(model, contents, useTools, apiKey, temperature);
      if (attempt.kind === "error" && attempt.status === 400 && useTools) {
        // This model's endpoint rejects the tools payload — continue without it.
        toolsBroken.add(model);
        attempt = await callModel(model, contents, false, apiKey, temperature);
      }
      if (attempt.kind === "text") {
        // A clipped answer stays usable, but the user (and the next turn's
        // history) must know it is incomplete instead of guessing "display
        // truncation" and confabulating a reason for it. The suggestions block
        // is parsed first so the notice appended here never lands inside it.
        const { text: answer, suggestions } = extractSuggestions(attempt.text);
        return {
          text: attempt.truncated ? answer + TRUNCATION_NOTICE : answer,
          suggestions,
        };
      }
      if (attempt.kind === "calls") {
        calls = attempt.calls;
        break;
      }
      failures.push(`${model}: ${attempt.detail}`);
    }
    if (!calls) break; // no model answered with text or calls this round

    // Execute every requested call and hand the results back for the next round.
    // The model turn echoes each raw part verbatim (thoughtSignature included).
    const modelParts = calls.map((c) => c.part);
    const responseParts = calls.map((c) => ({
      functionResponse: { name: c.name, response: { json: executeToolCall(c, index) } },
    }));
    contents.push({ role: "model", parts: modelParts });
    contents.push({ role: "user", parts: responseParts });
  }

  return { text: null, detail: failures.join("; ") || "no Gemini model attempted" };
}
