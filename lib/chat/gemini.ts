import type { SlipsSnapshot } from "./snapshot";

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

type GeminiResponsePart = { text?: unknown; thought?: unknown };
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
 * Thinking models can return thought parts alongside (or before) the final
 * answer. Only non-thought text is user-facing; thought text is never shown.
 */
function extractAnswerText(data: unknown): { text: string | null; note?: string } {
  const body = asRecord(data);
  const candidates = body ? body.candidates : undefined;
  const candidate = asRecord(Array.isArray(candidates) ? candidates[0] : undefined);
  const parts = asRecord(candidate ? candidate.content : undefined)?.parts;

  if (!Array.isArray(parts)) {
    const blockReason = asRecord(body ? body.promptFeedback : undefined)?.blockReason;
    return {
      text: null,
      note:
        typeof blockReason === "string" && blockReason
          ? `blocked (${blockReason})`
          : "missing candidates/content/parts",
    };
  }

  const answers = (parts as GeminiResponsePart[])
    .filter(
      (part) =>
        !!part &&
        typeof part.text === "string" &&
        part.text.trim() &&
        part.thought !== true,
    )
    .map((part) => (part.text as string).trim());
  if (answers.length > 0) {
    return { text: answers.join("\n\n").replace(/\*\*/g, "").trim() };
  }

  const thoughtOnly = (parts as GeminiResponsePart[]).some(
    (part) => !!part && typeof part.text === "string" && part.text.trim() && part.thought === true,
  );
  const finishReason = candidate?.finishReason;
  if (thoughtOnly) return { text: null, note: "thought parts only" };
  return {
    text: null,
    note: typeof finishReason === "string" && finishReason ? `empty (${finishReason})` : "empty response",
  };
}

function buildSystemInstruction(snapshot: SlipsSnapshot): string {
  return [
    `You are the Slips AI assistant for ${snapshot.chapterName}, a BNI chapter.`,
    "You answer questions about the chapter's slips data: members, referrals given/received (inside/outside chapter), one-to-one meetings (121s), visitors invited, and TYFCB (Thank You For Contributing Business) amounts.",
        "Field meanings: chapter = the member's BNI chapter (blank Detail in the source file means the home chapter); referralsGiven = referrals this member gave to others; referralsReceived = referrals given to them; referralsInside/Outside = split of given referrals; oneToOnes = 121 meetings participated in; tyfcbTotal = TYFCB amount where this member was THANKED (the business/revenue went to the thanker, who is usually anonymous — only the To member is named in the file); visitorsInvited = prospects they brought; invitedVisitors = names of those prospects (answer name questions from this list).",
    "",
    "---LIVE DATA SNAPSHOT---",
    JSON.stringify(snapshot),
    "",
    "CRITICAL RULES:",
    "1. DATA PRIMACY: take every name, count and amount ONLY from the snapshot above. NEVER invent members or numbers.",
    "2. If the data doesn't contain the answer, say so plainly.",
    "3. Never output UUIDs, internal IDs, or raw field names like visitorsInvited — always phrase values in plain words.",
    "4. Refer to each member by their exact snapshot name, with no parenthetical annotations.",
    "5. Format with short paragraphs and simple lists. Keep answers concise. Do not use asterisks for emphasis — plain text only, especially for member and chapter names.",
    "5. Always end with one relevant follow-up question.",
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

export async function askGemini(
  prompt: string,
  snapshot: SlipsSnapshot,
  history: ChatHistoryMessage[] = [],
  temperature = 0.2,
): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { text: null, detail: "missing GEMINI_API_KEY" };

  const combinedPrompt = [
    buildSystemInstruction(snapshot),
    formatHistory(history) || "None",
    "",
    `LATEST MEMBER QUESTION: ${prompt}`,
  ].join("\n");

  const payload = {
    contents: [{ role: "user", parts: [{ text: combinedPrompt }] }],
    generationConfig: { maxOutputTokens: 2048, temperature },
  };

  // Failure details intentionally contain only model names, HTTP statuses and
  // response-shape notes — never the API key or upstream body.
  const failures: string[] = [];
  for (const model of ACTIVE_GEMINI_MODELS) {
    try {
      // Key travels in the header only -- never in the URL (server logs).
      // Keep each attempt short so all fallbacks fit the serverless budget.
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        failures.push(`${model}: HTTP ${response.status}`);
        continue;
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        failures.push(`${model}: invalid JSON`);
        continue;
      }
      const extracted = extractAnswerText(data);
      if (extracted.text) return { text: extracted.text };
      failures.push(`${model}: ${extracted.note ?? "empty response"}`);
    } catch (error) {
      failures.push(
        `${model}: ${error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error"}`,
      );
    }
  }

  return { text: null, detail: failures.join("; ") || "no Gemini model attempted" };
}
