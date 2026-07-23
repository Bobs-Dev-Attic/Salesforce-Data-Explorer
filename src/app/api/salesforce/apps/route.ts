import { NextResponse } from "next/server";
import { createOAuthApp, listOAuthApps } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const apps = await listOAuthApps();
    return NextResponse.json({ apps });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list apps";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  const loginUrl = String(body.loginUrl || "https://login.salesforce.com").trim();
  const clientId = String(body.clientId || "").trim();
  const clientSecret = String(body.clientSecret || "").trim();

  if (!label || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "label, clientId and clientSecret are required" },
      { status: 400 }
    );
  }
  if (!/^https?:\/\//.test(loginUrl)) {
    return NextResponse.json(
      { error: "loginUrl must start with https://" },
      { status: 400 }
    );
  }

  try {
    const app = await createOAuthApp({ label, loginUrl, clientId, clientSecret });
    return NextResponse.json({ app });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save app";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
