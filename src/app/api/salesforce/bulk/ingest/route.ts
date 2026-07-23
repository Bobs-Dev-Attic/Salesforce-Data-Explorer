import { NextResponse } from "next/server";
import { getActiveConnection } from "@/lib/salesforce";
import { startIngest, IngestOperation } from "@/lib/bulk";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

const VALID_OPS: IngestOperation[] = [
  "insert",
  "update",
  "upsert",
  "delete",
  "hardDelete",
];

/**
 * Start a Bulk API 2.0 ingest job. The CSV rides as the raw request body
 * (`text/csv`), with metadata in query params — instead of a JSON envelope,
 * which doubled memory and pushed the payload past the platform body limit
 * sooner. The client chunks large CSVs into several of these requests.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const object = (url.searchParams.get("object") || "").trim();
  const operation = (url.searchParams.get("operation") || "").trim() as
    | IngestOperation
    | "";
  const externalIdFieldName =
    url.searchParams.get("externalIdFieldName")?.trim() || undefined;
  const csv = await req.text();

  if (!object) {
    return NextResponse.json({ error: "Missing object" }, { status: 400 });
  }
  if (!VALID_OPS.includes(operation as IngestOperation)) {
    return NextResponse.json({ error: "Invalid operation" }, { status: 400 });
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: "Missing CSV data" }, { status: 400 });
  }
  if (operation === "upsert" && !externalIdFieldName) {
    return NextResponse.json(
      { error: "Upsert requires an external ID field" },
      { status: 400 }
    );
  }

  const conn = await getActiveConnection();
  if (!conn) {
    return NextResponse.json(
      { error: "No Salesforce connection" },
      { status: 400 }
    );
  }

  try {
    const job = await startIngest(conn.id, {
      object,
      operation: operation as IngestOperation,
      externalIdFieldName,
      csv,
    });
    return NextResponse.json({ jobId: job.id, state: job.state });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start import";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
