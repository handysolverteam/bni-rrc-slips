"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { findRangeToken, parseRangeToken, rangeToken } from "@/lib/weeks";

/**
 * From / To calendars for the screens that filter by week. Picking a date writes `range:<from>..<to>` into the screen's
 * week parameter (`paramKey`) — the server expands it to the weeks whose meeting date is inside (lib/weeks.ts
 * `expandWeekToken`) — and removes the competing parameters (`clearKeys`) and `page`. Either end may stay empty (open).
 * "Clear dates" removes the range again. `readKeys` are the parameters the active range may be found in (default: just
 * `paramKey`). `min` / `max` limit the calendars to the imported meeting dates.
 */
export default function DateRangeFilter({
  paramKey,
  readKeys,
  clearKeys = [],
  min = "",
  max = "",
}: {
  paramKey: string;
  readKeys?: string[];
  clearKeys?: string[];
  min?: string;
  max?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();

  let active: string | null = null;
  for (const k of readKeys ?? [paramKey]) {
    active = findRangeToken(search.get(k));
    if (active) break;
  }
  const parsed = parseRangeToken(active);
  const [from, setFrom] = useState(parsed?.from ?? "");
  const [to, setTo] = useState(parsed?.to ?? "");
  useEffect(() => {
    setFrom(parsed?.from ?? "");
    setTo(parsed?.to ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function apply(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(window.location.search);
    for (const k of [paramKey, ...clearKeys]) params.delete(k);
    params.delete("page");
    const token = rangeToken(nextFrom, nextTo);
    if (token) params.set(paramKey, token);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <div className="date-range" role="group" aria-label="Date range">
      <label className="date-range-field">
        <span>From</span>
        <input
          type="date"
          value={from}
          min={min || undefined}
          max={(to || max) || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            apply(e.target.value, to);
          }}
        />
      </label>
      <label className="date-range-field">
        <span>To</span>
        <input
          type="date"
          value={to}
          min={(from || min) || undefined}
          max={max || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            apply(from, e.target.value);
          }}
        />
      </label>
      {active ? (
        <button type="button" className="date-range-clear" onClick={() => apply("", "")}>
          Clear dates
        </button>
      ) : null}
      {isPending ? (
        <span className="toolbar-loading" role="status">
          <span className="spinner small" /> Loading…
        </span>
      ) : null}
    </div>
  );
}
