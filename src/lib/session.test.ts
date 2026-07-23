import { describe, it, expect, beforeEach, vi } from "vitest";

// session.ts imports next/headers at module load; stub it so the module is
// importable in a plain node test. checkPassword/isPasswordConfigured don't
// touch cookies.
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));

import { checkPassword, isPasswordConfigured } from "./session";

describe("checkPassword", () => {
  beforeEach(() => {
    delete process.env.APP_PASSWORD;
  });

  it("returns false when APP_PASSWORD is unset", () => {
    expect(checkPassword("anything")).toBe(false);
  });

  it("accepts the exact password", () => {
    process.env.APP_PASSWORD = "s3cret-pass";
    expect(checkPassword("s3cret-pass")).toBe(true);
  });

  it("rejects a wrong password", () => {
    process.env.APP_PASSWORD = "s3cret-pass";
    expect(checkPassword("wrong")).toBe(false);
  });

  it("trims both sides (paste-artifact tolerance)", () => {
    process.env.APP_PASSWORD = "  padded  ";
    expect(checkPassword("padded")).toBe(true);
    expect(checkPassword("  padded  ")).toBe(true);
  });

  it("rejects an empty submission against an empty-after-trim env", () => {
    process.env.APP_PASSWORD = "   ";
    expect(checkPassword("")).toBe(false);
  });
});

describe("isPasswordConfigured", () => {
  beforeEach(() => {
    delete process.env.APP_PASSWORD;
  });

  it("is false when unset or blank", () => {
    expect(isPasswordConfigured()).toBe(false);
    process.env.APP_PASSWORD = "   ";
    expect(isPasswordConfigured()).toBe(false);
  });

  it("is true when a non-blank password is set", () => {
    process.env.APP_PASSWORD = "x";
    expect(isPasswordConfigured()).toBe(true);
  });
});
