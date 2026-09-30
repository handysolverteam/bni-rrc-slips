import { SignJWT, createRemoteJWKSet, jwtVerify, importPKCS8 } from "jose";

/**
 * Server-only Firebase admin operations (mint custom tokens, verify ID tokens, and read/write
 * the shared Realtime Database) implemented with `jose` instead of the `firebase-admin` SDK.
 * `firebase-admin` pulls in Node-only/gRPC dependencies that don't run in Handychapter's Deno
 * edge functions; this file's logic is mirrored there (and in bni-rrc) with the same JWT
 * primitives so every side of the SSO bridge behaves identically.
 */

const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const FIREBASE_DATABASE_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!;
const ADMIN_CLIENT_EMAIL = process.env.FIREBASE_ADMIN_CLIENT_EMAIL!;
const ADMIN_PRIVATE_KEY = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n");

/** SSO exchange codes are single-use and only need to survive one redirect round trip. */
const SSO_CODE_TTL_MS = 60_000;

function assertConfigured() {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_DATABASE_URL || !ADMIN_CLIENT_EMAIL || !ADMIN_PRIVATE_KEY) {
    throw new Error(
      "Firebase admin credentials are not configured (FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY).",
    );
  }
}

let cachedPrivateKey: CryptoKey | null = null;
async function getPrivateKey(): Promise<CryptoKey> {
  cachedPrivateKey ??= await importPKCS8(ADMIN_PRIVATE_KEY, "RS256");
  return cachedPrivateKey;
}

/** Mints a Firebase custom token for `uid`, redeemable client-side via signInWithCustomToken. */
export async function mintFirebaseCustomToken(uid: string): Promise<string> {
  assertConfigured();
  const key = await getPrivateKey();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    uid,
    claims: {},
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(ADMIN_CLIENT_EMAIL)
    .setSubject(ADMIN_CLIENT_EMAIL)
    .setAudience(
      "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    )
    .sign(key);
}

const idTokenJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

/** Verifies a Firebase ID token the browser sent up, returning the signed-in user's uid. */
export async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string | null }> {
  const { payload } = await jwtVerify(idToken, idTokenJwks, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });

  if (typeof payload.sub !== "string") {
    throw new Error("ID token is missing a subject claim.");
  }

  return { uid: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

let cachedAccessToken: CachedAccessToken | null = null;

/** Google OAuth2 access token for the service account, used to call the RTDB REST API as admin. */
async function getGoogleAccessToken(): Promise<string> {
  assertConfigured();

  if (cachedAccessToken && cachedAccessToken.expiresAt - Date.now() > 60_000) {
    return cachedAccessToken.token;
  }

  const key = await getPrivateKey();
  const now = Math.floor(Date.now() / 1000);

  // Both scopes are required together -- firebase.database alone gets "Unauthorized
  // request." from the RTDB REST API even with a valid, correctly-signed assertion.
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setIssuer(ADMIN_CLIENT_EMAIL)
    .setSubject(ADMIN_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .sign(key);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to obtain Google access token: ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function rtdbFetch(path: string, init: RequestInit) {
  const accessToken = await getGoogleAccessToken();
  return fetch(`${FIREBASE_DATABASE_URL}/${path}.json`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  });
}

/** Stores a one-time SSO exchange code -> uid mapping, shared across all trusted apps via the RTDB. */
export async function putSsoExchangeCode(code: string, uid: string): Promise<void> {
  const response = await rtdbFetch(`ssoExchange/${code}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, createdAt: Date.now() }),
  });

  if (!response.ok) {
    throw new Error(`Failed to store SSO exchange code: ${await response.text()}`);
  }
}

/** Redeems a one-time SSO exchange code, deleting it so it cannot be reused. Returns the uid, or null if missing/expired. */
export async function consumeSsoExchangeCode(code: string): Promise<string | null> {
  const getResponse = await rtdbFetch(`ssoExchange/${code}`, { method: "GET" });
  if (!getResponse.ok) {
    throw new Error(`Failed to read SSO exchange code: ${await getResponse.text()}`);
  }

  const record = (await getResponse.json()) as { uid: string; createdAt: number } | null;

  // Always delete on read so a leaked/reused code cannot be redeemed twice.
  await rtdbFetch(`ssoExchange/${code}`, { method: "DELETE" }).catch(() => {});

  if (!record || Date.now() - record.createdAt > SSO_CODE_TTL_MS) {
    return null;
  }

  return record.uid;
}
