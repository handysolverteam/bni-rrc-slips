"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type Msg = { sender: "user" | "ai"; text: string };

const GREETING: Msg = {
  sender: "ai",
  text: "Hi! I'm your Slips AI. Ask me anything about referrals, one-to-ones, visitors, TYFCB, or members.",
};

const SUGGESTIONS = [
  "Who gave the most referrals?",
  "Who received the most referrals?",
  "Top 5 members by TYFCB amount?",
  "How many visitors were invited, and by whom?",
  "Who did the most one-to-ones?",
];

export default function ChatBox({
  sessionId,
  onSessionCreated,
  onActivity,
}: {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
  onActivity: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [loadingHistory, setLoadingHistory] = useState(!!sessionId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Set when THIS box created its session: the sessionId prop change that
  // follows must not trigger a history reload (it would wipe the reply
  // currently being generated).
  const justCreated = useRef(false);

  // Load persisted history when switching sessions.
  useEffect(() => {
    if (!sessionId) {
      setMessages([GREETING]);
      return;
    }
    if (justCreated.current) {
      justCreated.current = false;
      return;
    }
    setLoadingHistory(true);
    fetch(`/api/chat/sessions/${sessionId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        const loaded: Msg[] = Array.isArray(data.messages)
          ? data.messages.map((m: { sender: string; text: string }) => ({
              sender: m.sender === "user" ? ("user" as const) : ("ai" as const),
              text: m.text,
            }))
          : [];
        setMessages(loaded.length > 0 ? loaded : [GREETING]);
      })
      .catch(() => setMessages([GREETING]))
      .finally(() => setLoadingHistory(false));
  }, [sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);

    // Lazy session: created on first message so empty chats never clutter history.
    let sid = sessionId;
    if (!sid) {
      try {
        const res = await fetch("/api/chat/sessions", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.session?.id) throw new Error(data.error ?? "Could not start chat.");
        sid = data.session.id as string;
        justCreated.current = true;
        onSessionCreated(sid);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start chat.");
        setBusy(false);
        return;
      }
    }

    const next = [...messages.filter((m) => m !== GREETING || messages.length > 1), { sender: "user" as const, text: clean }];
    setMessages(next);
    setInput("");

    try {
      const res = await fetch("/api/chat/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          sessionId: sid,
          history: next.slice(-10).map((m) => ({ sender: m.sender, text: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setMessages((current) => [...current, { sender: "ai" as const, text: data.text }]);
        onActivity();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  async function clearChat() {
    if (!sessionId || busy) return;
    setConfirmingClear(false);
    setError(null);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Clear failed.");
      setMessages([GREETING]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed.");
    }
  }

  return (
    <div className="chat-wrap">
      <div className="chat-toolbar">
        <span className="muted">{loadingHistory ? "Loading history…" : `${messages.length} message(s)`}</span>
        {sessionId ? (
          <button type="button" onClick={() => setConfirmingClear(true)} disabled={busy}>
            Clear chat
          </button>
        ) : null}
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.sender}`}>
            <div className="chat-bubble">{m.text}</div>
          </div>
        ))}
        {busy ? (
          <div className="chat-msg ai">
            <div className="chat-bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="chat-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="chat-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Shift+Enter = newline (Teams-style); IME confirm Enter must
            // not send.
            if (e.nativeEvent.isComposing) return;
            if (e.shiftKey) return;
            e.preventDefault();
            send(input);
          }}
          placeholder="Ask about referrals, TYFCB, visitors…"
          maxLength={2000}
          rows={1}
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </form>

      {confirmingClear ? (
        <ConfirmDialog
          title="Clear this chat?"
          message="All messages in this chat will be removed. The chat itself stays in history."
          confirmLabel="Clear chat"
          danger
          busy={busy}
          onConfirm={clearChat}
          onCancel={() => setConfirmingClear(false)}
        />
      ) : null}
    </div>
  );
}
