import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { checkEnv, assertEnv } from "./env";

const VARS = [
  "APP_PASSWORD",
  "APP_SESSION_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "CREDENTIALS_ENCRYPTION_KEY",
  "CREDENTIALS_ENCRYPTION_KEYS",
  "CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID",
  "APP_BASE_URL",
];

function clear() {
  for (const v of VARS) delete process.env[v];
}

function setAllValid() {
  process.env.APP_PASSWORD = "pw";
  process.env.APP_SESSION_SECRET = "secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.CREDENTIALS_ENCRYPTION_KEY = crypto
    .randomBytes(32)
    .toString("base64");
}

function checkFor(name: string) {
  return checkEnv().checks.find((c) => c.name === name)!;
}

beforeEach(clear);
afterEach(clear);

describe("checkEnv", () => {
  it("passes when all required vars are valid", () => {
    setAllValid();
    process.env.APP_BASE_URL = "https://app.example.com";
    const { ok, checks } = checkEnv();
    expect(ok).toBe(true);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("fails when a required var is missing", () => {
    setAllValid();
    delete process.env.APP_SESSION_SECRET;
    const { ok } = checkEnv();
    expect(ok).toBe(false);
    expect(checkFor("APP_SESSION_SECRET").ok).toBe(false);
  });

  it("flags a malformed Supabase URL", () => {
    setAllValid();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    expect(checkFor("NEXT_PUBLIC_SUPABASE_URL").ok).toBe(false);
    expect(checkEnv().ok).toBe(false);
  });

  it("fails when the encryption key is invalid (wrong length)", () => {
    setAllValid();
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.from("tooshort").toString(
      "base64"
    );
    const c = checkFor("CREDENTIALS_ENCRYPTION_KEY");
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/32 bytes/);
  });

  it("treats APP_BASE_URL as recommended, not required", () => {
    setAllValid(); // APP_BASE_URL left unset
    const c = checkFor("APP_BASE_URL");
    expect(c.required).toBe(false);
    expect(c.ok).toBe(false);
    expect(checkEnv().ok).toBe(true); // overall still ok
  });
});

describe("assertEnv", () => {
  it("does not throw when config is valid", () => {
    setAllValid();
    expect(() => assertEnv()).not.toThrow();
  });

  it("throws an aggregated message listing the bad vars", () => {
    setAllValid();
    delete process.env.APP_PASSWORD;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertEnv()).toThrow(/Environment misconfiguration/);
    expect(() => assertEnv()).toThrow(/APP_PASSWORD/);
    expect(() => assertEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
