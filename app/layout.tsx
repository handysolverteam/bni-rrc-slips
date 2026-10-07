import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

export const metadata: Metadata = { title: "BNI Week Slips" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Pre-paint theme resolution: stored choice wins, else the OS preference.
// Runs during body parse (before first paint), so the right palette paints on
// the very first frame — no flash of the wrong theme on reload.
const themeInit = `try{var t=localStorage.getItem("bni-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
