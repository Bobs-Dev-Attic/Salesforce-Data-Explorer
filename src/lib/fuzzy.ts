/**
 * Tiny fuzzy-matching helpers for "did you mean…" suggestions. Pure, no deps.
 */

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Optimal String Alignment (restricted Damerau-Levenshtein) distance: like
 * Levenshtein but counts a swap of two adjacent characters as one edit, which
 * matches how people actually mistype ("Naem" → "Name" is one transposition).
 */
export function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Nearest candidate to `target` (case-insensitive), or null if none is within
 * `maxDistance`. Exact matches (distance 0) are ignored — they aren't typos.
 */
export function nearest(
  target: string,
  candidates: string[],
  maxDistance = 2
): string | null {
  const t = target.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = osaDistance(t, c.toLowerCase());
    if (d > 0 && d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best !== null && bestD <= maxDistance ? best : null;
}

/** Distance budget that scales with word length (short words tolerate fewer typos). */
export function distanceBudget(word: string): number {
  if (word.length <= 4) return 1;
  if (word.length <= 8) return 2;
  return 3;
}
