import { NextResponse } from "next/server";
import { getActiveConnection } from "@/lib/salesforce";
import { getQueryJob } from "@/lib/bulk";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } }
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
  try {
    const job = await getQueryJob(conn.id, params.jobId);
    return NextResponse.json(job);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to get job";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
