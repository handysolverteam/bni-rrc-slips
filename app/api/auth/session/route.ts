import { cookies } from "next/headers";
import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { SESSION_COOKIE, TENANT_COOKIE, tenantInfoForUid } from "@/lib/server-auth";

/**
 * Keeps the browser's HttpOnly session cookie in sync with the Firebase
 * auth state: the client POSTs the ID token after every app load, the
 * server verifies it and stores it so server components/routes can
 * authenticate without touching client state. DELETE clears both cookies
 * (sign out).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null;
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken) {
    return Response.json({ error: "Missing idToken." }, { status: 400 });
  }
  let uid: string;
  try {
    ({ uid } = await verifyFirebaseIdToken(idToken));
  } catch {
    return Response.json({ error: "Invalid or expired token." }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, idToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.VERCEL === "1",
    path: "/",
    // Firebase ID tokens live 1 hour; jwtVerify enforces exp anyway.
    maxAge: 60 * 60,
  });
  // The shell also needs the user's chapters: answer in this same request.
  const info = await tenantInfoForUid(uid, jar.get(TENANT_COOKIE)?.value).catch(() => null);
  return Response.json({ ok: true, ...(info ?? {}) });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(TENANT_COOKIE);
  return Response.json({ ok: true });
}
