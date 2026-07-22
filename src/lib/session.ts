import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Lightweight single-user app auth. The user unlocks the app by entering
 * APP_PASSWORD. On success we set a signed, httpOnly cookie. Every server
 * route/page checks it with isAuthenticated().
 *
 * The cookie value is "<expiryMs>.<hmac>" where hmac = HMAC-SHA256 over the
 * expiry using APP_SESSION_SECRET. It is not a bearer of any data other than
 * "this browser proved knowledge of APP_PASSWORD before <expiry>".
 */

const COOKIE_NAME = "sfde_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error("APP_SESSION_SECRET is not set");
  return secret;
}

function sign(expiryMs: number): string {
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(String(expiryMs))
    .digest("base64url");
  return `${expiryMs}.${hmac}`;
}

function verify(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expiryStr = token.slice(0, dot);
  const expiryMs = Number(expiryStr);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return false;
  const expected = sign(expiryMs);
  // constant-time compare
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Validate the submitted password against APP_PASSWORD (constant time). */
export function checkPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionCookie() {
  const expiryMs = Date.now() + MAX_AGE_SECONDS * 1000;
  return {
    name: COOKIE_NAME,
    value: sign(expiryMs),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    },
  };
}

export function clearSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 0,
    },
  };
}

/** Read the cookie in a Server Component / Route Handler and verify it. */
export function isAuthenticated(): boolean {
  const token = cookies().get(COOKIE_NAME)?.value;
  return verify(token);
}
