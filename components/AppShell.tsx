"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import Nav from "@/components/Nav";
import NoAccess from "@/components/NoAccess";
import TenantSwitcher from "@/components/TenantSwitcher";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { firebaseAuth, signOutFirebase } from "@/lib/firebase/client";
import { getSsoPartnerUrls } from "@/lib/sso-partners";

const PUBLIC_PATHS = ["/login"];
const SSO_ATTEMPTED_KEY = "bniRrcSlipsSsoAttempted";

function Spinner() {
  return (
    <div style={{ display: "flex", minHeight: "60vh", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Spinner />}>
      <AppShellContent>{children}</AppShellContent>
    </Suspense>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  // Session + tenant bootstrap: after Firebase auth resolves, exchange the ID
  // token for the HttpOnly session cookie and load this user's chapters.
  // Children are NOT rendered until this finishes, so no page fetch races a
  // missing cookie (which would redirect to /login while already signed in).
  const [tenantState, setTenantState] = useState<"loading" | "ready" | "noaccess">("loading");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [activeTenant, setActiveTenant] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [noAccessUid, setNoAccessUid] = useState<string | null>(null);
  const tenantBootstrapped = useRef(false);

  useEffect(() => {
    if (loading || !user || isPublicPath) return;
    if (tenantBootstrapped.current) return;
    tenantBootstrapped.current = true;

    (async () => {
      try {
        const idToken = await firebaseAuth.currentUser?.getIdToken();
        if (!idToken) return;
        const sessionRes = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (!sessionRes.ok) return;
        const info = (await (await fetch("/api/tenant")).json()) as {
          uid?: string | null;
          tenant?: { id: string; name: string } | null;
          tenants?: { id: string; name: string }[];
          noAccess?: boolean;
          role?: "admin" | "member";
        };
        if (info.noAccess) {
          setNoAccessUid(info.uid ?? user.uid);
          setTenantState("noaccess");
        } else {
          setTenants(info.tenants ?? []);
          setActiveTenant(info.tenant ?? null);
          setRole(info.role ?? "admin");
          setTenantState("ready");
        }
      } catch {
        // Cookie may already exist from an earlier load; render children and
        // let the server redirect to /login if it truly is missing (that full
        // navigation remounts this shell and retries the bootstrap).
        setTenantState("ready");
      }
    })();
  }, [loading, user, isPublicPath, user?.uid]);

  /**
   * Cross-app SSO with any trusted sibling app (see lib/sso-partners.ts). The contract is
   * `?sso=issue|callback|logout` on any app's root URL rather than dedicated paths, since some
   * sibling apps (Handychapter) are SPAs with no server-side rewrites and can only reliably
   * serve `/` -- a query-string contract works on literally any host/stack.
   */
  const ssoParam = searchParams.get("sso");
  const isKnownSsoParam = ssoParam === "issue" || ssoParam === "callback" || ssoParam === "logout";
  const ssoHandledRef = useRef(false);
  const [ssoBusy, setSsoBusy] = useState(isKnownSsoParam);

  useEffect(() => {
    if (!isKnownSsoParam || ssoHandledRef.current) return;

    if (ssoParam === "logout") {
      ssoHandledRef.current = true;
      window.history.replaceState({}, "", pathname);
      void signOutFirebase().finally(() => setSsoBusy(false));
      return;
    }

    if (ssoParam === "callback") {
      ssoHandledRef.current = true;
      const code = searchParams.get("ssoCode");
      const redirectPath = searchParams.get("redirect") || "/";
      const partnerIndex = Number(searchParams.get("partnerIndex") || "0");
      window.history.replaceState({}, "", pathname);

      const tryNextPartner = () => {
        const partners = getSsoPartnerUrls();
        const nextIndex = partnerIndex + 1;
        if (nextIndex < partners.length) {
          const callback = `${window.location.origin}/?sso=callback&redirect=${encodeURIComponent(redirectPath)}&partnerIndex=${nextIndex}`;
          window.location.replace(`${partners[nextIndex]}/?sso=issue&return=${encodeURIComponent(callback)}`);
        } else {
          router.replace("/login");
          setSsoBusy(false);
        }
      };

      if (!code || code === "none") {
        tryNextPartner();
        return;
      }

      (async () => {
        try {
          const response = await fetch("/api/sso/consume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });

          if (!response.ok) {
            tryNextPartner();
            return;
          }

          const { token } = (await response.json()) as { token: string };
          await signInWithCustomToken(firebaseAuth, token);
          router.replace(redirectPath);
          setSsoBusy(false);
        } catch {
          tryNextPartner();
        }
      })();
      return;
    }

    if (ssoParam === "issue") {
      // Wait for Firebase to finish restoring any persisted session before answering.
      if (loading) return;
      ssoHandledRef.current = true;

      const returnUrl = searchParams.get("return");
      const finish = (query: string) => {
        if (!returnUrl) return;
        const separator = returnUrl.includes("?") ? "&" : "?";
        window.location.replace(`${returnUrl}${separator}${query}`);
      };

      if (!user) {
        finish("ssoCode=none");
        return;
      }

      (async () => {
        try {
          const idToken = await firebaseAuth.currentUser?.getIdToken();
          if (!idToken) {
            finish("ssoCode=none");
            return;
          }

          const response = await fetch("/api/sso/issue", {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}` },
          });

          if (!response.ok) {
            finish("ssoCode=none");
            return;
          }

          const { code } = (await response.json()) as { code: string };
          finish(`ssoCode=${code}`);
        } catch {
          finish("ssoCode=none");
        }
      })();
      return;
    }
  }, [ssoParam, isKnownSsoParam, loading, user, pathname, router, searchParams]);

  useEffect(() => {
    if (ssoBusy || loading || user || isPublicPath) return;

    // Before showing our own login screen, check once per browser session whether any
    // trusted sibling app already has this user signed in, so a session on one app carries
    // over to the others without asking them to log in again.
    const partners = getSsoPartnerUrls();
    if (partners.length > 0 && !sessionStorage.getItem(SSO_ATTEMPTED_KEY)) {
      sessionStorage.setItem(SSO_ATTEMPTED_KEY, "1");
      const callback = `${window.location.origin}/?sso=callback&redirect=${encodeURIComponent(pathname)}&partnerIndex=0`;
      window.location.replace(`${partners[0]}/?sso=issue&return=${encodeURIComponent(callback)}`);
      return;
    }

    router.replace("/login");
  }, [ssoBusy, loading, user, isPublicPath, pathname, router]);

  if (ssoBusy) {
    return <Spinner />;
  }

  if (isPublicPath) {
    return <>{children}</>;
  }

  if (loading || !user) {
    return <Spinner />;
  }

  if (tenantState === "loading") {
    return <Spinner />;
  }

  if (tenantState === "noaccess") {
    return <NoAccess uid={noAccessUid ?? user.uid} />;
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-badge">BNI</span>
          <span className="brand-name">Week Slips</span>
        </a>
        <Nav role={role} />
        <TenantSwitcher tenants={tenants} activeId={activeTenant?.id ?? null} />
        <UserMenu />
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
