import { getAdminClient } from "./supabase";
import { activeKeyId, isUnderActiveKey, reencrypt } from "./crypto";

/**
 * Re-encrypt all stored secrets under the current active key. This is the
 * migration step of a key rotation: after adding a new key and pointing
 * CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID at it, run this to rewrite existing rows
 * so the old key can be retired. Rows already under the active key are skipped,
 * so it is safe to run repeatedly (idempotent).
 */

export interface RekeyTableResult {
  total: number;
  rekeyed: number;
}

export interface RekeyResult {
  activeKeyId: string;
  apps: RekeyTableResult;
  connections: RekeyTableResult;
}

async function rekeyTable(
  table: string,
  column: string
): Promise<RekeyTableResult> {
  const supabase = getAdminClient();
  const { data, error } = await supabase.from(table).select(`id, ${column}`);
  if (error) throw new Error(error.message);

  // The dynamic column name defeats Supabase's typed inference, so cast through
  // unknown to the row shape we actually selected.
  const rows = (data ?? []) as unknown as {
    id: string;
    [k: string]: unknown;
  }[];
  let rekeyed = 0;
  for (const row of rows) {
    const payload = row[column];
    if (typeof payload !== "string" || !payload || isUnderActiveKey(payload)) {
      continue;
    }
    const { error: upErr } = await supabase
      .from(table)
      .update({ [column]: reencrypt(payload) })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
    rekeyed++;
  }
  return { total: rows.length, rekeyed };
}

export async function rekeyAllSecrets(): Promise<RekeyResult> {
  const apps = await rekeyTable(
    "salesforce_oauth_apps",
    "client_secret_encrypted"
  );
  const connections = await rekeyTable(
    "salesforce_connections",
    "refresh_token_encrypted"
  );
  return { activeKeyId: activeKeyId(), apps, connections };
}
