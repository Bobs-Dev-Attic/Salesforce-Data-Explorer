/**
 * SOQL linter (intellisense Phase 2).
 *
 * Pure, dependency-free. Produces diagnostics with source offsets so the editor
 * can underline problems and list them. Two layers:
 *
 *  - Structural (no metadata): unterminated string, unbalanced parentheses.
 *  - Semantic (needs describe): unknown object after FROM, unknown fields in
 *    the field clauses.
 *
 * Semantic checks are conservative — they skip relationship paths, function
 * calls, aggregate aliases, and bail entirely on subqueries / TYPEOF, where a
 * client-side field list can't be authoritative. The token currently under the
 * caret is never flagged (you're still typing it). Authoritative validation is
 * Phase 3 (server-side Query Explain).
 */

import { nearest, distanceBudget } from "./fuzzy";

export type Severity = "error" | "warning";

/** A one-click edit that resolves a diagnostic. */
export interface Fix {
  start: number;
  end: number;
  replacement: string;
  label: string;
}

export interface Diagnostic {
  start: number;
  end: number;
  line: number; // 1-based
  col: number; // 1-based
  message: string;
  severity: Severity;
  /** Optional quick-fix the editor can apply. */
  fix?: Fix;
}

export interface LintMeta {
  /** Lowercased set of known object API names, or null if not yet loaded. */
  objects?: Set<string> | null;
  /** Lowercased set of the FROM object's field names, or null if unknown. */
  fields?: Set<string> | null;
  /** Original-case field names, for "did you mean…" suggestions. */
  fieldList?: string[] | null;
}

// Words that are valid in field clauses but are not fields.
const RESERVED = new Set(
  [
    // clause / logical keywords
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "ORDER", "BY",
    "GROUP", "HAVING", "LIMIT", "OFFSET", "ASC", "DESC", "NULLS", "FIRST",
    "LAST", "NULL", "TRUE", "FALSE", "FOR", "VIEW", "REFERENCE", "UPDATE",
    "TRACKING", "VIEWSTAT", "WITH", "DATA", "CATEGORY", "TYPEOF", "WHEN",
    "THEN", "ELSE", "END", "USING", "SCOPE", "INCLUDES", "EXCLUDES", "ABOVE",
    "BELOW", "AT", "ROLLUP", "CUBE", "GROUPING",
    // aggregate / scalar functions
    "COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX", "TOLABEL", "FORMAT",
    "CONVERTCURRENCY", "CONVERTTIMEZONE", "CALENDAR_MONTH", "CALENDAR_YEAR",
    "CALENDAR_QUARTER", "DAY_IN_MONTH", "DAY_IN_WEEK", "DAY_IN_YEAR",
    "DAY_ONLY", "FISCAL_MONTH", "FISCAL_QUARTER", "FISCAL_YEAR", "HOUR_IN_DAY",
    "WEEK_IN_MONTH", "WEEK_IN_YEAR", "DISTANCE", "GEOLOCATION",
    // date literals
    "YESTERDAY", "TODAY", "TOMORROW", "LAST_WEEK", "THIS_WEEK", "NEXT_WEEK",
    "LAST_MONTH", "THIS_MONTH", "NEXT_MONTH", "LAST_90_DAYS", "NEXT_90_DAYS",
    "LAST_N_DAYS", "NEXT_N_DAYS", "LAST_N_WEEKS", "NEXT_N_WEEKS",
    "LAST_N_MONTHS", "NEXT_N_MONTHS", "THIS_QUARTER", "LAST_QUARTER",
    "NEXT_QUARTER", "LAST_N_QUARTERS", "NEXT_N_QUARTERS", "THIS_YEAR",
    "LAST_YEAR", "NEXT_YEAR", "LAST_N_YEARS", "NEXT_N_YEARS",
    "THIS_FISCAL_QUARTER", "LAST_FISCAL_QUARTER", "NEXT_FISCAL_QUARTER",
    "THIS_FISCAL_YEAR", "LAST_FISCAL_YEAR", "NEXT_FISCAL_YEAR",
    "N_FISCAL_QUARTERS_AGO", "N_DAYS_AGO",
  ].map((s) => s)
);

const CLAUSE_OF: Record<string, string> = {
  SELECT: "select",
  FROM: "from",
  WHERE: "where",
  HAVING: "having",
  LIMIT: "limit",
  OFFSET: "limit",
  GROUP: "group",
  ORDER: "order",
};
const FIELD_CLAUSES = new Set(["select", "where", "order", "group", "having"]);

