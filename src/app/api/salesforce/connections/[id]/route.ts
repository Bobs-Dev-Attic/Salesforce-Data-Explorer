import { NextResponse } from "next/server";
import { disconnect, setActiveConnection } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/** PATCH { action: "activate" } — mark this connection active. */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "activate");
  try {
    if (action === "activate") {
      await setActiveConnection(params.id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update connection";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await disconnect(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete connection";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
