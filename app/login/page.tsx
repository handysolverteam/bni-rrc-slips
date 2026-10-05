"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { describeAuthError } from "@/lib/firebase/client";

// Google account (email) is the only sign-in method: the user is redirected
// straight into the app, so no phone/OTP flow or reCAPTCHA container here.
export default function LoginPage() {
  const router = useRouter();
  const { user, loading, loginWithGoogle } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const handleGoogleSignIn = async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      console.error(describeAuthError(err));
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "70vh", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <h1 style={{ marginBottom: 4 }}>BNI Week Slips</h1>
          <p className="muted" style={{ margin: 0 }}>
            Sign in with your Google account to continue
          </p>
        </div>

        <button type="button" onClick={handleGoogleSignIn} disabled={loading} className="btn-block">
          Sign in with Google
        </button>
      </div>
    </div>
  );
}