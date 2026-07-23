import { getAdminClient } from "./supabase";

/**
 * Server-side app settings (Supabase `app_settings`). Currently backs the
 * session epoch used for revocation: every session cookie carries the epoch it
 * was minted under, and `isAuthenticated` rejects cookies whose epoch != the
 * current one. Bumping the epoch therefore invalidates all sessions.
 *
 * The epoch is read on every auth check, so it's cached in-memory with a short
 * TTL to avoid a DB round-trip per request. Trade-off: after a revoke, other
 * warm serverless instances keep honoring old sessions until their cache
 * expires (≤ TTL). The instance that performs the revoke clears its own cache
 * immediately.
 */

const EPOCH_KEY = "session_epoch";
const CACHE_TTL_MS = 30_000;

let cachedEpoch: { value: number; at: number } | null = null;

/** Current session epoch (cached). Missing/unparseable settings default to 1. */
export async function getSessionEpoch(): Promise<number> {
  const now = Date.now();
  if (cachedEpoch && now - cachedEpoch.at < CACHE_TTL_MS) {
    return cachedEpoch.value;
  }
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", EPOCH_KEY)
    .maybeSingle();
  const parsed = Number(data?.value);
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  cachedEpoch = { value, at: now };
  return value;
}

/** Increment the session epoch, invalidating every existing session. */
export async function bumpSessionEpoch(): Promise<number> {
  const supabase = getAdminClient();
  const current = await getSessionEpoch();
  const next = current + 1;
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: EPOCH_KEY, value: String(next), updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(error.message);
  cachedEpoch = { value: next, at: Date.now() };
  return next;
}
