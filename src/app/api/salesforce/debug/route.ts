import { NextResponse } from "next/server";
import { authorizeUrl, listOAuthApps, redirectUri } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Diagnostic endpoint (app-auth gated). Surfaces the exact values used in the
 * OAuth flow so redirect_uri / configuration mismatches are easy to see.
 * Never returns secrets — Consumer Secret, service-role key, encryption key,
 * and session secret are only reported as present/absent booleans.
 */
export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const computedRedirectUri = redirectUri();

  let apps: unknown[] = [];
  let appsError: string | null = null;
  try {
    const list = await listOAuthApps();
    apps = list.map((a) => ({
      id: a.id,
      label: a.label,
      login_url: a.login_url,
      // Consumer Key is not a secret; showing it helps match to Salesforce.
      client_id: a.client_id,
      // The exact URL the app redirects to (state is a placeholder here).
      authorize_url: authorizeUrl(a, "STATE_PLACEHOLDER"),
    }));
  } catch (e) {
    appsError = e instanceof Error ? e.message : "Failed to load apps";
  }

  const envPresent = {
    APP_BASE_URL: Boolean(process.env.APP_BASE_URL),
    APP_PASSWORD: Boolean(process.env.APP_PASSWORD),
    APP_SESSION_SECRET: Boolean(process.env.APP_SESSION_SECRET),
    CREDENTIALS_ENCRYPTION_KEY: Boolean(process.env.CREDENTIALS_ENCRYPTION_KEY),
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  return NextResponse.json({
    ok: true,
    // The value the app actually sends to Salesforce as redirect_uri:
    redirect_uri_sent: computedRedirectUri,
    // The env var that builds it (null if unset -> falls back to localhost):
    APP_BASE_URL: process.env.APP_BASE_URL || null,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    env_present: envPresent,
    apps,
    appsError,
    hint: "Salesforce Connected App 'Callback URL' must EXACTLY equal redirect_uri_sent, on the app whose Consumer Key matches client_id.",
  });
}
