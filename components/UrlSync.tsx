"use client";

import { useEffect } from "react";

/**
 * Brings the address bar in line with what the page already rendered (the
 * auto-selected latest week, the home-chapter members filter…) WITHOUT a
 * navigation: `history.replaceState` only rewrites the URL, so nothing is
 * re-requested and nothing flashes. (A server `redirect()` did the same job
 * but threw the streamed page away — the screen went blank between the
 * loading skeleton and the real UI.)
 */
export default function UrlSync({ set, remove = [] }: { set: Record<string, string>; remove?: string[] }) {
  const key = JSON.stringify([set, remove]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(set)) params.set(k, v);
    for (const k of remove) params.delete(k);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
