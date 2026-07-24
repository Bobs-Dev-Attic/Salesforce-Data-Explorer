/**
 * SOQL auto-formatter.
 *
 * Pure, dependency-free. Reflows a query into a canonical multi-line layout:
 * each top-level clause on its own line, the SELECT field list one field per
 * indented line, and top-level AND/OR in WHERE broken onto indented lines.
 *
 * Deliberately conservative: it only *moves whitespace* and uppercases the
 * structural clause keywords it anchors on. It never rewrites operators, field
 * names, or string literals, and it leaves the contents of parenthesised
 * subqueries on a single line (their inner clauses sit at depth > 0, so they're
 * never treated as top-level). Non-SELECT input is returned untouched.
 */

const INDENT = "    "; // 4 spaces

interface Scan {
  depth: number[];
  inStr: boolean[];
}

function scan(s: string): Scan {
  const depth = new Array<number>(s.length);
  const inStr = new Array<boolean>(s.length);
  let d = 0;
  let str = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      depth[i] = d;
      inStr[i] = true;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === "'") str = false;
      continue;
    }
    if (c === "'") {
      str = true;
      depth[i] = d;
      inStr[i] = false; // the opening quote itself is code
      continue;
    }
    if (c === "(") {
      depth[i] = d;
      inStr[i] = false;
      d++;
      continue;
    }
    if (c === ")") {
      d = Math.max(0, d - 1);
      depth[i] = d;
      inStr[i] = false;
      continue;
    }
    depth[i] = d;
    inStr[i] = false;
  }
  return { depth, inStr };
}

/** Collapse whitespace runs to single spaces, preserving string contents. */
function normalizeWhitespace(src: string): string {
  let out = "";
  let str = false;
  let esc = false;
  for (const c of src) {
    if (str) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === "'") str = false;
      continue;
    }
    if (c === "'") {
      str = true;
      out += c;
      continue;
    }
    if (/\s/.test(c)) {
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    out += c;
  }
  return out.trim();
}

/** Split `s` at top-level (depth 0, non-string) occurrences of a single-char separator. */
function splitTopLevelChar(s: string, sep: string): string[] {
  const { depth, inStr } = scan(s);
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === sep && depth[i] === 0 && !inStr[i]) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** Break a WHERE body at top-level AND/OR, keeping the operator at line start. */
function splitConditions(body: string): string[] {
  const { depth, inStr } = scan(body);
  const re = /\b(AND|OR)\b/gi;
  const parts: string[] = [];
  let last = 0;
  let op = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const idx = m.index;
    if (depth[idx] !== 0 || inStr[idx]) continue;
    // Require surrounding whitespace so we don't catch substrings.
    const before = body[idx - 1];
    const after = body[idx + m[0].length];
    if (before !== " " || after !== " ") continue;
    const seg = body.slice(last, idx).trim();
    parts.push(op ? `${op} ${seg}` : seg);
    op = m[1].toUpperCase();
    last = idx + m[0].length;
  }
  const tail = body.slice(last).trim();
  parts.push(op ? `${op} ${tail}` : tail);
  return parts.filter((p) => p.length > 0);
}

const CLAUSE_RE =
  /\b(SELECT|FROM|WHERE|WITH|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|FOR)\b/gi;

interface Clause {
  kw: string;
  body: string;
}

function findClauses(norm: string): Clause[] | null {
  const { depth, inStr } = scan(norm);
  const marks: { kw: string; start: number; bodyStart: number }[] = [];
  let m: RegExpExecArray | null;
  CLAUSE_RE.lastIndex = 0;
  while ((m = CLAUSE_RE.exec(norm))) {
    if (depth[m.index] !== 0 || inStr[m.index]) continue;
    const kw = m[0].replace(/\s+/g, " ").toUpperCase();
    marks.push({ kw, start: m.index, bodyStart: m.index + m[0].length });
  }
  if (!marks.length || marks[0].start !== 0 || marks[0].kw !== "SELECT") {
    return null; // not a well-formed SELECT we can safely reflow
  }
  const clauses: Clause[] = [];
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : norm.length;
    clauses.push({
      kw: marks[i].kw,
      body: norm.slice(marks[i].bodyStart, end).trim(),
    });
  }
  return clauses;
}

export function formatSoql(input: string): string {
  const norm = normalizeWhitespace(input);
  if (!norm) return input.trim();
  const clauses = findClauses(norm);
  if (!clauses) return norm; // give back the tidy single line at least

  const lines: string[] = [];
  for (const { kw, body } of clauses) {
    if (kw === "SELECT") {
      const fields = splitTopLevelChar(body, ",");
      if (fields.length <= 1) {
        lines.push(`SELECT ${body}`.trimEnd());
      } else {
        lines.push("SELECT");
        fields.forEach((f, i) =>
          lines.push(`${INDENT}${f}${i < fields.length - 1 ? "," : ""}`)
        );
      }
    } else if (kw === "WHERE") {
      const conds = splitConditions(body);
      lines.push(`WHERE ${conds[0] ?? ""}`.trimEnd());
      for (let i = 1; i < conds.length; i++) lines.push(`${INDENT}${conds[i]}`);
    } else {
      lines.push(body ? `${kw} ${body}` : kw);
    }
  }
  return lines.join("\n");
}
