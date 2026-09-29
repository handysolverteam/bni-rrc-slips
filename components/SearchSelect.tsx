"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ComboOption = string | { value: string; label: string };

function norm(o: ComboOption): { value: string; label: string } {
  return typeof o === "string" ? { value: o, label: o } : o;
}

/**
 * MUI-Autocomplete-style searchable dropdown for table headers.
 * The listbox renders in a body portal so table scroll containers
 * can never clip it; it closes on scroll, resize, Escape or outside click.
 */
export default function SearchSelect({
  value,
  options,
  placeholder,
  allLabel,
  onChange,
}: {
  value: string;
  options: ComboOption[];
  placeholder: string;
  allLabel?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  const current = options.map(norm).find((o) => o.value === value);
  const display = term ?? current?.label ?? "";

  function measure(): { top: number; left: number; width: number } | null {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    const width = Math.round(Math.max(r.width, 230));
    // Flip above the field when there is no room below. Rounded to whole
    // pixels — fractional fixed positions blur text in Chrome.
    const estHeight = 260;
    const top = Math.round(
      r.bottom + estHeight <= window.innerHeight || r.top - estHeight < 0
        ? r.bottom + 6
        : r.top - estHeight - 6,
    );
    return {
      top: Math.max(8, top),
      left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - Math.min(width, 300) - 8))),
      width,
    };
  }

  function doOpen() {
    setPos(measure());
    setTerm("");
    setHighlight(0);
    setOpen(true);
  }

  function doClose() {
    setOpen(false);
    setTerm(null);
    setPos(null);
  }

  useEffect(() => {
    if (!open) return;
    // Click (not mousedown): option buttons handle their own click first,
    // so selecting an option always wins over closing.
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      const inField = !!ref.current?.contains(t);
      const inPop = !!popRef.current?.contains(t);
      if (!inField && !inPop) doClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") doClose();
    }
    // The anchor moves with any scroll/resize — follow it instead of closing.
    function onScroll() {
      const next = measure();
      if (next) setPos(next);
      else doClose();
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const needle = (term ?? "").trim().toLowerCase();
  const list = options
    .map(norm)
    .filter((o) => !needle || o.label.toLowerCase().includes(needle));

  function pick(v: string) {
    const changed = v !== value;
    doClose();
    if (changed) onChange(v);
  }

  return (
    <span
      className={`combo${value ? " has-value" : ""}`}
      ref={ref}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="combo-field">
        <input
          className="combo-input"
          value={display}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          onFocus={() => {
            if (!open) doOpen();
          }}
          onChange={(e) => {
            setTerm(e.target.value);
            setHighlight(0);
            if (!open) {
              setPos(measure());
              setOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) doOpen();
              else setHighlight((h) => Math.min(h + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && list.length > 0) pick(list[Math.min(highlight, list.length - 1)].value);
            }
          }}
        />
        {value ? (
          <button
            type="button"
            className="combo-adorn"
            aria-label="Clear selection"
            onClick={() => pick("")}
          >
            ✕
          </button>
        ) : null}
        <button
          type="button"
          className="combo-adorn"
          aria-label="Open options"
          onClick={() => (open ? doClose() : doOpen())}
        >
          ▾
        </button>
      </span>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <span
              className="combo-pop"
              role="listbox"
              ref={popRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: Math.min(pos.width, 300) }}
            >
              <span className="combo-list">
                <button type="button" className="combo-item combo-clear" onClick={() => pick("")}>
                  {allLabel ?? `All ${placeholder}`}
                </button>
                {list.map((o, i) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    className={`combo-item${o.value === value ? " selected" : ""}${i === highlight ? " highlighted" : ""}`}
                    title={o.label}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(o.value)}
                  >
                    {o.value === value ? "✓ " : ""}
                    {o.label}
                  </button>
                ))}
                {list.length === 0 ? <span className="combo-empty">No options</span> : null}
              </span>
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
