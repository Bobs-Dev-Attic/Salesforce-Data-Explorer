import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

// A valid 32-byte key must exist before the module reads the env var.
beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = crypto
    .randomBytes(32)
    .toString("base64");
});

describe("crypto encrypt/decrypt", () => {
  it("round-trips a value", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const secret = "refresh-token-abc123!@#";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("round-trips unicode and empty strings", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    for (const s of ["", "🔐 café ☃", "a".repeat(5000)]) {
      expect(decrypt(encrypt(s))).toBe(s);
    }
  });

  it("produces a distinct ciphertext each call (random IV)", async () => {
    const { encrypt } = await import("./crypto");
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("uses the iv:authTag:ciphertext format", async () => {
    const { encrypt } = await import("./crypto");
    expect(encrypt("x").split(":")).toHaveLength(3);
  });

  it("rejects a tampered auth tag", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const [iv, , data] = encrypt("secret").split(":");
    const forgedTag = Buffer.alloc(16).toString("base64");
    expect(() => decrypt(`${iv}:${forgedTag}:${data}`)).toThrow();
  });

  it("rejects a malformed payload", async () => {
    const { decrypt } = await import("./crypto");
    expect(() => decrypt("not-valid")).toThrow(/Malformed/);
  });
});
