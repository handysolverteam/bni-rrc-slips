"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import Nav from "@/components/Nav";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { firebaseAuth, signOutFirebase } from "@/lib/firebase/client";
import { getSsoHubUrl, getSsoPartnerUrls, SSO_ATTEMPTED_KEY, clearSsoAttempted } from "@/lib/sso-partners";
import { isSafeInternalPath, isSafeSsoReturnUrl } from "@/lib/sso-guard";

const PUBLIC_PATHS = ["/login"];

function Spinner() {
  return (
    <div style={{ display: "flex", minHeight: "60vh", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );
}

function AccessRequired() {
  const { user, logout } = useAuth();

  return (
    <div style={{ display: "flex", minHeight: "70vh", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <h1>Access required</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {user?.displayName || user?.email || "Your account"} doesn&apos;t have access to this app yet. Ask a
          Handychapter admin to grant it from the Chapter tab.
        </p>
        <button type="button" onClick={() => void logout()} className="btn-block" style={{ marginTop: 20 }}>
          Sign out
        </button>
      </div>
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

  /**
   * Cross-app SSO (see lib/sso-partners.ts). The contract is `?sso=issue|callback|logout` on
   * any app's root URL rather than dedicated paths, since Handychapter is an SPA with no
   * server-side rewrites and can only reliably serve `/` -- a query-string contract works on
   * literally any host/stack. Handychapter is the single auth hub: when this app has no
   * session it defers there rather than trying other satellites or showing its own login.
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
      clearSsoAttempted();
      void signOutFirebase().finally(() => setSsoBusy(false));
      return;
    }

    if (ssoParam === "callback") {
      ssoHandledRef.current = true;
      const code = searchParams.get("ssoCode");
      const rawRedirectPath = searchParams.get("redirect") || "/";
      const redirectPath = isSafeInternalPath(rawRedirectPath) ? rawRedirectPath : "/";
      window.history.replaceState({}, "", pathname);

      // The hub always either authenticates the user (showing its own login screen if it had
      // to) or genuinely fails -- there's no partner chain to fall through any more. A missing
      // code here is unexpected; the local /login page is the safety net.
      const bail = () => {
        router.replace("/login");
        setSsoBusy(false);
      };

      if (!code || code === "none") {
        bail();
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
            bail();
            return;
          }

          const { token } = (await response.json()) as { token: string };
          await signInWithCustomToken(firebaseAuth, token);
          router.replace(redirectPath);
          setSsoBusy(false);
        } catch {
          bail();
        }
      })();
      return;
    }

    if (ssoParam === "issue") {
      // Wait for Firebase to finish restoring any persisted session before answering.
      if (loading) return;
      ssoHandledRef.current = true;

      const returnUrl = searchParams.get("return");
      const safeReturn = isSafeSsoReturnUrl(returnUrl || "", window.location.origin, getSsoPartnerUrls());
      const finish = (query: string) => {
        if (!safeReturn) return;
        const separator = returnUrl!.includes("?") ? "&" : "?";
        window.location.replace(`${returnUrl}${separator}${query}`);
      };

      if (!safeReturn) {
        // Unguarded `return` target (missing or attacker-controlled): do not mint a code or
        // bounce anywhere. Treat the visit as a normal page load of this app.
        window.history.replaceState({}, "", pathname);
        queueMicrotask(() => setSsoBusy(false));
        return;
      }

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

  /**
   * Authorization (distinct from authentication): being signed in via the hub doesn't mean
   * this member has been granted access to THIS app. Handychapter admins grant it per member
   * via the "slips" committee tag, which sync-committee-tag mirrors into this same Firebase
   * project as a custom claim of the same name -- checked straight from the ID token, no
   * cross-database query needed. Force-refreshed once per session so a just-granted/revoked
   * change doesn't wait for the token's normal ~hour refresh cycle.
   */
  const accessCheckedRef = useRef(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "denied">("checking");

  useEffect(() => {
    if (loading || !user || accessCheckedRef.current) return;
    accessCheckedRef.current = true;

    (async () => {
      try {
        const result = await firebaseAuth.currentUser?.getIdTokenResult(true);
        setAccessState(result?.claims.slips === true ? "granted" : "denied");
      } catch {
        setAccessState("denied");
      }
    })();
  }, [loading, user]);

  useEffect(() => {
    if (ssoBusy || loading || user || isPublicPath) return;

    // No local session: defer to the single auth hub (Handychapter) rather than showing our
    // own login screen. The hub either already has a session (bounces back silently) or shows
    // its own login form and bounces back once the user completes it -- either way we land
    // back here authenticated. Once per browser session, so a down/misconfigured hub falls
    // through to our own /login (kept as a safety net) instead of looping.
    const hubUrl = getSsoHubUrl();
    if (hubUrl && !sessionStorage.getItem(SSO_ATTEMPTED_KEY)) {
      sessionStorage.setItem(SSO_ATTEMPTED_KEY, "1");
      const callback = `${window.location.origin}/?sso=callback&redirect=${encodeURIComponent(pathname)}`;
      window.location.replace(`${hubUrl}/?sso=issue&return=${encodeURIComponent(callback)}`);
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

  if (loading || !user || accessState === "checking") {
    return <Spinner />;
  }

  if (accessState === "denied") {
    return <AccessRequired />;
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-badge">BNI</span>
          <span className="brand-name">Week Slips</span>
        </a>
        <Nav />
        <UserMenu />
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
