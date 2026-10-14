"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

/**
 * Editable Category cell of the members table: a plain input box. Saves on Enter or when the box loses
 * focus (only if the text changed) through PATCH /api/members/{id} { category }; Escape reverts.
 */
export default function MemberCategoryInput({
  memberId,
  name,
  category,
}: {
  memberId: string;
  name: string;
  category: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(category);
  const saved = useRef(category);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = () => {
    const next = value.trim();
    if (next === saved.current) {
      setValue(next);
      return;
    }
    setState("saving");
    fetch(`/api/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: next }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        saved.current = next;
        setValue(next);
        setState("saved");
        startTransition(() => router.refresh());
        setTimeout(() => setState("idle"), 1500);
      })
      .catch(() => setState("error"));
  };

  return (
    <span className="cat-edit">
      <input
        className="cat-input"
        value={value}
        placeholder="Add category"
        aria-label={`Category of ${name}`}
        maxLength={120}
        disabled={state === "saving" || isPending}
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== "idle") setState("idle");
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setValue(saved.current);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {state === "saving" ? <span className="cat-state">Saving…</span> : null}
      {state === "saved" ? <span className="cat-state ok">Saved</span> : null}
      {state === "error" ? <span className="cat-state bad">Not saved</span> : null}
    </span>
  );
}
