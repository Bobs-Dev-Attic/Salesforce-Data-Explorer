import { NextResponse } from "next/server";
import { getActiveConnection, describeSObject, runSoql } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";
import { parseCsv } from "@/lib/csv";

export const runtime = "nodejs";

// How many rows we look up for existence, and how many keys per SOQL IN clause.
const PREVIEW_ROW_CAP = 10000;
const CHUNK = 400;
const MAX_SAMPLE_ERRORS = 50;

function soqlEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Set of key values that already exist in Salesforce (chunked IN queries). */
async function existingKeys(
  connectionId: string,
  objectName: string,
  keyField: string,
  values: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  const distinct = Array.from(new Set(values.filter(Boolean)));
  for (let i = 0; i < distinct.length; i += CHUNK) {
    const chunk = distinct.slice(i, i + CHUNK);
    const inList = chunk.map((v) => `'${soqlEscape(v)}'`).join(",");
    const soql = `SELECT ${keyField} FROM ${objectName} WHERE ${keyField} IN (${inList})`;
    const res = await runSoql(connectionId, soql, chunk.length + 10);
    for (const r of res.records) {
      const v = (r as Record<string, unknown>)[keyField];
      if (v != null) found.add(String(v));
    }
  }
  return found;
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const object = String(body.object || "").trim();
  const operation = String(body.operation || "insert");
  const externalIdFieldName = String(body.externalIdFieldName || "").trim();
  const csv = String(body.csv || "");

  if (!object) {
    return NextResponse.json({ error: "Missing object" }, { status: 400 });
  }
  if (!csv.trim()) {
    return NextResponse.json({ error: "Missing CSV data" }, { status: 400 });
  }

  const conn = await getActiveConnection();
  if (!conn) {
    return NextResponse.json(
      { error: "No active Salesforce connection" },
      { status: 400 }
    );
  }

  try {
    const describe = await describeSObject(conn.id, object);
    const objName = String(describe.name || object);
    const fields = (describe.fields as { name: string }[]) || [];
    const fieldByLower = new Map<string, string>();
    for (const f of fields) fieldByLower.set(f.name.toLowerCase(), f.name);

    const { headers, rows } = parseCsv(csv);
    if (headers.length === 0 || (headers.length === 1 && !headers[0])) {
      return NextResponse.json(
        { error: "CSV has no header row" },
        { status: 400 }
      );
    }
    const totalRows = rows.length;
    const headerIndex = (name: string) =>
      headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

    const unknownFields = headers.filter(
      (h) => h && !fieldByLower.has(h.toLowerCase())
    );

    const report = {
      object: objName,
      operation,
      totalRows,
      analyzedRows: 0,
      truncated: false,
      willInsert: 0,
      willUpdate: 0,
      willDelete: 0,
      notFound: 0,
      unknownFields,
      issues: [] as string[],
      sampleErrors: [] as { row: number; issue: string }[],
    };

    const addSample = (row: number, issue: string) => {
      if (report.sampleErrors.length < MAX_SAMPLE_ERRORS) {
        report.sampleErrors.push({ row, issue });
      }
    };

    if (operation === "insert") {
      report.willInsert = totalRows;
      report.analyzedRows = totalRows;
    } else if (
      operation === "update" ||
      operation === "delete" ||
      operation === "hardDelete"
    ) {
      const idIdx = headerIndex("Id");
      if (idIdx < 0) {
        report.issues.push(`A column named "Id" is required for ${operation}.`);
      } else {
        const analyze = Math.min(totalRows, PREVIEW_ROW_CAP);
        report.truncated = totalRows > PREVIEW_ROW_CAP;
        report.analyzedRows = analyze;
        const ids: string[] = [];
        for (let i = 0; i < analyze; i++) {
          const v = (rows[i][idIdx] || "").trim();
          if (v) ids.push(v);
        }
        const existing = await existingKeys(conn.id, objName, "Id", ids);
        let match = 0;
        for (let i = 0; i < analyze; i++) {
          const v = (rows[i][idIdx] || "").trim();
          if (!v) {
            report.notFound++;
            addSample(i + 2, "missing Id");
          } else if (existing.has(v)) {
            match++;
          } else {
            report.notFound++;
            addSample(i + 2, `Id ${v} not found`);
          }
        }
        if (operation === "update") report.willUpdate = match;
        else report.willDelete = match;
      }
    } else if (operation === "upsert") {
      if (!externalIdFieldName) {
        report.issues.push("Upsert requires an external ID field.");
      } else {
        const canonical =
          fieldByLower.get(externalIdFieldName.toLowerCase()) ||
          externalIdFieldName;
        const extIdx = headerIndex(externalIdFieldName);
        if (extIdx < 0) {
          report.issues.push(
            `CSV has no column matching the external ID field "${externalIdFieldName}".`
          );
        } else {
          const analyze = Math.min(totalRows, PREVIEW_ROW_CAP);
          report.truncated = totalRows > PREVIEW_ROW_CAP;
          report.analyzedRows = analyze;
          const vals: string[] = [];
          for (let i = 0; i < analyze; i++) {
            const v = (rows[i][extIdx] || "").trim();
            if (v) vals.push(v);
          }
          const existing = await existingKeys(
            conn.id,
            objName,
            canonical,
            vals
          );
          for (let i = 0; i < analyze; i++) {
            const v = (rows[i][extIdx] || "").trim();
            if (v && existing.has(v)) report.willUpdate++;
            else report.willInsert++;
          }
        }
      }
    } else {
      report.issues.push(`Unsupported operation: ${operation}`);
    }

    return NextResponse.json({ ok: true, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Preview failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
