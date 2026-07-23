import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// Two independent 32-byte keys for rotation scenarios.
const KEY_V1 = crypto.randomBytes(32).toString("base64");
const KEY_V2 = crypto.randomBytes(32).toString("base64");

const ENV_KEYS = [
  "CREDENTIALS_ENCRYPTION_KEY",
  "CREDENTIALS_ENCRYPTION_KEYS",
  "CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID",
];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

// Re-import the module fresh so nothing is cached across env changes.
async function loadCrypto() {
  return import("./crypto");
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("keyring / rotation", () => {
  it("throws when no key is configured", async () => {
    const { encrypt } = await loadCrypto();
    expect(() => encrypt("x")).toThrow(/No encryption key/);
  });

  it("legacy key alone is used as active id v1", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_V1;
    const { encrypt, decrypt, activeKeyId } = await loadCrypto();
    expect(activeKeyId()).toBe("v1");
    const ct = encrypt("hello");
    expect(ct.split(":")[0]).toBe("v1");
    expect(decrypt(ct)).toBe("hello");
  });

  it("encrypts with the active key but decrypts data written by any key", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_V1;
    process.env.CREDENTIALS_ENCRYPTION_KEYS = `v2:${KEY_V2}`;
    process.env.CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID = "v2";
    const { encrypt, decrypt, activeKeyId, isUnderActiveKey } = await loadCrypto();

    expect(activeKeyId()).toBe("v2");
    const ct = encrypt("secret");
    expect(ct.split(":")[0]).toBe("v2");
    expect(isUnderActiveKey(ct)).toBe(true);
    expect(decrypt(ct)).toBe("secret");
  });

  it("re-encrypts old-key data onto the active key", async () => {
    // Write under v1 (v1 active), then rotate to v2 and reencrypt.
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_V1;
    const first = await loadCrypto();
    const underV1 = first.encrypt("rotate-me");
    expect(underV1.split(":")[0]).toBe("v1");

    // Rotate: both keys present, active = v2.
    process.env.CREDENTIALS_ENCRYPTION_KEYS = `v2:${KEY_V2}`;
    process.env.CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID = "v2";
    const rotated = await loadCrypto();

    expect(rotated.isUnderActiveKey(underV1)).toBe(false);
    // Old data still readable (v1 kept in the ring).
    expect(rotated.decrypt(underV1)).toBe("rotate-me");
    const underV2 = rotated.reencrypt(underV1);
    expect(underV2.split(":")[0]).toBe("v2");
    expect(rotated.isUnderActiveKey(underV2)).toBe(true);
    expect(rotated.decrypt(underV2)).toBe("rotate-me");
  });

  it("throws when the key that wrote a payload is not in the ring", async () => {
    // Encrypt under a key that we then remove from the ring.
    process.env.CREDENTIALS_ENCRYPTION_KEYS = `vX:${KEY_V2}`;
    process.env.CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID = "vX";
    const withKey = await loadCrypto();
    const ct = withKey.encrypt("orphan");

    clearEnv();
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_V1; // ring no longer has vX
    const withoutKey = await loadCrypto();
    expect(() => withoutKey.decrypt(ct)).toThrow(/No encryption key "vX"/);
  });

  it("rejects an active id that is not in the keyring", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY_V1;
    process.env.CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID = "nope";
    const { encrypt } = await loadCrypto();
    expect(() => encrypt("x")).toThrow(/not in the keyring/);
  });

  it("rejects a malformed keyring entry", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEYS = "not-an-entry";
    const { encrypt } = await loadCrypto();
    expect(() => encrypt("x")).toThrow(/id:base64/);
  });
});
