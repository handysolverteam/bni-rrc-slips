"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { describeAuthError, RECAPTCHA_CONTAINER_ID } from "@/lib/firebase/client";

const COUNTRY_CODES = [
  { code: "+91", label: "India (+91)" },
  { code: "+1", label: "US/Canada (+1)" },
  { code: "+44", label: "UK (+44)" },
  { code: "+971", label: "UAE (+971)" },
  { code: "+65", label: "Singapore (+65)" },
  { code: "+61", label: "Australia (+61)" },
];

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, loginWithGoogle, requestPhoneOtp, verifyPhoneOtp, cancelPhoneOtp } = useAuth();

  const [mode, setMode] = useState<"google" | "phone">("google");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);

  const phoneInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setInterval(() => setResendTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendTimer]);

  const cleanPhone = phone.replace(/\D/g, "");
  const e164Phone = `${countryCode}${cleanPhone}`;

  const handleGoogleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    setError(null);

    if (!cleanPhone || cleanPhone.length < 7) {
      setError("Please enter a valid mobile phone number.");
      return;
    }

    setBusy(true);
    try {
      await requestPhoneOtp(e164Phone);
      setStep("otp");
      setResendTimer(30);
      setOtp("");
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    void sendOtp();
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (otp.length < 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }

    setBusy(true);
    try {
      await verifyPhoneOtp(otp);
    } catch (err) {
      setError(describeAuthError(err));
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  const handleEditNumber = () => {
    cancelPhoneOtp();
    setStep("phone");
    setError(null);
    setOtp("");
  };

  return (
    <div style={{ display: "flex", minHeight: "70vh", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <h1 style={{ marginBottom: 4 }}>BNI Week Slips</h1>
          <p className="muted" style={{ margin: 0 }}>
            Sign in to continue
          </p>
        </div>

        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, padding: 4, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => {
              setMode("google");
              setError(null);
            }}
            className={mode === "google" ? "primary" : undefined}
            style={{ flex: 1, border: "none" }}
          >
            Google
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("phone");
              setError(null);
            }}
            className={mode === "phone" ? "primary" : undefined}
            style={{ flex: 1, border: "none" }}
          >
            Phone
          </button>
        </div>

        {error && (
          <div
            style={{
              border: "1px solid var(--red)",
              background: "var(--red-soft)",
              color: "var(--red)",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 13.5,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {mode === "google" ? (
          <button type="button" onClick={handleGoogleSignIn} disabled={busy} className="btn-block">
            {busy ? "Signing in..." : "Sign in with Google"}
          </button>
        ) : step === "phone" ? (
          <form onSubmit={handleSendOtp}>
            <label className="field">
              Mobile phone number
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ flexShrink: 0 }}>
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  ref={phoneInputRef}
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(null);
                  }}
                  placeholder="98765 43210"
                  style={{ flex: 1 }}
                />
              </div>
            </label>

            <button type="submit" disabled={busy || !cleanPhone} className="primary btn-block">
              {busy ? "Sending..." : "Send verification code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 10 }} className="muted">
              <span>
                Code sent to {countryCode} {cleanPhone}
              </span>
              <button type="button" onClick={handleEditNumber} style={{ border: "none", padding: 0, color: "var(--accent)" }}>
                Edit
              </button>
            </div>

            <label className="field">
              6-digit code
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                placeholder="123456"
                autoFocus
                style={{ marginTop: 6, textAlign: "center", fontSize: 20, letterSpacing: "0.4em", width: "100%" }}
              />
            </label>

            <button type="submit" disabled={busy || otp.length < 6} className="primary btn-block">
              {busy ? "Verifying..." : "Verify and continue"}
            </button>

            <div style={{ textAlign: "center", marginTop: 12, fontSize: 13 }} className="muted">
              {resendTimer > 0 ? (
                <span>Resend code in {resendTimer}s</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void sendOtp()}
                  disabled={busy}
                  style={{ border: "none", padding: 0, color: "var(--accent)" }}
                >
                  Resend code
                </button>
              )}
            </div>
          </form>
        )}

        {/* Invisible reCAPTCHA mounts here; Firebase needs this element present before
            signInWithPhoneNumber runs, so it stays in the DOM across both steps. */}
        <div id={RECAPTCHA_CONTAINER_ID} />
      </div>
    </div>
  );
}
