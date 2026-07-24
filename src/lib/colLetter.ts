/**
 * Spreadsheet-style column label for a 0-based index:
 * 0→A, 25→Z, 26→AA, 27→AB, 701→ZZ, 702→AAA … (Excel/A1 notation).
 */
export function colLetter(index: number): string {
  if (index < 0 || !Number.isFinite(index)) return "";
  let n = Math.floor(index);
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** A1-style cell reference from 0-based column and 1-based row. */
export function cellRef(colIndex: number, rowNumber: number): string {
  return `${colLetter(colIndex)}${rowNumber}`;
}
