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

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const object = String(body.object || "").trim();
  const operation = String(body.operation || "").trim() as IngestOperation;
  const externalIdFieldName = body.externalIdFieldName
    ? String(body.externalIdFieldName).trim()
    : undefined;
  const csv = String(body.csv || "");

  if (!object) {
    return NextResponse.json({ error: "Missing object" }, { status: 400 });
  }
  if (!VALID_OPS.includes(operation)) {
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
      operation,
      externalIdFieldName,
      csv,
    });
    return NextResponse.json({ jobId: job.id, state: job.state });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start import";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
