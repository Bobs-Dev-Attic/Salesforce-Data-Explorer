/**
 * CSV serialization for exports. Kept as a standalone module (not inline in the
 * export route) so the escaping rules — including formula-injection hardening —
 * are unit-testable.
 */

/**
 * Serialize one cell. Two concerns:
 *  1. RFC-4180 quoting for values containing quote / comma / newline.
 *  2. Formula-injection hardening: a value beginning with = + - @ (optionally
 *     after a tab or carriage return) is interpreted as a live formula by Excel
 *     / Google Sheets, so we prefix it with a single quote to force literal text.
 */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize the header row for a given column order. */
export function csvHeader(columns: string[]): string {
  return columns.map(csvCell).join(",");
}

/** Serialize a single flattened row against a fixed column order. */
export function csvRow(row: Record<string, string>, columns: string[]): string {
  return columns.map((c) => csvCell(row[c] ?? "")).join(",");
}

/**
 * Parse a CSV document into a header row + data rows (RFC-4180-ish): handles
 * quoted fields, escaped quotes (`""`), and commas / newlines inside quotes.
 * Blank trailing lines are ignored. Returns `{ headers, rows }` where each row
 * is an array of cell strings aligned to the header order.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // whether the current record has any content

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      started = true;
    } else if (c === ",") {
      pushField();
      started = true;
    } else if (c === "\r") {
      // handled by the \n branch; ignore lone CR
    } else if (c === "\n") {
      if (started || field.length > 0 || record.length > 0) pushRecord();
    } else {
      field += c;
      started = true;
    }
  }
  // Flush a trailing record with no final newline.
  if (started || field.length > 0 || record.length > 0) pushRecord();

  const headers = records.length ? records[0] : [];
  return { headers, rows: records.slice(1) };
}

/** Build a CRLF-delimited CSV document from flattened rows and a column order. */
export function toCsv(
  rows: Record<string, string>[],
  columns: string[]
): string {
  const lines = [csvHeader(columns)];
  for (const row of rows) {
    lines.push(csvRow(row, columns));
  }
  return lines.join("\r\n");
}
