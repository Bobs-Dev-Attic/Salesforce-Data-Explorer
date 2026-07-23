import { getActiveConnection, runSoql, streamSoql } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";
import { buildXlsx } from "@/lib/xlsx";
import { csvHeader, csvRow } from "@/lib/csv";

export const runtime = "nodejs";

/** Ordered union of column keys across flattened rows. */
function columnsOf(rows: Record<string, string>[]): string[] {
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
  return columns;
}

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

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stream a CSV or JSON export page by page so only one Salesforce batch is held
 * in memory at a time (previously the entire result set was buffered, risking
 * OOM on large/wide exports). Columns are derived from the first batch — SOQL's
 * SELECT fixes the schema, so later batches share those keys.
 */
function streamExport(
  format: "csv" | "json",
  firstBatch: Record<string, unknown>[],
  rest: AsyncGenerator<Record<string, unknown>[]>
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const firstRows = firstBatch.map((r) => flatten(r));
  const columns = columnsOf(firstRows);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (format === "csv") {
          controller.enqueue(enc.encode(csvHeader(columns)));
          for (const row of firstRows) {
            controller.enqueue(enc.encode("\r\n" + csvRow(row, columns)));
          }
          for await (const batch of rest) {
            for (const rec of batch) {
              controller.enqueue(
                enc.encode("\r\n" + csvRow(flatten(rec), columns))
              );
            }
          }
        } else {
          const toObj = (row: Record<string, string>) => {
            const obj: Record<string, string> = {};
            for (const c of columns) obj[c] = row[c] ?? "";
            return obj;
          };
          let first = true;
          controller.enqueue(enc.encode("["));
          const write = (row: Record<string, string>) => {
            controller.enqueue(
              enc.encode((first ? "\n  " : ",\n  ") + JSON.stringify(toObj(row)))
            );
            first = false;
          };
          for (const row of firstRows) write(row);
          for await (const batch of rest) {
            for (const rec of batch) write(flatten(rec));
          }
          controller.enqueue(enc.encode(first ? "]" : "\n]"));
        }
        controller.close();
      } catch (e) {
        // Mid-stream failure (e.g. a later page errors). The response is already
        // committed with 200, so surface it by aborting the stream.
        controller.error(e);
      }
    },
  });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return jsonError("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const soql = String(body.soql || "").trim();
  const maxRecords = Math.min(Number(body.maxRecords) || 10000, 50000);
  const format = ["csv", "json", "xlsx"].includes(body.format)
    ? (body.format as "csv" | "json" | "xlsx")
    : "csv";
  const baseName = String(body.filename || "export").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!soql) return jsonError("Missing soql", 400);

  const conn = await getActiveConnection();
  if (!conn) return jsonError("No Salesforce connection", 400);

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${baseName || "export"}-${date}`;

  // XLSX is a ZIP archive that needs the full matrix up front, so it stays
  // buffered. CSV/JSON stream page by page.
  if (format === "xlsx") {
    try {
      const result = await runSoql(conn.id, soql, maxRecords);
      const rows = result.records.map((r) => flatten(r));
      const columns = columnsOf(rows);
      const matrix = rows.map((row) => columns.map((c) => row[c] ?? ""));
      const buf = buildXlsx(columns, matrix, baseName || "Data");
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        },
      });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "Export failed", 400);
    }
  }

  // Pull the first page eagerly so a bad query surfaces as a clean 400 before
  // we commit a 200 streaming response.
  const iterator = streamSoql(conn.id, soql, maxRecords);
  let firstBatch: Record<string, unknown>[] = [];
  try {
    const first = await iterator.next();
    if (!first.done) firstBatch = first.value;
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Export failed", 400);
  }

  const stream = streamExport(format, firstBatch, iterator);
  const contentType =
    format === "json"
      ? "application/json; charset=utf-8"
      : "text/csv; charset=utf-8";
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}.${format}"`,
    },
  });
}
