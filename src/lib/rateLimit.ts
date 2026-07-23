/**
 * In-memory, per-key rate limiter with lockout — the first-line defense against
 * brute-forcing the single shared APP_PASSWORD on the login endpoint.
 *
 * Caveat: on Vercel this state lives in one warm serverless instance and resets
 * on cold start / scales per-instance, so it is a baseline, not a hard limit. A
 * durable limiter (Upstash Redis / Vercel WAF) is tracked in TODO.md — but even
 * this stops naive scripted guessing that a stateless endpoint would allow.
 */

type Entry = {
  fails: number;
  windowStart: number;
  lockedUntil: number;
};

const MAX_FAILS = 5; // failed attempts allowed per window before lockout
const WINDOW_MS = 15 * 60 * 1000; // rolling window for counting failures
const LOCKOUT_MS = 15 * 60 * 1000; // how long a key stays locked out
const MAX_ENTRIES = 5000; // bound memory against key-space flooding

const attempts = new Map<string, Entry>();

function prune(now: number): void {
  for (const [key, e] of attempts) {
    if (e.lockedUntil < now && now - e.windowStart > WINDOW_MS) {
      attempts.delete(key);
    }
  }
  // Hard cap if a flood of unique keys still leaves the map oversized.
  if (attempts.size > MAX_ENTRIES) {
    const excess = attempts.size - MAX_ENTRIES;
    let i = 0;
    for (const key of attempts.keys()) {
      attempts.delete(key);
      if (++i >= excess) break;
    }
  }
}

/** Non-mutating check. Returns retryAfterSec when the key is currently locked. */
export function checkRateLimit(key: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const e = attempts.get(key);
  if (e && e.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

/** Record a failed attempt; may transition the key into a lockout. */
export function recordFailure(key: string): {
  locked: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  let e = attempts.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) {
    e = { fails: 0, windowStart: now, lockedUntil: 0 };
  }
  e.fails += 1;
  if (e.fails >= MAX_FAILS) {
    e.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(key, e);
  if (attempts.size > MAX_ENTRIES) prune(now);
  return e.lockedUntil > now
    ? { locked: true, retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000) }
    : { locked: false };
}

/** Clear a key's failure history after a successful auth. */
export function recordSuccess(key: string): void {
  attempts.delete(key);
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
