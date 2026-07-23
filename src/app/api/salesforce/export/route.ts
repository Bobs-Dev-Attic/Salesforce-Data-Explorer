import { getActiveConnection, runSoql } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";
import { buildXlsx } from "@/lib/xlsx";
import { toCsv } from "@/lib/csv";

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
  const format = ["csv", "json", "xlsx"].includes(body.format)
    ? (body.format as "csv" | "json" | "xlsx")
    : "csv";
  const baseName = String(body.filename || "export").replace(/[^a-zA-Z0-9_-]/g, "");
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
    const rows = result.records.map((r) => flatten(r));
    const columns = columnsOf(rows);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${baseName || "export"}-${date}`;

    if (format === "json") {
      const json = JSON.stringify(
        rows.map((row) => {
          const obj: Record<string, string> = {};
          for (const c of columns) obj[c] = row[c] ?? "";
          return obj;
        }),
        null,
        2
      );
      return new Response(json, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.json"`,
        },
      });
    }

    if (format === "xlsx") {
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
    }

    const csv = toCsv(rows, columns);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
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
