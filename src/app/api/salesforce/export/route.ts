import { getActiveConnection, runSoql } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/** Flatten a Salesforce record into scalar columns, dropping `attributes`. */
function flatten(
  record: Record<string, unknown>,
  prefix = ""
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "attributes") continue;
    const col = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      out[col] = "";
    } else if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Record<string, unknown>, col));
    } else {
      out[col] = String(value);
    }
  }
  return out;
}

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(records: Record<string, unknown>[]): string {
  const rows = records.map((r) => flatten(r));
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

export async function POST(req: Request) {
  if (!isAuthenticated()) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = await req.json().catch(() => ({}));
  const soql = String(body.soql || "").trim();
  const maxRecords = Math.min(Number(body.maxRecords) || 10000, 50000);
  if (!soql) {
    return new Response(JSON.stringify({ error: "Missing soql" }), {
      status: 400,
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

  try {
    const result = await runSoql(conn.id, soql, maxRecords);
    const csv = toCsv(result.records);
    const filename = `export-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Export failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
