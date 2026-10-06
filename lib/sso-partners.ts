/**
 * Every other app sharing this Firebase project, used to broadcast logout (see
 * context/AuthContext.tsx) so signing out here clears sessions everywhere else too. A
 * comma-separated list rather than a single URL so adding another app later is just an env
 * var change, not a new code path.
 */
export function getSsoPartnerUrls(): string[] {
  const raw = process.env.NEXT_PUBLIC_SSO_PARTNER_URLS || "";
  return raw
    .split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * The single authentication hub (Handychapter) this app defers to for login: when there's no
 * local session, the user is sent here to authenticate, then bounced back. Unlike the partner
 * list above, this is deliberately singular -- there is exactly one place users log in.
 */
export function getSsoHubUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_SSO_HUB_URL || "").trim().replace(/\/$/, "");
  return raw || null;
}

/**
 * Set once per browser tab after the first hub check, so a down/misconfigured hub falls
 * through to this app's own /login instead of looping. Must be cleared on every sign-out
 * (both a direct click here and a `?sso=logout` ping from another app) -- otherwise logging
 * back in within the same tab skips the hub and shows the local login page instead.
 */
export const SSO_ATTEMPTED_KEY = "bniRrcSlipsSsoAttempted";

export function clearSsoAttempted() {
  try {
    sessionStorage.removeItem(SSO_ATTEMPTED_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