interface StructResult {
  masked: string;
  diagnostics: Diagnostic[];
  hasSubquery: boolean;
  hasTypeof: boolean;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function locate(offset: number, lineStarts: number[]): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
}

/**
 * Walk the source once: blank out string contents (preserving offsets), track
 * paren balance, and flag structural errors.
 */
function scanStructure(text: string, lineStarts: number[]): StructResult {
  let masked = "";
  let inStr = false;
  let strStart = -1;
  let escaped = false;
  const parenStack: number[] = [];
  const diagnostics: Diagnostic[] = [];

  const push = (start: number, end: number, message: string) =>
    diagnostics.push({
      start,
      end,
      ...locate(start, lineStarts),
      message,
      severity: "error",
    });

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        masked += " ";
        continue;
      }
      if (c === "\\") {
        escaped = true;
        masked += " ";
        continue;
      }
      if (c === "'") {
        inStr = false;
        masked += " ";
        continue;
      }
      masked += " ";
      continue;
    }
    if (c === "'") {
      inStr = true;
      strStart = i;
      masked += " ";
      continue;
    }
    if (c === "(") parenStack.push(i);
    else if (c === ")") {
      if (parenStack.length) parenStack.pop();
      else push(i, i + 1, "Unmatched ')'");
    }
    masked += c;
  }

  if (inStr) {
    push(strStart, text.length, "Unterminated string literal");
  }
  for (const openIdx of parenStack) {
    push(openIdx, openIdx + 1, "Unmatched '('");
  }

  return {
    masked,
    diagnostics,
    hasSubquery: /\(\s*SELECT\b/i.test(masked),
    hasTypeof: /\bTYPEOF\b/i.test(masked),
  };
}

function prevNonSpace(masked: string, from: number): string {
  for (let i = from; i >= 0; i--) {
    if (masked[i] !== " " && masked[i] !== "\t" && masked[i] !== "\n" &&
        masked[i] !== "\r")
      return masked[i];
  }
  return "";
}

function nextNonSpace(masked: string, from: number): string {
  for (let i = from; i < masked.length; i++) {
    if (masked[i] !== " " && masked[i] !== "\t" && masked[i] !== "\n" &&
        masked[i] !== "\r")
      return masked[i];
  }
  return "";
}

/**
 * Lint a SOQL string. `caret`, when given, suppresses semantic diagnostics on
 * the identifier currently being typed.
 */
export function lintSoql(
  text: string,
  meta: LintMeta = {},
  caret = -1
): Diagnostic[] {
  const lineStarts = lineStartsOf(text);
  const { masked, diagnostics, hasSubquery, hasTypeof } = scanStructure(
    text,
    lineStarts
  );

  const underCaret = (start: number, end: number) =>
    caret >= start && caret <= end;

  // --- Unknown object after FROM ---
  // Skip when a subquery is present: the first FROM may belong to the child.
  if (meta.objects && !hasSubquery) {
    const m = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(masked);
    if (m) {
      const name = m[1];
      const start = m.index + m[0].length - name.length;
      const end = start + name.length;
      if (!underCaret(start, end) && !meta.objects.has(name.toLowerCase())) {
        diagnostics.push({
          start,
          end,
          ...locate(start, lineStarts),
          message: `Unknown object '${name}'`,
          severity: "error",
        });
      }
    }
  }

  // --- Unknown fields in field clauses ---
  if (meta.fields && !hasSubquery && !hasTypeof) {
    let clause = "";
    let sawObject = false;
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const word = m[0];
      const up = word.toUpperCase();
      const start = m.index;
      const end = start + word.length;

      if (up in CLAUSE_OF) {
        clause = CLAUSE_OF[up];
        if (up === "FROM") sawObject = false;
        continue;
      }
      if (up === "BY") continue;
      if (clause === "from") {
        sawObject = true;
        void sawObject;
        continue;
      }
      if (!FIELD_CLAUSES.has(clause)) continue;
      if (RESERVED.has(up)) continue;

      const prev = prevNonSpace(masked, start - 1);
      const next = nextNonSpace(masked, end);
      if (prev === ".") continue; // relationship suffix
      if (next === ".") continue; // relationship prefix
      if (next === "(") continue; // function call
      if (prev === ")") continue; // alias after an aggregate
      if (underCaret(start, end)) continue;

      if (!meta.fields.has(word.toLowerCase())) {
        const guess = meta.fieldList
          ? nearest(word, meta.fieldList, distanceBudget(word))
          : null;
        diagnostics.push({
          start,
          end,
          ...locate(start, lineStarts),
          message: guess
            ? `Unknown field '${word}' — did you mean '${guess}'?`
            : `Unknown field '${word}'`,
          severity: "warning",
          fix: guess
            ? { start, end, replacement: guess, label: `Use '${guess}'` }
            : undefined,
        });
      }
    }
  }

  // --- Missing comma between SELECT fields ---
  // `SELECT Name AccountNumber …` is read by Salesforce as aliasing (only legal
  // for aggregates) → MALFORMED_QUERY. Flag two adjacent field tokens in the
  // SELECT list with a quick-fix that inserts the comma. Skip aggregate queries
  // (where aliasing is legal) and subquery/TYPEOF cases we can't reason about.
  if (!hasTypeof) {
    for (const gap of missingCommaGaps(masked)) {
      if (underCaret(gap.secondStart, gap.secondEnd)) continue;
      diagnostics.push({
        start: gap.secondStart,
        end: gap.secondEnd,
        ...locate(gap.secondStart, lineStarts),
        message: `Missing comma before '${text.slice(
          gap.secondStart,
          gap.secondEnd
        )}'?`,
        severity: "error",
        fix: {
          start: gap.insertAt,
          end: gap.insertAt,
          replacement: ",",
          label: "Insert comma",
        },
      });
    }
  }

  diagnostics.sort((a, b) => a.start - b.start);
  return diagnostics;
}

