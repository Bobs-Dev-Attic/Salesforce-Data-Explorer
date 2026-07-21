import { NextResponse } from "next/server";
import crypto from "crypto";
import { authorizeUrl } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.redirect(
      new URL("/login", process.env.APP_BASE_URL || "http://localhost:3000")
    );
  }
  // CSRF state: random value echoed back on callback and matched to a cookie.
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("sf_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
