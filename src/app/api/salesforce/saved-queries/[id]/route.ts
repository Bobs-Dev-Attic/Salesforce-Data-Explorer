import { NextResponse } from "next/server";
import { deleteSavedQuery } from "@/lib/savedQueries";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await deleteSavedQuery(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete query";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
