"use client";

import { useEffect, useRef, useState } from "react";

/** Copy `text` to the clipboard; the clipboard API needs a secure context and a user gesture, so fall back to a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * "Copy" button that sits beside a Share on WhatsApp button: copies exactly the text WhatsApp would receive, so it can be
 * pasted anywhere. Shows "Copied" for two seconds (or "Copy failed").
 */
export default function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className={`copy-btn${state === "done" ? " done" : ""}`}
      title="Copy the text to the clipboard"
      onClick={async () => {
        setState((await copyText(text)) ? "done" : "failed");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "done" ? "Copied ✓" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
