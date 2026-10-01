"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type Attachment = { name: string; mime: string };
type TagRef = { text: string };
type Msg = {
  sender: "user" | "ai";
  text: string;
  createdAt?: string;
  attachments?: Attachment[];
  tag?: TagRef;
};
type PendingFile = { name: string; mime: string; data: string };

/** Client-side upload caps (base64 inflates ~4/3; server enforces the same). */
const FILE_MAX_BYTES = 4 * 1024 * 1024;
const FILE_TOTAL_BYTES = 8 * 1024 * 1024;
const FILE_MAX_COUNT = 3;
const FILE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "pdf", "xls", "xlsx", "csv"];
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", pdf: "application/pdf",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

/**
 * History rows are persisted as `text` + trailing markers (see the chat
 * generate route): `[attached: name]` chips and one `[tagged: snippet]` ref —
 * split them back into display data.
 */
function splitAttached(raw: string): {
  text: string;
  attachments: Attachment[];
  tag?: TagRef;
} {
  let text = raw;
  const attachments: Attachment[] = [];
  let tag: TagRef | undefined;
  for (;;) {
    const attached = /\n?\[attached: ([^\]\n]{1,160})\]$/.exec(text);
    if (attached) {
      attachments.unshift({ name: attached[1].trim(), mime: "" });
      text = text.slice(0, attached.index);
      continue;
    }
    const tagged = /\n?\[tagged: ([^\]\n]{1,80})\]$/.exec(text);
    if (tagged) {
      tag = { text: tagged[1].trim() };
      text = text.slice(0, tagged.index);
      continue;
    }
    break;
  }
  return { text, attachments, tag };
}

const GREETING: Msg = {
  sender: "ai",
  text: "Hi! I'm your Slips AI. Ask me anything about referrals, one-to-ones, visitors, TYFCB, or members.",
};

