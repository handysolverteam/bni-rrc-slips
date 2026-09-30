import { consumeSsoExchangeCode, mintFirebaseCustomToken } from "@/lib/firebase/admin";

/**
 * Called by AppShell's `?sso=callback` handling with the code a partner app issued. Redeems
 * the code (one-time, ~60s TTL) and mints a Firebase custom token so the browser can call
 * signInWithCustomToken() here without ever showing a login form.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code;

  if (!code) {
    return Response.json({ error: "Missing code." }, { status: 400 });
  }

  try {
    const uid = await consumeSsoExchangeCode(code);
    if (!uid) {
      return Response.json({ error: "That sign-in link has expired." }, { status: 400 });
    }

    const token = await mintFirebaseCustomToken(uid);
    return Response.json({ token });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to complete SSO sign-in." },
      { status: 500 },
    );
  }
}
