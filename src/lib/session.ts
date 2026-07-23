import crypto from "crypto";
import { cookies } from "next/headers";
import { getSessionEpoch } from "./appSettings";

/**
 * Lightweight single-user app auth. The user unlocks the app by entering
 * APP_PASSWORD. On success we set a signed, httpOnly cookie. Every server
 * route/page checks it with isAuthenticated().
 *
 * The cookie value is "<expiryMs>.<epoch>.<hmac>" where hmac = HMAC-SHA256 over
 * "<expiryMs>.<epoch>" using APP_SESSION_SECRET. The epoch is a server-side
 * counter (see appSettings): a cookie is only valid while its epoch matches the
 * current one, so bumping the epoch revokes every outstanding session
 * ("sign out everywhere"). The cookie carries no data beyond "this browser
 * proved knowledge of APP_PASSWORD before <expiry>, under epoch <epoch>".
 */

const COOKIE_NAME = "sfde_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) throw new Error("APP_SESSION_SECRET is not set");
  return secret;
}

function sign(expiryMs: number, epoch: number): string {
  const payload = `${expiryMs}.${epoch}`;
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${hmac}`;
}

/**
 * Verify a token's signature and expiry (no DB). Returns the embedded epoch on
 * success so the caller can check it against the current epoch, or null if the
 * token is malformed / expired / tampered.
 */
function verifySignature(token: string | undefined): { epoch: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiryStr, epochStr] = parts;
  const expiryMs = Number(expiryStr);
  const epoch = Number(epochStr);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return null;
  if (!Number.isFinite(epoch)) return null;
  const expected = sign(expiryMs, epoch);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { epoch };
}

/** Validate the submitted password against APP_PASSWORD (constant time).
 * Both sides are trimmed so a trailing newline/space in the env var (a very
 * common paste artifact) doesn't cause a silent mismatch. */
export function checkPassword(submitted: string): boolean {
  const expected = (process.env.APP_PASSWORD || "").trim();
  if (!expected) return false;
  const a = Buffer.from(submitted.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** True when no APP_PASSWORD is configured — used to surface a clear message
 * instead of a generic "invalid password" when the app is misconfigured. */
export function isPasswordConfigured(): boolean {
  return Boolean((process.env.APP_PASSWORD || "").trim());
}

export async function createSessionCookie() {
  const expiryMs = Date.now() + MAX_AGE_SECONDS * 1000;
  const epoch = await getSessionEpoch();
  return {
    name: COOKIE_NAME,
    value: sign(expiryMs, epoch),
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

/** Read the cookie in a Server Component / Route Handler and verify it: valid
 * signature, unexpired, and minted under the current session epoch. */
export async function isAuthenticated(): Promise<boolean> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const verified = verifySignature(token);
  if (!verified) return false;
  const currentEpoch = await getSessionEpoch();
  return verified.epoch === currentEpoch;
}
