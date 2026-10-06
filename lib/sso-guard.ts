/**
 * Validation helpers for cross-app SSO redirect targets. The `?sso=issue&return=...` and
 * `?sso=callback&redirect=...` query params ultimately drive window.location and router
 * navigation, so they must be pinned to a trusted set (this app's own origin plus the
 * configured partner origins) and to internal paths only. Without this, a crafted link can
 * bounce a signed-in user off to an attacker-controlled origin carrying a freshly minted SSO
 * exchange code, which is redeemable for a Firebase custom token.
 */

/**
 * True iff `raw` is an absolute URL whose scheme + host + port exactly matches either `selfOrigin`
 * or one of the trusted `partnerUrls`. Username/password-bearing URLs (https://host@evil.com) and
 * lookalike domains (evil.com with a partner suffix) are rejected.
 */
export function isSafeSsoReturnUrl(raw: string, selfOrigin: string, partnerUrls: string[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(selfOrigin).origin);
  } catch {
    return false;
  }
  for (const partner of partnerUrls) {
    try {
      allowed.add(new URL(partner).origin);
    } catch {
      // Unparseable partner URLs are config noise, not redirect targets; skip them.
    }
  }
  return allowed.has(url.origin);
}

/**
 * True iff `raw` is an internal (same-app) absolute path with no protocol/userinfo tricks:
 * starts with a single `/`, is not protocol-relative (`//host`), and contains no backslashes
 * or embedded schemes (`https://`).
 */
export function isSafeInternalPath(raw: string): boolean {
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//")) return false;
  if (raw.includes("\\")) return false;
  if (/[\u0000-\u001F\u007F]/.test(raw)) return false;
  return !raw.includes("://");
}