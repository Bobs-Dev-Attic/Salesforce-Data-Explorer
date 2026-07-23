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
