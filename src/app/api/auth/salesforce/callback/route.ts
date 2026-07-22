import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, saveConnection } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

function appUrl(path: string): URL {
  return new URL(path, process.env.APP_BASE_URL || "http://localhost:3000");
}

/** Parse "https://login.salesforce.com/id/<orgId>/<userId>" -> orgId. */
function parseOrgId(identityUrl: string): string | null {
  try {
    const parts = new URL(identityUrl).pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("id");
    return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!isAuthenticated()) {
    return NextResponse.redirect(appUrl("/login"));
  }

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) {
    const desc = url.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      appUrl(`/connections?error=${encodeURIComponent(desc)}`)
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies().get("sf_oauth_state")?.value;
  const appId = cookies().get("sf_oauth_app_id")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      appUrl(`/connections?error=${encodeURIComponent("Invalid OAuth state")}`)
    );
  }
  if (!appId) {
    return NextResponse.redirect(
      appUrl(`/connections?error=${encodeURIComponent("Missing Connected App reference")}`)
    );
  }

  try {
    const { tokens } = await exchangeCodeForTokens(appId, code);
    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh_token returned — ensure the Connected App requests the 'refresh_token' / 'offline_access' scope"
      );
    }

    let username: string | null = null;
    try {
      const idRes = await fetch(tokens.id, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (idRes.ok) {
        const identity = (await idRes.json()) as { username?: string };
        username = identity.username ?? null;
      }
    } catch {
      // non-fatal
    }

    await saveConnection({
      oauthAppId: appId,
      orgId: parseOrgId(tokens.id),
      username,
      instanceUrl: tokens.instance_url,
      refreshToken: tokens.refresh_token,
    });

    const res = NextResponse.redirect(appUrl("/connections?connected=1"));
    res.cookies.set("sf_oauth_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("sf_oauth_app_id", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Connection failed";
    console.error("[sf_oauth_callback] token exchange failed:", msg);
    return NextResponse.redirect(
      appUrl(`/connections?error=${encodeURIComponent(msg)}`)
    );
  }
}
