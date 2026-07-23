import { NextResponse } from "next/server";
import {
  disconnect,
  renameConnection,
  setActiveConnection,
} from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/** PATCH { action: "activate" } — mark this connection active.
 *  PATCH { action: "rename", label } — update the connection's label. */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "activate");
  try {
    if (action === "activate") {
      await setActiveConnection(params.id);
    } else if (action === "rename") {
      const label = String(body.label || "").trim();
      if (!label) {
        return NextResponse.json(
          { error: "label is required" },
          { status: 400 }
        );
      }
      await renameConnection(params.id, label);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
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
  if (!(await isAuthenticated())) {
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
