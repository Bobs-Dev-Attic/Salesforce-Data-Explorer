import { describe, it, expect, beforeEach, vi } from "vitest";

// Mutable state shared with the mocks (hoisted so the vi.mock factories can see it).
const state = vi.hoisted(() => ({
  epoch: 1,
  store: {} as Record<string, string>,
}));

vi.mock("./appSettings", () => ({
  getSessionEpoch: async () => state.epoch,
  bumpSessionEpoch: async () => ++state.epoch,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      state.store[name] ? { value: state.store[name] } : undefined,
  }),
}));

import { createSessionCookie, isAuthenticated } from "./session";

beforeEach(() => {
  process.env.APP_SESSION_SECRET = "test-session-secret";
  state.epoch = 1;
  state.store = {};
});

async function setActiveCookie() {
  const cookie = await createSessionCookie();
  state.store[cookie.name] = cookie.value;
  return cookie;
}

describe("session epoch / revocation", () => {
  it("mints a 3-segment cookie (expiry.epoch.hmac)", async () => {
    const cookie = await createSessionCookie();
    expect(cookie.value.split(".")).toHaveLength(3);
    expect(cookie.value.split(".")[1]).toBe("1"); // current epoch
  });

  it("authenticates a valid cookie under the current epoch", async () => {
    await setActiveCookie();
    expect(await isAuthenticated()).toBe(true);
  });

  it("rejects the cookie once the epoch is bumped (revocation)", async () => {
    await setActiveCookie();
    expect(await isAuthenticated()).toBe(true);
    state.epoch = 2; // simulate "sign out all sessions"
    expect(await isAuthenticated()).toBe(false);
  });

  it("rejects a tampered cookie", async () => {
    const cookie = await setActiveCookie();
    state.store[cookie.name] = cookie.value.slice(0, -2) + "xx";
    expect(await isAuthenticated()).toBe(false);
  });

  it("rejects when no cookie is present", async () => {
    expect(await isAuthenticated()).toBe(false);
  });

  it("rejects a legacy 2-segment cookie (pre-epoch format)", async () => {
    const cookie = await createSessionCookie();
    const [expiry, , hmac] = cookie.value.split(".");
    state.store[cookie.name] = `${expiry}.${hmac}`; // old format
    expect(await isAuthenticated()).toBe(false);
  });
});
