import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

export const metadata: Metadata = { title: "BNI Week Slips" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
