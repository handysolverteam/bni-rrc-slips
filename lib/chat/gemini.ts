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

export type ChatHistoryMessage = { sender: "user" | "ai"; text: string };

export type GeminiResult = { text: string | null; detail?: string };

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
} {
  const body = asRecord(data);
  const candidates = body ? body.candidates : undefined;
  const candidate = asRecord(Array.isArray(candidates) ? candidates[0] : undefined);
  const parts = asRecord(candidate ? candidate.content : undefined)?.parts;

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
    return { text: answers.join("\n\n").replace(/\*\*/g, "").trim(), calls };
  }
  if (calls.length > 0) return { text: null, calls };

  const finishReason = candidate?.finishReason;
  if (thoughtOnly) return { text: null, calls: [], note: "thought parts only" };
  return {
    text: null,
    calls: [],
    note: typeof finishReason === "string" && finishReason ? `empty (${finishReason})` : "empty response",
  };
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

type ModelAttempt =
  | { kind: "text"; text: string }
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: 2048, temperature },
    };
    if (useTools) payload.tools = [{ functionDeclarations: [CHAPTER_QUERY_TOOL] }];
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
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
    if (reply.text) return { kind: "text", text: reply.text };
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
      if (attempt.kind === "text") return { text: attempt.text };
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
