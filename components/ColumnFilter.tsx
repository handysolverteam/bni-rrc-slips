"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import SearchSelect, { type ComboOption } from "@/components/SearchSelect";

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
}: {
  paramKey: string;
  defaultValue: string;
  options: ComboOption[];
  label: string;
  allLabel?: string;
  onApply?: (value: string) => void;
  /** Sent instead of removing the param when cleared (e.g. week -> "all"). */
  clearValue?: string;
  /** Single pick for scope columns (week/chapter); names etc. stay multi. */
  multiSelect?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Keep the current value visible even when it is missing from the options
  // (multi: one entry per missing part, never the raw comma string).
  const optionValues = options.map((o) => (typeof o === "string" ? o : o.value));
  const parts = defaultValue
    ? multiSelect
      ? defaultValue.split(",").map((s) => s.trim()).filter(Boolean)
      : [defaultValue]
    : [];
  const missing = parts
    .filter((v) => !optionValues.includes(v))
    .map((v) => ({ value: v, label: v }));
  const list = missing.length > 0 ? [...missing, ...options] : options;

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

  return (
    <span className="col-filter-wrap" onClick={(e) => e.stopPropagation()}>
      <SearchSelect
        value={defaultValue}
        options={list}
        placeholder={label}
        allLabel={allLabel}
        multiple={multiSelect}
        onChange={apply}
      />
      {isPending ? <span className="spinner small col-filter-busy" /> : null}
    </span>
  );
}
