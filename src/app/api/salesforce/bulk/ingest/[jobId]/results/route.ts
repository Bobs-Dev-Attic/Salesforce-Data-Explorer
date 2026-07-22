import { getActiveConnection } from "@/lib/salesforce";
import { getIngestResults, IngestResultKind } from "@/lib/bulk";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: { jobId: string } }
) {
  if (!isAuthenticated()) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const conn = await getActiveConnection();
  if (!conn) {
    return new Response(JSON.stringify({ error: "No Salesforce connection" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const kindParam = new URL(req.url).searchParams.get("kind");
  const kind: IngestResultKind =
    kindParam === "successful" ? "successfulResults" : "failedResults";
  try {
    const csv = await getIngestResults(conn.id, params.jobId, kind);
    const filename = `${kind}-${params.jobId}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch results";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
