"use client";

import { useEffect, useState } from "react";

/** Custom event so every column filter on the page reacts at once. */
export const MS_EVENT = "bni-ms-change";

/** Is "multi-select filters" on? `?ms=1` in the URL (survives filter picks, reloads and shared links). */
export function readMultiSelect(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("ms") === "1";
}

/** Subscribe to the toggle; false on the server and before hydration. */
export function useMultiSelect(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readMultiSelect());
    sync();
    window.addEventListener(MS_EVENT, sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(MS_EVENT, sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return on;
}

/**
 * Checkbox above a table: off (default) = every column filter picks ONE value;
 * on = the columns that allow several (names, categories, …) become multi-select.
 * Pure client state kept in `?ms=1` — no server round trip.
 */
export default function MultiSelectToggle({ label = "Multi-select filters" }: { label?: string }) {
  const on = useMultiSelect();
  function toggle(next: boolean) {
    const params = new URLSearchParams(window.location.search);
    if (next) params.set("ms", "1");
    else params.delete("ms");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    window.dispatchEvent(new Event(MS_EVENT));
  }
  return (
    <label className="multi-check table-multi-toggle">
      <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
      {label}
    </label>
  );
}