function depthArrayOf(masked: string): number[] {
  const arr = new Array<number>(masked.length);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    arr[i] = d;
    const c = masked[i];
    if (c === "(") d++;
    else if (c === ")") d = Math.max(0, d - 1);
  }
  return arr;
}

function firstTopLevel(
  masked: string,
  depth: number[],
  re: RegExp,
  from = 0
): number {
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    if (depth[m.index] === 0) return m.index;
  }
  return -1;
}

interface Gap {
  insertAt: number;
  secondStart: number;
  secondEnd: number;
}

/**
 * Find adjacent field tokens in the SELECT list separated only by whitespace
 * (i.e. a missing comma). Operates on the masked source (strings blanked).
 * Bails on aggregate queries, where trailing aliases are legal.
 */
function missingCommaGaps(masked: string): Gap[] {
  const depth = depthArrayOf(masked);
  const selStart = firstTopLevel(masked, depth, /\bSELECT\b/gi);
  if (selStart < 0) return [];
  const selEnd = selStart + "SELECT".length;
  let fromStart = firstTopLevel(masked, depth, /\bFROM\b/gi, selEnd);
  if (fromStart < 0) fromStart = masked.length;

  const body = masked.slice(selEnd, fromStart);
  if (/\b(COUNT|COUNT_DISTINCT|SUM|AVG|MIN|MAX)\s*\(/i.test(body)) return [];

  const gaps: Gap[] = [];
  const pushEntry = (a: number, b: number) => {
    if (masked.slice(a, b).includes("(")) return; // function / subquery entry
    const tre = /[A-Za-z_][A-Za-z0-9_.]*/g;
    const toks: { s: number; e: number; w: string }[] = [];
    let tm: RegExpExecArray | null;
    const seg = masked.slice(a, b);
    while ((tm = tre.exec(seg))) {
      const s = a + tm.index;
      if (depth[s] !== 0) continue;
      toks.push({ s, e: s + tm[0].length, w: tm[0] });
    }
    for (let i = 0; i + 1 < toks.length; i++) {
      const t0 = toks[i];
      const t1 = toks[i + 1];
      if (RESERVED.has(t0.w.toUpperCase()) || RESERVED.has(t1.w.toUpperCase()))
        continue;
      if (!/^\s+$/.test(masked.slice(t0.e, t1.s))) continue;
      gaps.push({ insertAt: t0.e, secondStart: t1.s, secondEnd: t1.e });
      break; // one suggestion per SELECT entry
    }
  };

  let entryStart = selEnd;
  for (let i = selEnd; i < fromStart; i++) {
    if (masked[i] === "," && depth[i] === 0) {
      pushEntry(entryStart, i);
      entryStart = i + 1;
    }
  }
  pushEntry(entryStart, fromStart);
  return gaps;
}
