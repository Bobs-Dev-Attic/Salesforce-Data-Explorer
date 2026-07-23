/**
 * CSV serialization for exports. Kept as a standalone module (not inline in the
 * export route) so the escaping rules — including formula-injection hardening —
 * are unit-testable.
 */

/** Supported delimited text formats and their delimiter character. */
export type DelimitedFormat = "csv" | "tsv";
export const DELIMITERS: Record<DelimitedFormat, string> = {
  csv: ",",
  tsv: "\t",
};

/**
 * Serialize one cell for a delimiter-separated format. Two concerns:
 *  1. RFC-4180 quoting for values containing the delimiter, a quote, or a newline.
 *  2. Formula-injection hardening: a value beginning with = + - @ (optionally
 *     after a tab or carriage return) is interpreted as a live formula by Excel
 *     / Google Sheets, so we prefix it with a single quote to force literal text.
 */
export function delimitedCell(v: string, delimiter: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Quote if the value contains the delimiter, a quote, or a line break.
  if (s.includes(delimiter) || /["\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function delimitedHeader(columns: string[], delimiter: string): string {
  return columns.map((c) => delimitedCell(c, delimiter)).join(delimiter);
}

export function delimitedRow(
  row: Record<string, string>,
  columns: string[],
  delimiter: string
): string {
  return columns.map((c) => delimitedCell(row[c] ?? "", delimiter)).join(delimiter);
}

// CSV-specific wrappers (kept for existing call sites).
export function csvCell(v: string): string {
  return delimitedCell(v, ",");
}
export function csvHeader(columns: string[]): string {
  return delimitedHeader(columns, ",");
}
export function csvRow(row: Record<string, string>, columns: string[]): string {
  return delimitedRow(row, columns, ",");
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

/**
 * Split raw CSV text into records on *unquoted* newlines, preserving each
 * record's original bytes (quotes, embedded newlines, etc.). Returns the header
 * record plus the data records. CRLF is normalized to LF at record boundaries.
 */
export function rawCsvRecords(text: string): {
  header: string;
  records: string[];
} {
  const recs: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // A doubled "" toggles off then on (net no change), so a plain toggle
      // correctly tracks whether we're inside a quoted field.
      inQuotes = !inQuotes;
    } else if (c === "\n" && !inQuotes) {
      let rec = text.slice(start, i);
      if (rec.endsWith("\r")) rec = rec.slice(0, -1);
      recs.push(rec);
      start = i + 1;
    }
  }
  if (start < text.length) {
    let rec = text.slice(start);
    if (rec.endsWith("\r")) rec = rec.slice(0, -1);
    recs.push(rec);
  }
  while (recs.length && recs[recs.length - 1].trim() === "") recs.pop();
  return { header: recs.length ? recs[0] : "", records: recs.slice(1) };
}

/**
 * Split a CSV document into LF-joined chunks each no larger than `maxBytes`
 * (UTF-8), repeating the header on every chunk. Lets a large import be sent as
 * several requests under a platform body-size limit without splitting a record.
 * A single record larger than `maxBytes` still gets its own (over-size) chunk.
 */
export function splitCsvIntoChunks(text: string, maxBytes: number): string[] {
  const { header, records } = rawCsvRecords(text);
  if (!header) return [];
  if (records.length === 0) return [header];
  const enc = new TextEncoder();
  const headerBytes = enc.encode(header + "\n").length;
  const chunks: string[] = [];
  let cur: string[] = [];
  let curBytes = headerBytes;
  for (const rec of records) {
    const recBytes = enc.encode(rec + "\n").length;
    if (cur.length > 0 && curBytes + recBytes > maxBytes) {
      chunks.push(header + "\n" + cur.join("\n"));
      cur = [];
      curBytes = headerBytes;
    }
    cur.push(rec);
    curBytes += recBytes;
  }
  if (cur.length) chunks.push(header + "\n" + cur.join("\n"));
  return chunks;
}

/** Serialize a header + matrix of rows into a delimited document (CRLF rows). */
export function matrixToDelimited(
  headers: string[],
  rows: string[][],
  delimiter: string
): string {
  const lines = [delimitedHeader(headers, delimiter)];
  for (const row of rows) {
    lines.push(
      row.map((c) => delimitedCell(c ?? "", delimiter)).join(delimiter)
    );
  }
  return lines.join("\r\n");
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
