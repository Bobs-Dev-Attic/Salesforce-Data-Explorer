import { NextResponse } from "next/server";
import { checkEnv } from "@/lib/env";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Config health check. Unauthenticated callers (uptime monitors) get only a
 * boolean + HTTP status; an unlocked session additionally gets the per-variable
 * report (names + presence/validity, never values) to diagnose misconfiguration.
 */
export async function GET() {
  const { ok, checks } = checkEnv();
  const authed = await isAuthenticated();
  const body = authed ? { ok, checks } : { ok };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
