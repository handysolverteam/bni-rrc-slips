import { randomUUID } from "crypto";
import { verifyFirebaseIdToken, putSsoExchangeCode } from "@/lib/firebase/admin";

/**
 * Called by AppShell's `?sso=issue` handling when this app already has an active session, so
 * a partner app (which has none) can silently sign the user in too. The caller proves who they
 * are with their own Firebase ID token; this exchanges it for a short-lived, single-use code
 * rather than handing back a raw custom token, so a code leaked via browser history/logs is
 * far less useful than a bearer credential would be.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!idToken) {
    return Response.json({ error: "Missing bearer token." }, { status: 401 });
  }

  try {
    const { uid } = await verifyFirebaseIdToken(idToken);
    const code = randomUUID();
    await putSsoExchangeCode(code, uid);
    return Response.json({ code });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to issue SSO code." },
      { status: 401 },
    );
  }
}
