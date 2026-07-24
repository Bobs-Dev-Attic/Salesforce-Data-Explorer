/**
 * SOQL autocomplete engine (Phase 1).
 *
 * Pure, dependency-free context analysis + ranking. The React editor supplies
 * Salesforce describe metadata; this module decides *what* to suggest at the
 * caret and *how* to rank candidates. Everything here is synchronous and
 * unit-testable — no fetching, no DOM.
 */

export interface FieldMeta {
  name: string;
  label: string;
  type?: string;
  /** Relationship name for lookup/master-detail fields (e.g. "Account"). */
  relationshipName?: string | null;
  /** Objects a reference field points to (first entry is used for traversal). */
  referenceTo?: string[] | null;
  picklistValues?: { value: string; label?: string; active?: boolean }[];
}

export interface ObjectMeta {
  name: string;
  label: string;
}

export type CompletionKind =
  | "object"
  | "field"
  | "relationship"
  | "picklist"
  | "keyword";

export interface SoqlContext {
  kind: CompletionKind;
  /** The partial word under the caret that a chosen suggestion replaces. */
  token: string;
  /** Index in the source where `token` begins (the replace range start). */
  tokenStart: number;
  /** The object named after FROM, if any. */
  fromObject: string | null;
  /**
   * Relationship prefix for a dotted token. For `Account.Nam` this is
   * ["Account"]; empty for a plain field.
   */
  relationshipPath: string[];
  /** For picklist completion, the field whose values we complete. */
  fieldForPicklist?: string;
}

export const SOQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "ORDER BY",
  "GROUP BY", "HAVING", "LIMIT", "OFFSET", "ASC", "DESC", "NULLS FIRST",
  "NULLS LAST", "NULL", "TRUE", "FALSE", "COUNT", "COUNT_DISTINCT", "SUM",
  "AVG", "MIN", "MAX", "FOR VIEW", "FOR REFERENCE", "FOR UPDATE",
];

// Clause keywords whose scope means "a field is expected here".
const FIELD_CLAUSE = /\b(SELECT|WHERE|HAVING|ORDER\s+BY|GROUP\s+BY)\b/gi;

/** True when the caret sits inside an unterminated single-quoted string. */
function insideString(before: string): boolean {
  let inStr = false;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === "\\") {
      i++; // skip escaped char
      continue;
    }
    if (c === "'") inStr = !inStr;
  }
  return inStr;
}

