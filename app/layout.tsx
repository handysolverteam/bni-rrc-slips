import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = { title: "BNI Week Slips" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-badge">BNI</span>
            <span className="brand-name">Week Slips</span>
          </a>
          <Nav />
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
