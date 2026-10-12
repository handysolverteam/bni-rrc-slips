"use client";

import { useCallback, useEffect, useState } from "react";
import ChatBox from "@/components/ChatBox";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** The account that owns the chat; only the owner can write to it. */
  owner_uid?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  /** True for the caller's own chats: only those can be renamed / deleted / cleared (anyone can read and write in any chat). */
  mine: boolean;
};

/** Sidebar section title of an account: its name, else a short id. */
const accountLabel = (s: ChatSession): string =>
  s.owner_name?.trim() || s.owner_email?.trim() || (s.owner_uid ? `Account ${s.owner_uid.slice(0, 6)}` : "Unassigned chats");

export default function ChatPage() {
  const { user } = useAuth();
  const myName = user?.displayName || user?.email || "";
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Bumped only when the user explicitly switches chats: creating a session
  // from inside ChatBox must NOT remount it (that wipes the in-flight reply).
  const [epoch, setEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const refreshSessions = useCallback(async (selectId?: string) => {
    try {
      // `name` back-fills the owner label on this account's older chats.
      const res = await fetch(`/api/chat/sessions${myName ? `?name=${encodeURIComponent(myName)}` : ""}`);
      const data = await res.json();
      if (Array.isArray(data.sessions)) {
        setSessions(data.sessions);
        if (selectId) setActiveId(selectId);
        else if (data.sessions.length > 0) {
          setActiveId((current) =>
            current && data.sessions.some((s: ChatSession) => s.id === current)
              ? current
              : data.sessions[0].id,
          );
        }
      }
    } catch {
      // sidebar simply stays as-is
    } finally {
      setLoading(false);
    }
  }, [myName]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  async function deleteSession(id: string) {
    setPendingDelete(null);
    await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (activeId === id) {
      setActiveId(remaining.length > 0 ? remaining[0].id : null);
      setEpoch((e) => e + 1);
    }
  }

  async function saveRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    setSessions((current) => current.map((s) => (s.id === id ? { ...s, title } : s)));
    await fetch(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }

  // Sections: the caller's own chats first, then one section per other account
  // (most recently active account first). Sessions arrive newest-first already.
  const groups = (() => {
    const mine = sessions.filter((s) => s.mine);
    const out: { key: string; label: string; own: boolean; sessions: ChatSession[] }[] = [];
    if (mine.length > 0) out.push({ key: "mine", label: "Your chats", own: true, sessions: mine });
    const byOwner = new Map<string, ChatSession[]>();
    for (const s of sessions) {
      if (s.mine) continue;
      const k = s.owner_uid ?? "none";
      byOwner.set(k, [...(byOwner.get(k) ?? []), s]);
    }
    for (const [k, list] of byOwner) out.push({ key: k, label: accountLabel(list[0]), own: false, sessions: list });
    return out;
  })();

  return (
    <div>
      <div className="page-head">
        <h1>Slips AI Chat</h1>
        <p className="sub muted">Answers come live from your members, referrals, TYFCB and visitor data.</p>
      </div>

      <div className="chat-layout">
        <aside className="chat-sidebar">
          <button
            type="button"
            className="primary btn-block"
            onClick={() => {
              setActiveId(null);
              setEpoch((e) => e + 1);
            }}
          >
            ＋ New chat
          </button>
          {loading ? (
            <p className="muted">Loading chats…</p>
          ) : sessions.length === 0 ? (
            <p className="muted">No chats yet — start one.</p>
          ) : (
            <div className="chat-groups">
              {groups.map((g) => (
                <div key={g.key} className="chat-group">
                  <h3 className="chat-group-title" title={g.sessions[0]?.owner_email ?? undefined}>
                    {g.label}
                  </h3>
                  <ul>
              {g.sessions.map((s) => (
                <li key={s.id} className={s.id === activeId ? "active" : undefined}>
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      maxLength={120}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(s.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="chat-session-title"
                        onClick={() => {
                          setActiveId(s.id);
                          setEpoch((e) => e + 1);
                        }}
                        title={s.title}
                      >
                        {s.title}
                      </button>
                      {s.mine ? (
                      <span className="chat-session-actions">
                        <button
                          type="button"
                          title="Rename"
                          onClick={() => {
                            setRenamingId(s.id);
                            setRenameValue(s.title);
                          }}
                        >
                          ✎
                        </button>
                        <button type="button" title="Delete" onClick={() => setPendingDelete(s.id)}>
                          🗑
                        </button>
                      </span>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="card chat-card chat-main">
          <ChatBox
            key={epoch}
            sessionId={activeId}
            chatTitle={sessions.find((s) => s.id === activeId)?.title ?? ""}
            ownerName={myName}
            chatOwner={(() => {
              const s = sessions.find((x) => x.id === activeId);
              return s ? (s.mine ? myName : accountLabel(s)) : myName;
            })()}
            canManage={sessions.find((s) => s.id === activeId)?.mine ?? true}
            onSessionCreated={(id) => refreshSessions(id)}
            onActivity={() => refreshSessions()}
          />
        </div>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete this chat?"
          message={`"${sessions.find((s) => s.id === pendingDelete)?.title ?? "This chat"}" and all its messages will be permanently removed.`}
          confirmLabel="Delete chat"
          danger
          onConfirm={() => deleteSession(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
