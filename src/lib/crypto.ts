import crypto from "crypto";

/**
 * AES-256-GCM encryption for secrets at rest (Salesforce refresh tokens and
 * Connected App client secrets).
 *
 * Keyring / rotation
 * ------------------
 * To support key rotation without downtime, encryption uses a *keyring* of one
 * or more 32-byte keys, each identified by a short id. New data is encrypted
 * with the "active" key; any key in the ring can decrypt. To rotate: add a new
 * key, point the active id at it (new writes use it), then re-encrypt existing
 * rows (see `keyRotation.ts` / `POST /api/admin/rekey`), and finally retire the
 * old key.
 *
 * Env vars:
 *   CREDENTIALS_ENCRYPTION_KEY            legacy/primary key (id "v1"). base64 of 32 bytes.
 *   CREDENTIALS_ENCRYPTION_KEYS           optional extra keys: "id:base64,id:base64".
 *   CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID  id to encrypt new data with (default "v1").
 *
 * Ciphertext format:
 *   "<keyId>:<iv>:<authTag>:<ciphertext>"  (4 base64/text segments)
 * Legacy payloads written before rotation support have 3 segments
 *   "<iv>:<authTag>:<ciphertext>" and are decrypted with the "v1" key.
 */

const LEGACY_KEY_ID = "v1";
const KEY_ID_RE = /^[A-Za-z0-9_-]+$/;

interface Keyring {
  keys: Map<string, Buffer>;
  activeId: string;
}

function decodeKey(raw: string, label: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(
      `${label} must decode to 32 bytes (base64 of 32 random bytes)`
    );
  }
  return key;
}

// Env is static at runtime, but we parse per call (cheap; keeps tests simple and
// avoids stale caches). Encryption isn't a hot path — access tokens are cached.
function loadKeyring(): Keyring {
  const keys = new Map<string, Buffer>();

  const legacy = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (legacy && legacy.trim()) {
    keys.set(LEGACY_KEY_ID, decodeKey(legacy, "CREDENTIALS_ENCRYPTION_KEY"));
  }

  const extra = process.env.CREDENTIALS_ENCRYPTION_KEYS;
  if (extra && extra.trim()) {
    for (const entry of extra.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx < 0) {
        throw new Error(
          'CREDENTIALS_ENCRYPTION_KEYS entries must be "id:base64"'
        );
      }
      const id = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!KEY_ID_RE.test(id)) {
        throw new Error(
          `Invalid encryption key id "${id}" (allowed: A-Z a-z 0-9 _ -)`
        );
      }
      keys.set(id, decodeKey(val, `CREDENTIALS_ENCRYPTION_KEYS[${id}]`));
    }
  }

  if (keys.size === 0) {
    throw new Error(
      "No encryption key configured (set CREDENTIALS_ENCRYPTION_KEY)"
    );
  }

  const requested = process.env.CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID?.trim();
  let activeId: string;
  if (requested) {
    if (!keys.has(requested)) {
      throw new Error(
        `CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID "${requested}" is not in the keyring`
      );
    }
    activeId = requested;
  } else {
    // Default to the legacy key for backward compatibility, else the first key.
    activeId = keys.has(LEGACY_KEY_ID)
      ? LEGACY_KEY_ID
      : [...keys.keys()][0];
  }

  return { keys, activeId };
}

/** The id of the key new data is currently encrypted with. */
export function activeKeyId(): string {
  return loadKeyring().activeId;
}

export function encrypt(plaintext: string): string {
  const { keys, activeId } = loadKeyring();
  const key = keys.get(activeId) as Buffer;
  const iv = crypto.randomBytes(12); // 96-bit nonce recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    activeId,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** The key id a stored payload was encrypted under. */
function keyIdOf(payload: string): string {
  const parts = payload.split(":");
  if (parts.length === 4) return parts[0];
  if (parts.length === 3) return LEGACY_KEY_ID;
  throw new Error("Malformed encrypted payload");
}

export function decrypt(payload: string): string {
  const { keys } = loadKeyring();
  const parts = payload.split(":");
  let keyId: string;
  let ivB64: string;
  let tagB64: string;
  let dataB64: string;
  if (parts.length === 4) {
    [keyId, ivB64, tagB64, dataB64] = parts;
  } else if (parts.length === 3) {
    keyId = LEGACY_KEY_ID;
    [ivB64, tagB64, dataB64] = parts;
  } else {
    throw new Error("Malformed encrypted payload");
  }
  const key = keys.get(keyId);
  if (!key) {
    throw new Error(
      `No encryption key "${keyId}" is available to decrypt this value (check the keyring / rotation config)`
    );
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Decrypt with whichever key wrote a payload, then re-encrypt with the active key. */
export function reencrypt(payload: string): string {
  return encrypt(decrypt(payload));
}

/** True when a payload is already encrypted under the active key (no rewrite needed). */
export function isUnderActiveKey(payload: string): boolean {
  return keyIdOf(payload) === loadKeyring().activeId;
}
