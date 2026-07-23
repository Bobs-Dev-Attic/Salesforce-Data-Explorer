import { NextResponse } from "next/server";
import { getActiveConnection, runSoql } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const soql = String(body.soql || "").trim();
  const maxRecords = Math.min(Number(body.maxRecords) || 2000, 50000);
  if (!soql) {
    return NextResponse.json({ error: "Missing soql" }, { status: 400 });
  }

  const conn = await getActiveConnection();
  if (!conn) {
    return NextResponse.json(
      { error: "No Salesforce connection" },
      { status: 400 }
    );
  }

  try {
    const result = await runSoql(conn.id, soql, maxRecords);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Query failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
