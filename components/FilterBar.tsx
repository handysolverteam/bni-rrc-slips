"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import SearchSelect from "@/components/SearchSelect";
import type { WeekOption } from "@/lib/weeks";

/**
 * Search also uses Apply-on-navigate; the week dropdown is a searchable
 * select that applies instantly on change (same pattern as table filters).
 * Two week pickers share the `week` param: a SINGLE select for quick
 * filtering and a MULTI select (click toggles, list stays open; comma list
 * that exports accept) for multi-week views/exports. Cleared/All = `week=all`.
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
  showMulti = true,
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
  /** Show the "Multi-select" checkbox next to the week box (comma list in `week`); default on. */
  showMulti?: boolean;
  onNavigate?: (url: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One week box; the checkbox beside it turns multi-select on/off. A URL that
  // already carries several weeks opens in multi mode.
  const [multi, setMulti] = useState(weekId.includes(","));
  useEffect(() => {
    if (weekId.includes(",")) setMulti(true);
  }, [weekId]);

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
        <div className="filter-field">
          <span className="filter-label">Week</span>
          <div className="week-row">
            <SearchSelect
              value={multi ? weekId : weekId.includes(",") ? "" : weekId}
              options={weeks.map((w) => ({ value: w.id, label: w.label }))}
              placeholder={multi ? "Select weeks" : "All weeks"}
              allLabel="All weeks"
              multiple={multi}
              showClear={!!weekId && weekId !== "all"}
              onChange={(v) => go(v || "all")}
            />
            {showMulti ? (
              <label className="multi-check">
                <input
                  type="checkbox"
                  checked={multi}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setMulti(on);
                    // Back to single select: keep the first picked week.
                    if (!on && weekId.includes(",")) go(weekId.split(",")[0]);
                  }}
                />
                Multi-select
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
      {isPending ? (
        <span className="toolbar-loading" role="status">
          <span className="spinner small" /> Loading…
        </span>
      ) : null}
    </form>
  );
}
