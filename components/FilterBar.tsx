"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import type { WeekOption } from "@/lib/weeks";

/**
 * Week dropdown applies instantly on change; search still uses Apply.
 * Navigations run in a React transition, so the current table stays on
 * screen — only an additional indicator appears while loading.
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
  onNavigate,
}: {
  basePath: string;
  q: string;
  weekId: string;
  weeks: WeekOption[];
  searchPlaceholder: string;
  hiddenParams?: Record<string, string>;
  includeAllOption?: boolean;
  hideSearch?: boolean;
  onNavigate?: (url: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
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

  function currentWeek(): string {
    return selectRef.current?.value ?? weekId;
  }

  function fire() {
    const url = buildUrl(currentWeek());
    if (onNavigate) onNavigate(url);
    else startTransition(() => router.push(url));
  }

  function go(week: string, immediate = true) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (immediate) {
      const url = buildUrl(week);
      if (onNavigate) onNavigate(url);
      else startTransition(() => router.push(url));
      return;
    }
    timer.current = setTimeout(fire, 600);
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
          onChange={() => go(currentWeek(), false)}
        />
      ) : null}
      {weeks.length > 0 ? (
        <select
          ref={selectRef}
          name="week"
          defaultValue={weekId}
          aria-label="Filter by BNI week"
          onChange={(e) => go(e.target.value)}
        >
          <option value={includeAllOption ? "all" : ""}>All weeks</option>
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      ) : null}
      {isPending ? (
        <span className="toolbar-loading" role="status">
          <span className="spinner small" /> Loading…
        </span>
      ) : null}
    </form>
  );
}