/** The FROM object of the (outermost) query, if present. */
export function fromObjectOf(text: string): string | null {
  const m = text.match(/\bFROM\s+([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

/**
 * Analyze the query at `caret` and decide what kind of completion applies.
 * Returns null when no useful suggestion context exists (e.g. empty token
 * mid-whitespace where popping a menu would only be noise).
 */
export function analyzeSoql(text: string, caret: number): SoqlContext | null {
  const before = text.slice(0, caret);
  const fromObject = fromObjectOf(text);

  // --- Picklist: caret inside a string literal following `field = '...` ---
  if (insideString(before)) {
    const quote = before.lastIndexOf("'");
    const partial = before.slice(quote + 1);
    // The field to the left of the opening quote's comparator.
    const seg = before.slice(0, quote);
    const fm = seg.match(
      /([A-Za-z0-9_.]+)\s*(?:=|!=|<>|LIKE|IN\s*\(\s*)\s*$/i
    );
    if (fm) {
      return {
        kind: "picklist",
        token: partial,
        tokenStart: quote + 1,
        fromObject,
        relationshipPath: [],
        fieldForPicklist: fm[1],
      };
    }
    return null; // in a string but not a recognizable picklist spot
  }

  // --- The identifier token under the caret ---
  const tm = before.match(/[A-Za-z0-9_.]*$/);
  const raw = tm ? tm[0] : "";
  const tokenStart = caret - raw.length;

  // --- FROM operand: `... FROM <caret>` (a single object name) ---
  if (/\bFROM\s+[A-Za-z0-9_]*$/i.test(before) && !raw.includes(".")) {
    return {
      kind: "object",
      token: raw,
      tokenStart,
      fromObject,
      relationshipPath: [],
    };
  }

  // --- Relationship traversal: token contains a dot ---
  if (raw.includes(".")) {
    const parts = raw.split(".");
    const partial = parts.pop() ?? "";
    return {
      kind: "relationship",
      token: partial,
      tokenStart: caret - partial.length,
      fromObject,
      relationshipPath: parts,
    };
  }

  // --- Field vs keyword, by the nearest clause keyword before the token ---
  let lastFieldClause = -1;
  FIELD_CLAUSE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_CLAUSE.exec(before))) {
    if (m.index < tokenStart) lastFieldClause = m.index;
  }
  const fromMatch = /\bFROM\b/gi.exec(before);
  const lastFrom = lastFromIndex(before, tokenStart);
  void fromMatch;

  if (lastFieldClause > lastFrom && fromObject) {
    return {
      kind: "field",
      token: raw,
      tokenStart,
      fromObject,
      relationshipPath: [],
    };
  }

  // Otherwise offer keyword help, but only once the user has typed something.
  if (raw.length === 0) return null;
  return {
    kind: "keyword",
    token: raw,
    tokenStart,
    fromObject,
    relationshipPath: [],
  };
}

function lastFromIndex(before: string, tokenStart: number): number {
  const re = /\bFROM\b/gi;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) {
    if (m.index < tokenStart) idx = m.index;
  }
  return idx;
}

export interface Suggestion {
  /** Text inserted in place of the token. */
  value: string;
  /** Primary display label (defaults to value). */
  label?: string;
  /** Secondary muted detail (type, target object, picklist label…). */
  detail?: string;
}

/**
 * Rank candidates against `token`: prefix matches on the inserted value first,
 * then prefix matches on the label, then substring matches; alphabetical
 * within each tier. Case-insensitive. Empty token returns the alpha-sorted set.
 */
export function rankSuggestions(
  candidates: Suggestion[],
  token: string,
  limit = 50
): Suggestion[] {
  const t = token.trim().toLowerCase();
  const scored: { s: Suggestion; tier: number }[] = [];
  for (const s of candidates) {
    const v = s.value.toLowerCase();
    const l = (s.label ?? s.value).toLowerCase();
    if (!t) {
      scored.push({ s, tier: 0 });
      continue;
    }
    if (v.startsWith(t)) scored.push({ s, tier: 0 });
    else if (l.startsWith(t)) scored.push({ s, tier: 1 });
    else if (v.includes(t) || l.includes(t)) scored.push({ s, tier: 2 });
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.s.value.toLowerCase().localeCompare(b.s.value.toLowerCase())
  );
  return scored.slice(0, limit).map((x) => x.s);
}

/** Suggestions for the SOQL keyword set. */
export function keywordSuggestions(token: string): Suggestion[] {
  return rankSuggestions(
    SOQL_KEYWORDS.map((k) => ({ value: k, detail: "keyword" })),
    token,
    12
  );
}

/** Build field suggestions from a describe field list. */
export function fieldSuggestions(
  fields: FieldMeta[],
  token: string
): Suggestion[] {
  const cands: Suggestion[] = fields.map((f) => ({
    value: f.name,
    label: f.name,
    detail: f.label && f.label !== f.name ? `${f.type ?? ""} · ${f.label}` : f.type,
  }));
  return rankSuggestions(cands, token);
}

/** Build object suggestions from the global object list. */
export function objectSuggestions(
  objects: ObjectMeta[],
  token: string
): Suggestion[] {
  const cands: Suggestion[] = objects.map((o) => ({
    value: o.name,
    label: o.name,
    detail: o.label && o.label !== o.name ? o.label : undefined,
  }));
  return rankSuggestions(cands, token);
}

/**
 * Resolve the target object of a single-hop relationship prefix against the
 * base object's fields. Matches a field whose relationshipName equals the
 * prefix (case-insensitive) and returns its first referenceTo.
 */
export function resolveRelationship(
  baseFields: FieldMeta[],
  relationshipName: string
): string | null {
  const rn = relationshipName.toLowerCase();
  for (const f of baseFields) {
    if (
      f.relationshipName &&
      f.relationshipName.toLowerCase() === rn &&
      f.referenceTo &&
      f.referenceTo.length > 0
    ) {
      return f.referenceTo[0];
    }
  }
  return null;
}

/** Picklist value suggestions for a field. */
export function picklistSuggestions(
  field: FieldMeta | undefined,
  token: string
): Suggestion[] {
  if (!field?.picklistValues?.length) return [];
  const cands: Suggestion[] = field.picklistValues
    .filter((p) => p.active !== false)
    .map((p) => ({
      value: p.value,
      label: p.value,
      detail: p.label && p.label !== p.value ? p.label : undefined,
    }));
  return rankSuggestions(cands, token, 100);
}
