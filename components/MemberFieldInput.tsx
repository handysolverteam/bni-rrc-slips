"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

/** Members-table columns that are edited in place with a plain input box. */
export type MemberField = "category" | "company" | "phone";

const PLACEHOLDER: Record<MemberField, string> = { category: "Add category", company: "Add company", phone: "Add phone" };
const MAX_LEN: Record<MemberField, number> = { category: 120, company: 160, phone: 40 };

/**
 * Editable cell of the members table: a plain input box (never a dropdown). Saves on Enter or when the box
 * loses focus (only if the text changed) through PATCH /api/members/{id} { <field> }; Escape reverts.
 */
export default function MemberFieldInput({
  memberId,
  name,
  field,
  initial,
}: {
  memberId: string;
  name: string;
  field: MemberField;
  initial: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = () => {
    const next = value.replace(/\s+/g, " ").trim();
    if (next === saved.current) {
      setValue(next);
      return;
    }
    setState("saving");
    fetch(`/api/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
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
        placeholder={PLACEHOLDER[field]}
        aria-label={`${field} of ${name}`}
        maxLength={MAX_LEN[field]}
        inputMode={field === "phone" ? "tel" : undefined}
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
