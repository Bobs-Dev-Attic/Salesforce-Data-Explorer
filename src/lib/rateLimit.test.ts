import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  recordFailure,
  recordSuccess,
  clientIp,
} from "./rateLimit";

// Each test uses a unique key so the module-level Map doesn't leak state.
let n = 0;
function freshKey() {
  return `ip-${n++}-${Math.random()}`;
}

describe("rate limiter", () => {
  it("allows a fresh key", () => {
    expect(checkRateLimit(freshKey()).allowed).toBe(true);
  });

  it("allows up to 4 failures, then locks on the 5th", () => {
    const key = freshKey();
    for (let i = 0; i < 4; i++) {
      const r = recordFailure(key);
      expect(r.locked).toBe(false);
      expect(checkRateLimit(key).allowed).toBe(true);
    }
    const fifth = recordFailure(key);
    expect(fifth.locked).toBe(true);
    expect(fifth.retryAfterSec).toBeGreaterThan(0);
  });

  it("reports the key as not allowed once locked, with a retry-after", () => {
    const key = freshKey();
    for (let i = 0; i < 5; i++) recordFailure(key);
    const check = checkRateLimit(key);
    expect(check.allowed).toBe(false);
    expect(check.retryAfterSec).toBeGreaterThan(0);
  });

  it("clears the counter on success", () => {
    const key = freshKey();
    for (let i = 0; i < 5; i++) recordFailure(key);
    expect(checkRateLimit(key).allowed).toBe(false);
    recordSuccess(key);
    expect(checkRateLimit(key).allowed).toBe(true);
  });

  it("keeps distinct keys independent", () => {
    const a = freshKey();
    const b = freshKey();
    for (let i = 0; i < 5; i++) recordFailure(a);
    expect(checkRateLimit(a).allowed).toBe(false);
    expect(checkRateLimit(b).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(h)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "198.51.100.2" });
    expect(clientIp(h)).toBe("198.51.100.2");
  });

  it("returns 'unknown' when no proxy headers are present", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
