"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const links = [
  { href: "/", label: "Home", exact: true },
  { href: "/import", label: "Import", exact: false },
  { href: "/members", label: "Bni Member", exact: false },
  { href: "/referrals", label: "Slip Referrals", exact: false },
  { href: "/one-to-ones", label: "Slip 121", exact: false },
  { href: "/visitors", label: "Slip Visitors", exact: false },
  { href: "/tyfcb", label: "Slip TYFCB", exact: false },
  { href: "/ceus", label: "Slip CEU", exact: false },
  { href: "/report", label: "Report", exact: false },
  { href: "/summary", label: "Chapter Summary", exact: false },
  { href: "/chat", label: "Chat", exact: false },
];

/**
 * Top-bar navigation. Desktop/tablet (≥641px) shows the inline link pills;
 * ≤640px hides them behind a hamburger toggle that slides in a drawer with the
 * same links. The drawer closes on link tap, overlay tap, Escape, route change,
 * and when the viewport grows back past the breakpoint (no stuck scroll lock).
 */
export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A navigation always lands with the drawer closed.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Growing back to desktop width force-closes it (the panel is display:none
  // there, which would otherwise leave the scroll lock behind).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 641px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const pillLinks = links.map((l) => {
    const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
    return (
      <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
        {l.label}
      </Link>
    );
  });

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="nav-drawer"
        aria-label="Menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
        <span />
      </button>
      <nav className="nav-pills">{pillLinks}</nav>
      <div className="nav-drawer-overlay" hidden={!open} onClick={() => setOpen(false)} />
      <div id="nav-drawer" className={`nav-drawer${open ? " open" : ""}`} aria-hidden={!open}>
        <nav className="nav-drawer-links">{pillLinks}</nav>
        {/* Phone: the top-bar toggle is hidden ≤640px, so the drawer carries it. */}
        <div className="nav-drawer-foot">
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}
