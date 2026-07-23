import { NextResponse } from "next/server";
import crypto from "crypto";
import { authorizeUrl, getOAuthApp, redirectUri } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

function appUrl(path: string): URL {
  return new URL(path, process.env.APP_BASE_URL || "http://localhost:3000");
}

export async function GET(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.redirect(appUrl("/login"));
  }
  const appId = new URL(req.url).searchParams.get("appId");
  if (!appId) {
    return NextResponse.redirect(
      appUrl(`/connections?error=${encodeURIComponent("Choose a Connected App first")}`)
    );
  }
  const app = await getOAuthApp(appId);
  if (!app) {
    return NextResponse.redirect(
      appUrl(`/connections?error=${encodeURIComponent("Connected App not found")}`)
    );
  }

  // CSRF state echoed back on callback and matched to a cookie.
  const state = crypto.randomBytes(16).toString("hex");
  const authUrl = authorizeUrl(app, state);
  // Diagnostic: surface the exact redirect_uri/client_id in the runtime logs.
  console.log(
    "[sf_oauth_login]",
    JSON.stringify({
      appId,
      label: app.label,
      login_url: app.login_url,
      client_id: app.client_id,
      redirect_uri: redirectUri(),
    })
  );
  const res = NextResponse.redirect(authUrl);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  res.cookies.set("sf_oauth_state", state, cookieOpts);
  res.cookies.set("sf_oauth_app_id", appId, cookieOpts);
  return res;
}
