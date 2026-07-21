import { NextResponse } from "next/server";
import { describeSObject, getActiveConnection } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { name: string } }
) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conn = await getActiveConnection();
  if (!conn) {
    return NextResponse.json(
      { error: "No Salesforce connection" },
      { status: 400 }
    );
  }
  const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const describe = await describeSObject(conn.id, params.name, forceRefresh);
    return NextResponse.json(describe);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to describe object";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
