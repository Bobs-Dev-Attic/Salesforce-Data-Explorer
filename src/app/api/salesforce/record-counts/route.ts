import { NextResponse } from "next/server";
import { getActiveConnection, getRecordCounts } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
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
    const counts = await getRecordCounts(conn.id, forceRefresh);
    return NextResponse.json({ counts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load record counts";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
