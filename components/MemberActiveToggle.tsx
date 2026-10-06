"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Admin-only active/inactive checkbox for the members table. Flips
 * `members.is_inactive` through PATCH /api/members/{id}; the row updates
 * optimistically and the server render is refreshed afterwards so paging,
 * totals and filters match the DB.
 */
export default function MemberActiveToggle({
  memberId,
  name,
  active,
}: {
  memberId: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [on, setOn] = useState(active);
  const [busy, setBusy] = useState(false);

  const flip = () => {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    fetch(`/api/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isInactive: !next }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then(() => startTransition(() => router.refresh()))
      .catch(() => {
        setOn(!next);
      })
      .finally(() => setBusy(false));
  };

  return (
    <input
      type="checkbox"
      className="active-toggle"
      checked={on}
      disabled={busy || isPending}
      onChange={flip}
      title={`${name} is ${on ? "active" : "inactive"} — click to mark ${on ? "inactive" : "active"}`}
      aria-label={`${name} active`}
    />
  );
}