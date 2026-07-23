import { NextResponse } from "next/server";
import { deleteOAuthApp, updateOAuthApp } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const patch: {
    label?: string;
    loginUrl?: string;
    clientId?: string;
    clientSecret?: string;
  } = {};
  if (typeof body.label === "string") patch.label = body.label.trim();
  if (typeof body.loginUrl === "string") patch.loginUrl = body.loginUrl.trim();
  if (typeof body.clientId === "string") patch.clientId = body.clientId.trim();
  // Empty string means "keep the existing secret".
  if (typeof body.clientSecret === "string" && body.clientSecret.trim()) {
    patch.clientSecret = body.clientSecret.trim();
  }

  if (patch.loginUrl !== undefined && !/^https?:\/\//.test(patch.loginUrl)) {
    return NextResponse.json(
      { error: "loginUrl must start with https://" },
      { status: 400 }
    );
  }

  try {
    const app = await updateOAuthApp(params.id, patch);
    return NextResponse.json({ app });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update app";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await deleteOAuthApp(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete app";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
