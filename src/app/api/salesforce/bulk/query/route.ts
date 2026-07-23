import { NextResponse } from "next/server";
import { getActiveConnection } from "@/lib/salesforce";
import { createQueryJob } from "@/lib/bulk";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const soql = String(body.soql || "").trim();
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
    const job = await createQueryJob(conn.id, soql);
    return NextResponse.json({ jobId: job.id, state: job.state });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create query job";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
