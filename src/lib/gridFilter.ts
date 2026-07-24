/**
 * Client-side "Excel Table" AutoFilter for an already-loaded result grid:
 * per-column value filters (checkbox lists) plus a single-column sort. Pure and
 * framework-free so it can be unit-tested and reused. Values are the raw string
 * cells of `Record<string, string>` rows; a blank/missing cell is normalized to
 * the empty string (shown as "(Blanks)" in the UI).
 */

export interface SortSpec {
  col: string;
  dir: "asc" | "desc";
}

/** Column name → the set of values allowed through (checked in the UI). */
export type ValueFilters = Record<string, string[]>;

/**
 * Order two cell values: numerically when both look numeric (numbers ahead of
 * text), otherwise lexicographically. Blank sorts as text.
 */
export function compareValues(a: string, b: string): number {
  const aNum = a !== "" && !Number.isNaN(Number(a));
  const bNum = b !== "" && !Number.isNaN(Number(b));
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1;
  if (bNum) return 1;
  return a.localeCompare(b);
}

/** Distinct values of `col` across `rows`, sorted via {@link compareValues}. */
export function distinctValues(
  rows: Record<string, string>[],
  col: string
): string[] {
  const seen = new Set<string>();
  for (const r of rows) seen.add(r[col] ?? "");
  return Array.from(seen).sort(compareValues);
}

/**
 * Apply value filters, then sort. Only columns in `columns` are honored (so a
 * filter left over from a previous query can't hide every row). Never mutates
 * the input; returns the same array reference when nothing is active.
 */
export function applyGridView(
  rows: Record<string, string>[],
  columns: string[],
  filters: ValueFilters,
  sort: SortSpec | null
): Record<string, string>[] {
  const colSet = new Set(columns);
  const activeCols = Object.keys(filters).filter(
    (c) => colSet.has(c) && Array.isArray(filters[c])
  );

  let out = rows;
  if (activeCols.length) {
    const sets = activeCols.map((c) => [c, new Set(filters[c])] as const);
    out = out.filter((r) => sets.every(([c, allow]) => allow.has(r[c] ?? "")));
  }

  if (sort && colSet.has(sort.col)) {
    const { col, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    out = [...out].sort(
      (ra, rb) => compareValues(ra[col] ?? "", rb[col] ?? "") * sign
    );
  }

  return out;
}