/** Device-local time, AM/PM. Messages from another day also show the date. */
function fmtTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

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
  const [maximized, setMaximized] = useState(false);
  const [inputBig, setInputBig] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [menu, setMenu] = useState<{ i: number; top: number; left: number } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done" | "fail">("idle");
  const [reply, setReply] = useState<{ sender: "user" | "ai"; text: string } | null>(null);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // Set when THIS box created its session: the sessionId prop change that
  // follows must not trigger a history reload (it would wipe the reply
  // currently being generated).
  const justCreated = useRef(false);

  // Load persisted history when switching sessions.
  useEffect(() => {
    setReply(null);
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
          ? data.messages.map((m: { sender: string; text: string; created_at?: string }) => {
              const { text, attachments, tag } = splitAttached(m.text);
              return {
                sender: m.sender === "user" ? ("user" as const) : ("ai" as const),
                text,
                attachments: attachments.length > 0 ? attachments : undefined,
                tag,
                createdAt: m.created_at,
              };
            })
          : [];
        setMessages(loaded.length > 0 ? loaded : [GREETING]);
      })
      .catch(() => setMessages([GREETING]))
      .finally(() => setLoadingHistory(false));
  }, [sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  // The ··· menu closes on outside click, log scroll, or a new message.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".chat-menu") || t?.closest(".chat-menu-btn")) return;
      setMenu(null);
    };
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    logRef.current?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      logRef.current?.removeEventListener("scroll", onScroll);
    };
  }, [menu]);
  useEffect(() => setMenu(null), [messages]);

  async function send(text: string) {
    const clean = text.trim();
    if ((!clean && pending.length === 0) || busy) return;
    setBusy(true);
    setError(null);
    const replyTo = reply;

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

    const files = pending;
    const next: Msg[] = [
      ...messages.filter((m) => m !== GREETING || messages.length > 1),
      {
        sender: "user",
        text: clean,
        createdAt: new Date().toISOString(),
        attachments: files.length > 0 ? files.map(({ name, mime }) => ({ name, mime })) : undefined,
        tag: replyTo ? { text: replyTo.text } : undefined,
      },
    ];
    setMessages(next);
    setInput("");
    setPending([]);
    setMenu(null);
    setReply(null);

    try {
      const res = await fetch("/api/chat/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          sessionId: sid,
          // History carries [attached: name] markers so follow-up turns know
          // an earlier message had files (only the latest turn is re-sent).
          history: next.slice(-10).map((m) => ({
            sender: m.sender,
            text: m.attachments?.length
              ? m.text + m.attachments.map((a) => `\n[attached: ${a.name}]`).join("")
              : m.text,
          })),
          attachments: files.length > 0 ? files : undefined,
          replyTo: replyTo ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setMessages((current) => [...current, { sender: "ai" as const, text: data.text, createdAt: new Date().toISOString() }]);
        onActivity();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("done");
    } catch {
      setCopyState("fail");
    }
    window.setTimeout(() => {
      setCopyState("idle");
      setMenu(null);
    }, 900);
  }

  function selectMessage(i: number) {
    const el = logRef.current?.querySelector(`[data-bubble="${i}"]`);
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /** Tag action: open the "Tagged …" bar above the composer (not sent). */
  function quoteMessage(i: number) {
    const m = messages[i];
    if (!m || !m.text.trim()) return;
    setReply({ sender: m.sender, text: m.text });
    inputRef.current?.focus();
  }

  /** Chip on a sent query: scroll back to the tagged message and flash it. */
  function scrollToTagged(fromIdx: number, snippet: string) {
    const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\]/g, "").trim();
    const needle = norm(snippet);
    if (!needle) return;
    let target = -1;
    for (let j = 0; j < fromIdx; j++) {
      if (norm(messages[j].text).startsWith(needle)) target = j; // nearest preceding match
    }
    if (target < 0) return;
    const el = logRef.current?.querySelector(`[data-bubble="${target}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashIdx(target);
    window.setTimeout(() => setFlashIdx(null), 1800);
  }

  function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
      };
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);

    const next: PendingFile[] = [...pending];
    let total = next.reduce((n, f) => n + Math.floor((f.data.length * 3) / 4), 0);
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (!FILE_EXTS.includes(ext)) {
        setError(`Unsupported file: ${file.name}. Allowed: ${FILE_EXTS.join(", ")}.`);
        continue;
      }
      if (next.length >= FILE_MAX_COUNT) {
        setError(`You can attach up to ${FILE_MAX_COUNT} files.`);
        break;
      }
      if (file.size > FILE_MAX_BYTES) {
        setError(`${file.name} is larger than 4MB.`);
        continue;
      }
      let data: string;
      try {
        data = await readBase64(file);
      } catch {
        setError(`Could not read ${file.name}.`);
        continue;
      }
      const bytes = Math.floor((data.length * 3) / 4);
      if (total + bytes > FILE_TOTAL_BYTES) {
        setError("Attachments exceed the 8MB total limit.");
        continue;
      }
      total += bytes;
      next.push({ name: file.name.slice(0, 160), mime: file.type || EXT_MIME[ext] || "application/octet-stream", data });
    }
    setPending(next);
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
      setReply(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed.");
    }
  }

  const openMenuMsg = menu ? messages[menu.i] : undefined;
  const openMenuIdx = menu && openMenuMsg ? menu.i : null;

  return (
    <div className={`chat-wrap${maximized ? " chat-maximized" : ""}`}>
      <div className="chat-toolbar">
        <span className="muted">{loadingHistory ? "Loading history…" : `${messages.length} message(s)`}</span>
        <span className="chat-toolbar-right">
          <button type="button" onClick={() => setMaximized((v) => !v)}>
            {maximized ? "Minimize" : "Maximize"}
          </button>
          {sessionId ? (
            <button type="button" onClick={() => setConfirmingClear(true)} disabled={busy}>
              Clear chat
            </button>
          ) : null}
        </span>
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.sender}${flashIdx === i ? " flash" : ""}`}>
            <div className="chat-stack">
              <button
                type="button"
                className={`chat-menu-btn${menu?.i === i ? " is-open" : ""}`}
                aria-label="Message actions"
                aria-haspopup="menu"
                title="Message actions"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const left = Math.max(8, Math.min(r.left, window.innerWidth - 172));
                  setMenu(menu?.i === i ? null : { i, top: r.bottom + 4, left });
                }}
              >
                ⋮
              </button>
              <div className="chat-bubble" data-bubble={i}>
                {m.tag ? (
                  <button
                    type="button"
                    className="chat-tagged"
                    title="Scroll to the tagged message"
                    onClick={() => {
                      if (m.tag) scrollToTagged(i, m.tag.text);
                    }}
                  >
                    <span className="chat-tagged-label">Tagged</span>
                    <span className="chat-tagged-text">{m.tag.text}</span>
                  </button>
                ) : null}
                {m.text}
                {m.attachments?.length ? (
                  <span className="chat-attach-row">
                    {m.attachments.map((a, ai) => (
                      <span key={`${a.name}-${ai}`} className="chat-attach">
                        {a.name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
              {fmtTime(m.createdAt) ? <span className="chat-time">{fmtTime(m.createdAt)}</span> : null}
            </div>
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

      {pending.length > 0 ? (
        <div className="chat-files">
          {pending.map((f, idx) => (
            <span key={`${f.name}-${idx}`} className="chat-file">
              {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setPending((p) => p.filter((_, j) => j !== idx))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {reply ? (
        <div className="chat-reply">
          <div className="chat-reply-inner">
            <span className="chat-reply-label">
              {reply.sender === "user" ? "Tagged your message" : "Tagged Slips AI response"}
            </span>
            <span className="chat-reply-text">{reply.text}</span>
          </div>
          <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}>
            ×
          </button>
        </div>
      ) : null}

      <form
        className={`chat-input${inputBig ? " input-big" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <button
          type="button"
          className="attach-btn"
          title="Attach a file (image, PDF, or spreadsheet)"
          aria-label="Attach a file"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.64 16.2a2 2 0 0 1-2.83-2.83l8.49-8.49" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.xls,.xlsx,.csv"
          onChange={onPick}
        />
        <textarea
          ref={inputRef}
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
        <button
          type="button"
          onClick={() => setInputBig((v) => !v)}
          title={inputBig ? "Shrink the input box" : "Expand the input box"}
        >
          {inputBig ? "Collapse" : "Expand"}
        </button>
        <button
          className="primary"
          type="submit"
          disabled={busy || (!input.trim() && pending.length === 0)}
        >
          {busy ? "…" : "Send"}
        </button>
      </form>

      {menu && openMenuMsg ? (
        <div className="chat-menu" style={{ top: menu.top, left: menu.left }} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (openMenuMsg) void copyText(openMenuMsg.text);
            }}
          >
            {copyState === "done" ? "Copied" : copyState === "fail" ? "Copy failed" : "Copy"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (openMenuIdx !== null) {
                selectMessage(openMenuIdx);
                setMenu(null);
              }
            }}
          >
            Select all
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (openMenuIdx !== null) {
                quoteMessage(openMenuIdx);
                setMenu(null);
              }
            }}
          >
            Tag
          </button>
        </div>
      ) : null}

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
