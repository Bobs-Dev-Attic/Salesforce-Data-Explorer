import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const cookie = clearSessionCookie();
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  // 303 so the browser follows the POST with a GET to /login.
  const res = NextResponse.redirect(new URL("/login", base), { status: 303 });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
