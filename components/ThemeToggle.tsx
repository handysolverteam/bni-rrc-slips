"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "bni-theme";
const THEME_EVENT = "bni-theme-change";

/**
 * Sun/moon button that flips `<html data-theme>` between light and dark and
 * persists the choice (the pre-paint script in app/layout.tsx re-applies it on
 * the next load; without a stored choice the OS preference wins). Every
 * rendered instance syncs through the `bni-theme-change` event, so the top-bar
 * button and the phone-drawer button never disagree. The palette itself lives
 * in app/globals.css — this component only toggles the attribute.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  const toggle = () => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the attribute still flips for now.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
