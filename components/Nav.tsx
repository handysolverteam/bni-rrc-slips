"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav>
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
