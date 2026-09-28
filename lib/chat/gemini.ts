import type { SlipsSnapshot } from "./snapshot";

/**
 * Server-only Gemini client. The API key lives in GEMINI_API_KEY (server env),
 * never in the browser bundle. Falls back across verified models,
 * returning null if none respond.
 */

const ACTIVE_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

export type ChatHistoryMessage = { sender: "user" | "ai"; text: string };

function buildSystemInstruction(snapshot: SlipsSnapshot): string {
  return [
    `You are the Slips AI assistant for ${snapshot.chapterName}, a BNI chapter.`,
    "You answer questions about the chapter's slips data: members, referrals given/received (inside/outside chapter), one-to-one meetings (121s), visitors invited, and TYFCB (Thank You For Closed Business) amounts.",
    "Field meanings: referralsGiven = referrals this member gave to others; referralsReceived = referrals given to them; referralsInside/Outside = split of given referrals; oneToOnes = 121 meetings participated in; tyfcbTotal = TYFCB amount where this member was THANKED (the business/revenue went to the thanker, who is usually anonymous — only the To member is named in the file); visitorsInvited = prospects they brought.",
    "",
    "---LIVE DATA SNAPSHOT---",
    JSON.stringify(snapshot),
    "",
    "CRITICAL RULES:",
    "1. DATA PRIMACY: take every name, count and amount ONLY from the snapshot above. NEVER invent members or numbers.",
    "2. If the data doesn't contain the answer, say so plainly.",
    "3. Never output UUIDs or internal IDs.",
    "4. Format with short paragraphs and simple lists. Keep answers concise.",
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
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

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

  for (const model of ACTIVE_GEMINI_MODELS) {
    try {
      // Key travels in the header only -- never in the URL (server logs).
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined;
      if (text && text.trim()) return text.replace(/\*\*/g, "*").trim();
    } catch {
      continue;
    }
  }

  return null;
}
