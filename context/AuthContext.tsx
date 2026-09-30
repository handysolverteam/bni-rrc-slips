"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type ConfirmationResult, type User as FirebaseUser } from "firebase/auth";
import {
  firebaseAuth,
  signInWithGoogleFirebase,
  signOutFirebase,
  sendPhoneOtp,
  confirmPhoneOtp,
  clearRecaptcha,
} from "@/lib/firebase/client";
import { getSsoPartnerUrls } from "@/lib/sso-partners";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber: string | null;
}

function fromFirebaseUser(fbUser: FirebaseUser): AuthUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: fbUser.displayName || fbUser.email?.split("@")[0] || fbUser.phoneNumber || "Member",
    photoURL: fbUser.photoURL,
    phoneNumber: fbUser.phoneNumber,
  };
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  /** Sends an SMS code to an E.164 number. Call verifyPhoneOtp() next. */
  requestPhoneOtp: (e164Phone: string) => Promise<void>;
  /** Completes phone sign-in with the code from the SMS. */
  verifyPhoneOtp: (code: string) => Promise<void>;
  /** Discards a pending OTP challenge (e.g. the user went back to edit the number). */
  cancelPhoneOtp: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginWithGoogle: async () => {},
  requestPhoneOtp: async () => {},
  verifyPhoneOtp: async () => {},
  cancelPhoneOtp: () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const phoneConfirmationRef = useRef<ConfirmationResult | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (fbUser) => {
      setUser(fbUser ? fromFirebaseUser(fbUser) : null);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const loginWithGoogle = async () => {
    await signInWithGoogleFirebase();
  };

  /**
   * Step 1 of phone sign-in. The ConfirmationResult is held in a ref rather than state
   * because it is a non-serialisable handle used only by the verify step.
   */
  const requestPhoneOtp = async (e164Phone: string) => {
    phoneConfirmationRef.current = await sendPhoneOtp(e164Phone);
  };

  /** Step 2 of phone sign-in. onAuthStateChanged picks the session up from here. */
  const verifyPhoneOtp = async (code: string) => {
    const confirmation = phoneConfirmationRef.current;
    if (!confirmation) {
      throw new Error("That verification session has expired. Request a new code.");
    }
    await confirmPhoneOtp(confirmation, code);
    phoneConfirmationRef.current = null;
  };

  const cancelPhoneOtp = () => {
    phoneConfirmationRef.current = null;
    clearRecaptcha();
  };

  const logout = async () => {
    cancelPhoneOtp();
    await signOutFirebase();

    // Best-effort: ask every trusted sibling app to sign out too, so logging out here
    // doesn't leave a stale session on any of them. Loaded in hidden iframes rather than
    // fetched, since each needs to run its own JS against its own local session storage.
    for (const partnerUrl of getSsoPartnerUrls()) {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = `${partnerUrl}/?sso=logout`;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 5000);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, loginWithGoogle, requestPhoneOtp, verifyPhoneOtp, cancelPhoneOtp, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
