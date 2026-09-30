/**
 * Trusted sibling apps sharing the same Firebase project (handy-chapter), used for the
 * cross-app SSO handoff (see app/api/sso/* and components/AppShell.tsx). A comma-separated
 * list rather than a single URL so adding another app later is just an env var change, not a
 * new code path.
 */
export function getSsoPartnerUrls(): string[] {
  const raw = process.env.NEXT_PUBLIC_SSO_PARTNER_URLS || "";
  return raw
    .split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
