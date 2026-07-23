import { NextResponse } from "next/server";
import { clearSessionCookie, isAuthenticated } from "@/lib/session";
import { bumpSessionEpoch } from "@/lib/appSettings";

export const runtime = "nodejs";

/**
 * "Sign out all sessions" — bump the server-side session epoch so every
 * previously-issued cookie (including this one) is rejected on its next auth
 * check. App-auth gated so only an unlocked session can trigger it. Also clears
 * the caller's own cookie immediately.
 */
export async function POST() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const epoch = await bumpSessionEpoch();
    const cookie = clearSessionCookie();
    const res = NextResponse.json({ ok: true, epoch });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to sign out sessions";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
