import { NextResponse } from "next/server";
import { listConnections } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const connections = await listConnections();
    return NextResponse.json({ connections });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list connections";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
