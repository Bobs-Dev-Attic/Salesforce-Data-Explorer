import { NextResponse } from "next/server";
import { connectClientCredentials } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Connect an org using the Client Credentials grant (server-to-server).
 * Requires the Connected App to have "Enable Client Credentials Flow" turned on
 * with a run-as user. No browser redirect / callback URL is involved.
 */
export async function POST(req: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const appId = String(body.appId || "").trim();
  if (!appId) {
    return NextResponse.json({ error: "Missing appId" }, { status: 400 });
  }
  try {
    const conn = await connectClientCredentials(appId);
    return NextResponse.json({ ok: true, connection: conn });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Connection failed";
    console.error("[sf_client_credentials] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
