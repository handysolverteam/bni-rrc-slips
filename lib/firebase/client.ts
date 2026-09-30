import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const firebaseAuth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogleFirebase() {
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  return result.user;
}

export async function signOutFirebase() {
  return firebaseSignOut(firebaseAuth);
}

/** Element id the invisible reCAPTCHA widget mounts into. */
export const RECAPTCHA_CONTAINER_ID = "firebase-recaptcha-container";

let recaptchaVerifier: RecaptchaVerifier | null = null;

/** Tears down the reCAPTCHA widget so the next send starts from a clean one. */
export function clearRecaptcha() {
  try {
    recaptchaVerifier?.clear();
  } catch {
    // Widget may already be detached; nothing to clean up.
  }
  recaptchaVerifier = null;

  const container = document.getElementById(RECAPTCHA_CONTAINER_ID);
  if (container) container.innerHTML = "";
}

/**
 * Sends a 6-digit SMS code to an E.164 number (e.g. +919876543210).
 *
 * A reCAPTCHA token is single-use: reusing a verifier makes the second send fail with
 * 'auth/internal-error'. So the widget is rebuilt on every send, including resends.
 */
export async function sendPhoneOtp(e164Phone: string): Promise<ConfirmationResult> {
  clearRecaptcha();

  recaptchaVerifier = new RecaptchaVerifier(firebaseAuth, RECAPTCHA_CONTAINER_ID, {
    size: "invisible",
  });

  try {
    return await signInWithPhoneNumber(firebaseAuth, e164Phone, recaptchaVerifier);
  } catch (error) {
    // A failed attempt leaves the widget in a state that cannot be reused.
    clearRecaptcha();
    throw error;
  }
}

/** Completes phone sign-in with the code the user received. */
export async function confirmPhoneOtp(confirmation: ConfirmationResult, code: string) {
  const result = await confirmation.confirm(code);
  clearRecaptcha();
  return result.user;
}

/** Turns Firebase auth error codes into something a user can act on. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "auth/invalid-phone-number":
      return "That phone number is not valid. Include your country code and try again.";
    case "auth/missing-phone-number":
      return "Please enter a phone number.";
    case "auth/quota-exceeded":
      return "SMS quota for this project has been exhausted. Try again later.";
    case "auth/too-many-requests":
      return "Too many attempts from this device. Wait a few minutes and try again.";
    case "auth/invalid-verification-code":
      return "That code is incorrect. Check the SMS and try again.";
    case "auth/code-expired":
      return "That code has expired. Request a new one.";
    case "auth/captcha-check-failed":
      return "Verification check failed. Reload the page and try again.";
    case "auth/operation-not-allowed":
      return "Phone sign-in is not enabled for this project. Enable it in Firebase Console -> Authentication -> Sign-in method -> Phone.";
    case "auth/unauthorized-domain":
      return "This domain is not authorised for sign-in. Add it in Firebase Console -> Authentication -> Settings -> Authorized domains.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/web-storage-unsupported":
      return "Your browser is blocking the storage sign-in needs. Enable cookies for this site, or try a normal (non-private) window.";
    default:
      return error instanceof Error ? error.message : "Authentication failed. Please try again.";
  }
}
