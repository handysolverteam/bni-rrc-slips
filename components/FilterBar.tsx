"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import SearchSelect from "@/components/SearchSelect";
import type { WeekOption } from "@/lib/weeks";

/**
 * Search also uses Apply-on-navigate; the week dropdown is a searchable
 * select that applies instantly on change (same pattern as table filters).
 * Cleared/All selection is sent as `week=all`.
 */
export default function FilterBar({
  basePath,
  q,
  weekId,
  weeks,
  searchPlaceholder,
  hiddenParams,
  includeAllOption,
  hideSearch,
  multiSelect,
  onNavigate,
}: {
  basePath: string;
  q: string;
  weekId: string;
  weeks: WeekOption[];
  searchPlaceholder?: string;
  hiddenParams?: Record<string, string>;
  includeAllOption?: boolean;
  hideSearch?: boolean;
  /** Week box accepts a comma-separated multi-selection (report screen). */
  multiSelect?: boolean;
  onNavigate?: (url: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildUrl(week: string): string {
    const params = new URLSearchParams();
    const text = (inputRef.current?.value ?? "").trim();
    if (text) params.set("q", text);
    if (week) params.set("week", week);
    for (const [k, v] of Object.entries(hiddenParams ?? {})) params.set(k, v);
    return `${basePath}?${params.toString()}`;
  }

  function go(week: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const url = buildUrl(week);
    if (onNavigate) onNavigate(url);
    else startTransition(() => router.push(url));
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form
      className="filter-form"
      onSubmit={(e) => {
        e.preventDefault();
        go(weekId);
      }}
    >
      {!hideSearch ? (
        <input
          ref={inputRef}
          name="q"
          placeholder={searchPlaceholder}
          defaultValue={q}
          aria-label="Search"
          onChange={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => go(weekId), 600);
          }}
        />
      ) : null}
      {weeks.length > 0 ? (
        <SearchSelect
          value={weekId}
          options={weeks.map((w) => ({ value: w.id, label: w.label }))}
          placeholder="All weeks"
          allLabel="All weeks"
          showClear={!!weekId && weekId !== "all"}
          multiple={multiSelect}
          onChange={(v) => go(v || "all")}
        />
      ) : null}
      {isPending ? (
        <span className="toolbar-loading" role="status">
          <span className="spinner small" /> Loading…
        </span>
      ) : null}
    </form>
  );
}
