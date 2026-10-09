"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import Nav from "@/components/Nav";
import NoAccess from "@/components/NoAccess";
import TenantSwitcher from "@/components/TenantSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { firebaseAuth, signOutFirebase } from "@/lib/firebase/client";
import { getSsoHubUrl, getSsoPartnerUrls, SSO_ATTEMPTED_KEY, clearSsoAttempted } from "@/lib/sso-partners";
import { isSafeInternalPath, isSafeSsoReturnUrl } from "@/lib/sso-guard";

const PUBLIC_PATHS = ["/login"];

/** The last bootstrap result, kept for the browser session so a page load paints the
 *  shell at once and re-checks in the background (instead of waiting on 3-4 requests). */
const SHELL_KEY = "bni-shell-v1";
type ShellCache = { uid: string; tenants: { id: string; name: string }[]; tenant: { id: string; name: string } | null };
function readShell(uid: string): ShellCache | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SHELL_KEY) ?? "null") as ShellCache | null;
    return v && v.uid === uid && Array.isArray(v.tenants) ? v : null;
  } catch {
    return null;
  }
}
function writeShell(v: ShellCache | null) {
  try {
    if (v) sessionStorage.setItem(SHELL_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(SHELL_KEY);
  } catch {
    // storage unavailable — just no caching
  }
}

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

  // Session + tenant bootstrap: after Firebase auth resolves, exchange the ID
  // token for the HttpOnly session cookie and load this user's chapters.
  // Children are NOT rendered until this finishes, so no page fetch races a
  // missing cookie (which would redirect to /login while already signed in).
  const [tenantState, setTenantState] = useState<"loading" | "ready" | "noaccess">("loading");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [activeTenant, setActiveTenant] = useState<{ id: string; name: string } | null>(null);
  const [noAccessUid, setNoAccessUid] = useState<string | null>(null);
  const tenantBootstrapped = useRef(false);

  useEffect(() => {
    if (loading || !user || isPublicPath) return;
    if (tenantBootstrapped.current) return;
    tenantBootstrapped.current = true;

    // Paint from the cached shell immediately; the request below refreshes it.
    const cachedShell = readShell(user.uid);
    if (cachedShell) {
      setTenants(cachedShell.tenants);
      setActiveTenant(cachedShell.tenant);
      setTenantState("ready");
    }

    (async () => {
      try {
        const idToken = await firebaseAuth.currentUser?.getIdToken();
        if (!idToken) return;
        // ONE request: sets the session cookie AND returns this user's chapters.
        const sessionRes = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (!sessionRes.ok) return;
        const info = (await sessionRes.json()) as {
          uid?: string | null;
          tenant?: { id: string; name: string } | null;
          tenants?: { id: string; name: string }[];
          noAccess?: boolean;
        };
        if (info.noAccess) {
          writeShell(null);
          setNoAccessUid(info.uid ?? user.uid);
          setTenantState("noaccess");
        } else {
          setTenants(info.tenants ?? []);
          setActiveTenant(info.tenant ?? null);
          setTenantState("ready");
          writeShell({ uid: user.uid, tenants: info.tenants ?? [], tenant: info.tenant ?? null });
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
        // Fast path: the claims already on the cached token (no network). A
        // forced refresh follows in the background so a revoked grant still
        // takes effect within seconds — it just no longer blocks the first paint.
        const quick = await firebaseAuth.currentUser?.getIdTokenResult();
        if (quick?.claims.slips === true) setAccessState("granted");
        const fresh = await firebaseAuth.currentUser?.getIdTokenResult(true);
        setAccessState(fresh?.claims.slips === true ? "granted" : "denied");
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
        <Nav />
        <TenantSwitcher tenants={tenants} activeId={activeTenant?.id ?? null} />
        <ThemeToggle />
        <UserMenu />
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}
