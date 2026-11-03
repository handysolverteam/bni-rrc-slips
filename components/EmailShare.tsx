"use client";

import { useState } from "react";

type Person = { name: string; email: string };

/** mailto: link with the recipients, subject and body prefilled (the mail app opens; the member presses send). */
export function mailtoUrl(emails: string[], subject: string, text: string): string {
  return `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/**
 * "Email" button that sits beside Share on WhatsApp: pick one or several members (those with an email) and the mail app
 * opens with the same text, nothing is sent by the app. Members load only when the picker is first opened.
 */
export default function EmailShare({ text, subject }: { text: string; subject: string }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [find, setFind] = useState("");

  const show = async () => {
    setOpen(true);
    if (people) return;
    try {
      const res = await fetch("/api/members/emails");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not load members");
      setPeople(j.members as Person[]);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const needle = find.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !needle || `${p.name} ${p.email}`.toLowerCase().includes(needle));
  const toggle = (email: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(email)) n.add(email);
      return n;
    });
  const send = () => {
    window.location.href = mailtoUrl([...picked], subject, text);
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="copy-btn" title="Email this text to selected members" onClick={show}>
        Email
      </button>
      {open ? (
        <div className="email-share-backdrop" onClick={() => setOpen(false)}>
          <div className="email-share-card" role="dialog" aria-label="Email to members" onClick={(e) => e.stopPropagation()}>
            <h3>Email to…</h3>
            <input className="email-share-find" placeholder="Search member or email" value={find} onChange={(e) => setFind(e.target.value)} />
            <div className="email-share-actions">
              <button type="button" className="copy-btn" onClick={() => setPicked(new Set([...picked, ...shown.map((p) => p.email)]))}>
                Select all{needle ? " shown" : ""}
              </button>
              <button type="button" className="copy-btn" onClick={() => setPicked(new Set(needle ? [...picked].filter((e) => !shown.some((p) => p.email === e)) : []))}>
                Deselect all{needle ? " shown" : ""}
              </button>
              <span className="muted">{picked.size} selected</span>
            </div>
            <div className="email-share-list">
              {error ? <p className="muted">{error}</p> : !people ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No member with an email.</p> : null}
              {shown.map((p) => (
                <label key={p.email} className="email-share-row">
                  <input type="checkbox" checked={picked.has(p.email)} onChange={() => toggle(p.email)} />
                  <span>{p.name}</span>
                  <span className="muted">{p.email}</span>
                </label>
              ))}
            </div>
            <div className="email-share-actions">
              <button type="button" className="copy-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="wa-btn" disabled={picked.size === 0} onClick={send}>
                Open email ({picked.size})
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
