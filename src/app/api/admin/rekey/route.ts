import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { rekeyAllSecrets } from "@/lib/keyRotation";

export const runtime = "nodejs";

/**
 * Re-encrypt all stored secrets under the active encryption key — the migration
 * step of a key rotation. App-auth gated. Idempotent: rows already under the
 * active key are skipped.
 */
export async function POST() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await rekeyAllSecrets();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Re-key failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
