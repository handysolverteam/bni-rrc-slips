"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useMultiSelect } from "@/components/MultiSelectToggle";
import SearchSelect, { type ComboOption } from "@/components/SearchSelect";
import { decodeCommas, encodeCommas } from "@/lib/list-filters";

/**
 * Column filter as a searchable dropdown. Options are distinct values
 * loaded server-side from the database; the column title is the button
 * itself, so no extra label is needed. Applies instantly on pick.
 * With `onApply` the choice stays local (client-fetched tables) instead
 * of pushing a URL param — same look and behaviour either way.
 */
export default function ColumnFilter({
  paramKey,
  defaultValue,
  options,
  label,
  allLabel,
  onApply,
  clearValue,
  multiSelect,
  text,
}: {
  paramKey: string;
  defaultValue: string;
  options: ComboOption[];
  label: string;
  allLabel?: string;
  onApply?: (value: string) => void;
  /** Sent instead of removing the param when cleared (e.g. week -> "all"). */
  clearValue?: string;
  /** Legacy: every column is multi-select-capable now; kept so existing call sites compile. */
  multiSelect?: boolean;
  /** Free-text box (contains-match) instead of the dropdown of distinct values. */
  text?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [typed, setTyped] = useState(() => decodeCommas(defaultValue));
  const lastApplied = useRef(defaultValue);
  // Text mode: the URL value is the source of truth after navigation (Clear all, back button).
  useEffect(() => {
    if (text) {
      setTyped(decodeCommas(defaultValue));
      lastApplied.current = defaultValue;
    }
  }, [defaultValue, text]);
  // Text mode: apply 450 ms after the last keystroke (Enter applies at once).
  useEffect(() => {
    if (!text) return;
    const wanted = encodeCommas(typed.trim());
    if (wanted === lastApplied.current) return;
    const t = setTimeout(() => {
      lastApplied.current = wanted;
      apply(wanted);
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, text]);
  // Single select by default; the "Multi-select filters" checkbox above the table
  // turns EVERY column filter multi-select. A value that already holds several
  // picks (shared link) stays multi so it is never shown as one raw string.
  const msOn = useMultiSelect();
  const multi = msOn || defaultValue.includes(",");
  // Keep the current value visible even when it is missing from the options
  // (multi: one entry per missing part, never the raw comma string).
  // A comma inside one option value (chapter "Champions, Gurgaon, India") must not read as a
  // multi-select separator: its value travels with the comma encoded, its label stays readable.
  const encoded: ComboOption[] = options.map((o) =>
    typeof o === "string" ? { value: encodeCommas(o), label: o } : { value: encodeCommas(o.value), label: o.label },
  );
  const optionValues = encoded.map((o) => (typeof o === "string" ? o : o.value));
  const parts = defaultValue
    ? multi
      ? defaultValue.split(",").map((s) => s.trim()).filter(Boolean)
      : [defaultValue]
    : [];
  const missing = parts
    .filter((v) => !optionValues.includes(v))
    .map((v) => ({ value: v, label: decodeCommas(v) }));
  const list = missing.length > 0 ? [...missing, ...encoded] : encoded;

  function apply(value: string) {
    if (onApply) {
      onApply(value);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(paramKey, value);
    else if (clearValue !== undefined) params.set(paramKey, clearValue);
    else params.delete(paramKey);
    params.delete("page");
    // scroll: false — a table-filter pick must not jump the viewport to the
    // top (the header cell is deep down the report page).
    startTransition(() =>
      router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false }),
    );
  }

  if (text) {
    return (
      <span className="col-filter-wrap" onClick={(e) => e.stopPropagation()}>
        <span className={`combo${typed ? " has-value" : ""}`}>
          <span className="combo-label" aria-hidden="true">{label}</span>
          <span className="combo-field">
            <input
              className="combo-input"
              value={typed}
              placeholder={label}
              aria-label={label}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const wanted = encodeCommas(typed.trim());
                  lastApplied.current = wanted;
                  apply(wanted);
                }
              }}
            />
            {typed ? (
              <button type="button" className="combo-adorn" aria-label="Clear" onClick={() => setTyped("")}>
                ✕
              </button>
            ) : null}
          </span>
        </span>
        {isPending ? <span className="spinner small col-filter-busy" /> : null}
      </span>
    );
  }

  return (
    <span className="col-filter-wrap" onClick={(e) => e.stopPropagation()}>
      <SearchSelect
        value={defaultValue}
        options={list}
        placeholder={label}
        allLabel={allLabel}
        multiple={multi}
        onChange={apply}
      />
      {isPending ? <span className="spinner small col-filter-busy" /> : null}
    </span>
  );
}
