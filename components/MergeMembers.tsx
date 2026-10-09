"use client";

import { useState } from "react";
import SearchSelect from "@/components/SearchSelect";

/**
 * "Same person, two spellings" — merge one member name into another. The member
 * rows, every slip and the attendance move to the kept name, and the merge is
 * remembered so later imports map the old spelling automatically.
 */
export default function MergeMembers({ names }: { names: string[] }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [into, setInto] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function merge() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/members/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, into }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      membersMerged?: number;
      namesRewritten?: number;
      attendanceMoved?: number;
      remembered?: boolean;
      warning?: string;
    };
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? "Merge failed." });
      return;
    }
    setMsg({
      ok: true,
      text: `Merged "${from}" into "${into}" — ${data.membersMerged ?? 0} member row(s), ${data.namesRewritten ?? 0} slip name(s), ${data.attendanceMoved ?? 0} attendance cell(s).${
        data.remembered ? " Remembered for future imports." : ""
      }${data.warning ? ` ${data.warning}` : ""}`,
    });
    setFrom("");
    setInto("");
    setTimeout(() => window.location.reload(), 1800);
  }

  return (
    <div className="card merge-card">
      <div className="import-head">
        <h2>Merge members</h2>
        <button type="button" className="import-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "− Minimize" : "+ Merge two spellings"}
        </button>
      </div>
      {open ? (
        <>
          <p className="muted">
            Same person under two names (middle initial, first initial, a typo)? Pick the spelling to remove and the one to
            keep. Everything moves to the kept name and the app remembers it, so imports merge it automatically next time.
          </p>
          <div className="merge-row">
            <div className="filter-field">
              <span className="filter-label">Merge this name…</span>
              <SearchSelect value={from} options={names} placeholder="Search a member" showClear={!!from} onChange={setFrom} />
            </div>
            <div className="filter-field">
              <span className="filter-label">…into (keep this name)</span>
              <SearchSelect value={into} options={names} placeholder="Search a member" showClear={!!into} onChange={setInto} />
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || !from || !into || from === into}
              onClick={merge}
            >
              {busy ? "Merging…" : "Merge"}
            </button>
          </div>
          {msg ? <p className={msg.ok ? "preview-ok" : "preview-warn"}>{msg.text}</p> : null}
        </>
      ) : null}
    </div>
  );
}
