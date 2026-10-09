"use client";

import { useState } from "react";

type Tenant = { id: string; name: string };

async function post(url: string, method: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status}).`;
}

/** Settings: which chapter is active, add a chapter, choose the Home Chapter. */
export default function SettingsPanel({
  tenants,
  activeId,
  homeChapter,
  chapterNames,
}: {
  tenants: Tenant[];
  activeId: string;
  homeChapter: string;
  chapterNames: string[];
}) {
  const [active, setActive] = useState(activeId);
  const [newName, setNewName] = useState("");
  const [home, setHome] = useState(homeChapter);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<string | null>, done: string) {
    setBusy(true);
    setMsg(null);
    const err = await fn();
    setBusy(false);
    if (err) setMsg({ ok: false, text: err });
    else {
      setMsg({ ok: true, text: done });
      try {
        sessionStorage.removeItem("bni-shell-v1"); // cached shell lists the old chapters
      } catch {}
      window.location.reload();
    }
  }

  // The home chapter row may not exist as a chapters row yet (first import creates it).
  const homeOptions = chapterNames.includes(homeChapter) ? chapterNames : [homeChapter, ...chapterNames];

  return (
    <div className="settings-grid">
      <section className="card">
        <h2>Active chapter</h2>
        <p className="muted">Everything you see and import belongs to this chapter.</p>
        <div className="settings-row">
          <select aria-label="Active chapter" value={active} disabled={busy} onChange={(e) => setActive(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            disabled={busy || active === activeId}
            onClick={() => run(() => post("/api/tenant", "POST", { tenantId: active }), "Switched.")}
          >
            Switch
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Home chapter</h2>
        <p className="muted">
          The chapter whose members this app tracks. New members found in slip and PALMS imports are added here (you
          confirm each one in the import preview).
        </p>
        <div className="settings-row">
          <select aria-label="Home chapter" value={home} disabled={busy} onChange={(e) => setHome(e.target.value)}>
            {homeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            disabled={busy || home === homeChapter}
            onClick={() => run(() => post("/api/settings/home-chapter", "PATCH", { name: home }), "Saved.")}
          >
            Save
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Add a chapter</h2>
        <p className="muted">
          Import another chapter&apos;s data into its own space. You can also just import its files — if the chapter in the
          file is new, the import offers to create it.
        </p>
        <div className="settings-row">
          <input
            aria-label="New chapter name"
            placeholder="e.g. BNI Champions"
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="primary"
            disabled={busy || !newName.trim()}
            onClick={() => run(() => post("/api/chapters", "POST", { name: newName }), "Chapter added.")}
          >
            Add &amp; switch
          </button>
        </div>
      </section>

      {msg ? <p className={msg.ok ? "preview-ok" : "preview-warn"}>{msg.text}</p> : null}
    </div>
  );
}
