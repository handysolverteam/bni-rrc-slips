"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

/** `path` = route used for the active-pill match when `href` carries a query. */
type NavLeaf = { href: string; label: string; exact?: boolean; path?: string };
type NavGroup = { label: string; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

const links: NavItem[] = [
  { href: "/", label: "Home", exact: true },
  { href: "/import", label: "Import", exact: false },
  // Opens on the active Home Chapter members by default (the page redirects to
  // /members?active=1&c_chapter=<this chapter's home chapter>).
  {
    href: "/members?home=1",
    path: "/members",
    label: "Bni Member",
    exact: false,
  },
  { href: "/chapters", label: "Other Chapters", exact: false },
  {
    label: "Slips",
    children: [
      { href: "/one-to-ones", label: "One to One" },
      { href: "/referrals", label: "Referral" },
      { href: "/visitors", label: "Visitors" },
      { href: "/tyfcb", label: "TYFCB" },
      { href: "/ceus", label: "CEU" },
    ],
  },
  { href: "/report", label: "Slip Report", exact: false },
  { href: "/top3", label: "Top 3", exact: false },
  { href: "/palms", label: "Attendance", exact: false },
  { href: "/chat", label: "Chat", exact: false },
  { href: "/settings", label: "Settings", exact: false },
];

const isLeaf = (l: NavItem): l is NavLeaf => "href" in l;
const groupActive = (g: NavGroup, pathname: string) =>
  g.children.some((c) => pathname.startsWith(c.href));

/**
 * Top-bar navigation. Desktop/tablet (≥641px) shows the inline link pills —
 * the **Slips** group is a dropdown whose menu portals to <body> as a
 * fixed-position panel (the pill row is overflow-x:auto, which would clip an
 * absolute child). ≤640px hides the pills behind a hamburger toggle that
 * slides in a drawer with the same links, where the group expands as an
 * accordion. The drawer closes on link tap, overlay tap, Escape, route change,
 * and when the viewport grows back past the breakpoint (no stuck scroll lock).
 */
export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portal target only exists (and hydration only matches) on the client.
  useEffect(() => setMounted(true), []);

  // A navigation always lands with the drawer and any dropdown closed.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => setOpenGroup(null), [pathname]);

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

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const closeGroup = () => {
    cancelClose();
    setOpenGroup(null);
    setMenuPos(null);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(closeGroup, 140);
  };
  useEffect(() => () => cancelClose(), []);

  // Open the desktop menu under its pill (hover or click).
  // Measured from the event's own element, not groupRef: a hover renders at
  // low priority, so the ref may not be attached yet when this runs.
  const openFromPills = (label: string, el: HTMLElement) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 210)) });
    setOpenGroup(label);
  };

  // The open dropdown: close on outside click, Escape, scroll or resize.
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".nav-drop") || t?.closest(".nav-drop-menu")) return;
      closeGroup();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGroup();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", closeGroup, true);
    window.addEventListener("resize", closeGroup);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", closeGroup, true);
      window.removeEventListener("resize", closeGroup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGroup]);

  const leafLink = (l: NavLeaf) => {
    const active = l.exact ? pathname === l.href : pathname.startsWith(l.path ?? l.href);
    return (
      <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
        {l.label}
      </Link>
    );
  };

  // Desktop pill row: leaves as pills, the group as a dropdown trigger.
  const pillItems = links.map((l) => {
    if (isLeaf(l)) return leafLink(l);
    const active = groupActive(l, pathname);
    const isOpen = openGroup === l.label;
    return (
      <div
        key={l.label}
        className={`nav-drop${isOpen ? " open" : ""}`}
        onMouseEnter={(e) => openFromPills(l.label, e.currentTarget)}
        onMouseLeave={scheduleClose}
      >
        <button
          type="button"
          className={`nav-drop-parent${active ? " active" : ""}`}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-controls="nav-slips-menu"
          onClick={(e) => (isOpen ? closeGroup() : openFromPills(l.label, e.currentTarget))}
        >
          {l.label}
          <span className="nav-drop-caret" aria-hidden="true">
            ▾
          </span>
        </button>
      </div>
    );
  });

  // Phone drawer: the group is an accordion row with the children inside.
  const drawerItems = links.map((l) => {
    if (isLeaf(l)) {
      const active = l.exact ? pathname === l.href : pathname.startsWith(l.path ?? l.href);
      return (
        <Link
          key={l.href}
          href={l.href}
          className={active ? "active" : undefined}
          onClick={() => setOpen(false)}
        >
          {l.label}
        </Link>
      );
    }
    const active = groupActive(l, pathname);
    const isOpen = openGroup === l.label;
    return (
      <div key={l.label} className={`nav-drop nav-drop-in-drawer${isOpen ? " open" : ""}`}>
        <button
          type="button"
          className={`nav-drop-parent${active ? " active" : ""}`}
          aria-expanded={isOpen}
          aria-controls="nav-slips-drawer-menu"
          onClick={() => {
            cancelClose();
            setMenuPos(null);
            setOpenGroup(isOpen ? null : l.label);
          }}
        >
          {l.label}
          <span className="nav-drop-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <div className="nav-drop-menu" id="nav-slips-drawer-menu" hidden={!isOpen}>
          {l.children.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={pathname.startsWith(c.href) ? "active" : undefined}
              onClick={() => {
                closeGroup();
                setOpen(false);
              }}
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>
    );
  });

  const activeGroup = links.find((l) => !isLeaf(l) && l.label === openGroup) as NavGroup | undefined;

  const panel = (
    <>
      <div className="nav-drawer-overlay" hidden={!open} onClick={() => setOpen(false)} />
      <div id="nav-drawer" className={`nav-drawer${open ? " open" : ""}`} aria-hidden={!open}>
        <nav className="nav-drawer-links">{drawerItems}</nav>
        {/* Phone: the top-bar toggle is hidden ≤640px, so the drawer carries it. */}
        <div className="nav-drawer-foot">
          <ThemeToggle />
        </div>
      </div>
    </>
  );

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
      <nav className="nav-pills">{pillItems}</nav>
      {/* The topbar carries backdrop-filter + z-index (a stacking context and a
          containing block for fixed children), which traps the overlay/panel —
          portal them to <body> so they layer above the page instead. */}
      {mounted ? createPortal(panel, document.body) : null}
      {/* The dropdown menu also portals past the scrolling pill row. */}
      {mounted && openGroup && menuPos && activeGroup
        ? createPortal(
            <div
              className="nav-drop-menu nav-drop-menu-float"
              id="nav-slips-menu"
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {activeGroup.children.map((c) => (
                <Link key={c.href} href={c.href} role="menuitem" onClick={closeGroup}>
                  {c.label}
                </Link>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
