"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import { useVirtualRows } from "@/lib/useVirtualRows";
import { useColumnWidths } from "@/lib/useColumnWidths";
import ExportMenu, { type ExportFormat } from "@/components/ExportMenu";
import ErrorNotice from "@/components/ErrorNotice";
import {
  friendlyError,
  parseSoqlErrorLocation,
  parseInvalidField,
  isMissingCommaError,
} from "@/lib/sfError";
import { nearest, distanceBudget } from "@/lib/fuzzy";
import { caretCoordinates } from "@/lib/caretCoords";
import {
  analyzeSoql,
  objectSuggestions,
  fieldSuggestions,
  keywordSuggestions,
  picklistSuggestions,
  resolveRelationship,
  fromObjectOf,
  type Suggestion,
  type FieldMeta,
  type ObjectMeta,
} from "@/lib/soqlComplete";
import { lintSoql, type Diagnostic, type Fix } from "@/lib/soqlLint";
import { formatSoql } from "@/lib/soqlFormat";

const ROW_HEIGHT = 33; // fixed height of a result row (cells are nowrap)

// ---- SOQL syntax highlighting ----
const SOQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "ORDER", "BY",
  "GROUP", "HAVING", "LIMIT", "OFFSET", "ASC", "DESC", "NULLS", "FIRST", "LAST",
  "NULL", "TRUE", "FALSE", "COUNT", "SUM", "AVG", "MIN", "MAX", "TYPEOF",
  "WHEN", "THEN", "ELSE", "END", "USING", "SCOPE", "WITH", "DATA", "CATEGORY",
  "FOR", "VIEW", "REFERENCE", "UPDATE", "TRACKING", "INCLUDES", "EXCLUDES",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightSoql(src: string): string {
  const kw = SOQL_KEYWORDS.join("|");
  const re = new RegExp(
    `('(?:[^'\\\\]|\\\\.)*')|\\b(${kw})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`,
    "gi"
  );
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    if (m[1]) out += `<span class="tok-str">${escapeHtml(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-kw">${escapeHtml(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-num">${escapeHtml(m[3])}</span>`;
    last = re.lastIndex;
  }
  out += escapeHtml(src.slice(last));
  // Trailing newline needs a filler so the overlay's height matches the textarea.
  return out.endsWith("\n") ? out + " " : out;
}

/**
 * Transparent overlay that draws only wavy underlines under diagnostic ranges,
 * layered above the highlight and below the (transparent-text) textarea.
 */
function buildLintOverlay(src: string, diags: Diagnostic[]): string {
  // Merge to non-overlapping ranges, keeping the strongest severity.
  const sorted = [...diags].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let last = 0;
  let cursor = -1;
  for (const d of sorted) {
    const start = Math.max(d.start, cursor);
    if (start >= d.end) continue; // fully covered by a prior range
    out += escapeHtml(src.slice(last, Math.max(last, d.start)));
    const cls = d.severity === "error" ? "lint-err" : "lint-warn";
    out += `<span class="${cls}" title="${escapeHtml(d.message)}">${escapeHtml(
      src.slice(start, d.end)
    )}</span>`;
    last = d.end;
    cursor = d.end;
  }
  out += escapeHtml(src.slice(last));
  return out.endsWith("\n") ? out + " " : out;
}

/** Char offset of a 1-based line/column within the text. */
function offsetOf(text: string, line: number, col: number): number {
  const lines = text.split("\n");
  let off = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1;
  return Math.min(text.length, off + Math.max(0, col - 1));
}

/** End of the identifier starting at `start` (or one char if none). */
function wordEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
  return i > start ? i : Math.min(text.length, start + 1);
}

/** Build a diagnostic from a server validation error, anchored if we have a location. */
function serverDiagnostic(
  text: string,
  message: string,
  loc: { line: number; col: number } | null,
  fix?: Fix
): Diagnostic {
  if (loc) {
    const start = offsetOf(text, loc.line, loc.col);
    return {
      start,
      end: wordEnd(text, start),
      line: loc.line,
      col: loc.col,
      message,
      severity: "error",
      fix,
    };
  }
  return { start: 0, end: 0, line: 1, col: 1, message, severity: "error", fix };
}

interface SoqlResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

interface SavedQuery {
  id: string;
  name: string;
  soql: string;
  builder_state?: { colWidths?: Record<string, number> } | null;
}

const TEMPLATES: { label: string; soql: string }[] = [
  { label: "Recent Accounts", soql: "SELECT Id, Name, CreatedDate\nFROM Account\nORDER BY CreatedDate DESC\nLIMIT 100" },
  { label: "Contacts w/ Account", soql: "SELECT Id, Name, Email, Account.Name\nFROM Contact\nLIMIT 100" },
  { label: "Open Opportunities", soql: "SELECT Id, Name, Amount, StageName, CloseDate\nFROM Opportunity\nWHERE IsClosed = false\nORDER BY CloseDate ASC\nLIMIT 100" },
  { label: "Count by owner", soql: "SELECT OwnerId, COUNT(Id)\nFROM Account\nGROUP BY OwnerId" },
];

const LIMITS = [100, 200, 500, 1000, 2000, 5000];

function columnsFrom(records: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (k === "attributes" || seen.has(k)) continue;
      seen.add(k);
      cols.push(k);
    }
  }
  return cols;
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.records)) return `${(obj.records as unknown[]).length} row(s)`;
    if ("attributes" in obj) {
      const { attributes, ...rest } = obj;
      void attributes;
      return Object.values(rest).filter(Boolean).join(" · ");
    }
    return JSON.stringify(v);
  }
  return String(v);
}

const DEFAULT_QUERY = "SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 100";

export default function QueryRunner() {
  const [soql, setSoql] = usePersistentState("sfde.soql.text", DEFAULT_QUERY);
  const [limit, setLimit] = usePersistentState("sfde.soql.limit", 200);
  const [wrap, setWrap] = usePersistentState("sfde.soql.wrap", false);
  const [result, setResult] = useState<SoqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const justSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const resultScrollRef = useRef<HTMLDivElement>(null);

  // ---- Autocomplete (intellisense) ----
  const objectsRef = useRef<ObjectMeta[]>([]);
  const describeCacheRef = useRef<Map<string, FieldMeta[]>>(new Map());
  const acReqRef = useRef(0);
  const acTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acListRef = useRef<HTMLUListElement>(null);
  const [ac, setAc] = useState<{
    items: Suggestion[];
    active: number;
    top: number;
    left: number;
    tokenStart: number;
    caret: number;
    navigated: boolean;
  } | null>(null);

  // ---- Linter (intellisense Phase 2) ----
  const lintPreRef = useRef<HTMLPreElement>(null);
  const lintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  // ---- Server validation (intellisense Phase 3) ----
  const [validating, setValidating] = useState(false);
  const [serverDiag, setServerDiag] = useState<Diagnostic | null>(null);
  const [serverValid, setServerValid] = useState(false);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/salesforce/saved-queries");
      const data = await res.json();
      if (res.ok) {
        setSaved(data.queries || []);
        setNeedsMigration(Boolean(data.needsMigration));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Load the global object list once for FROM-clause autocomplete.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/salesforce/objects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.objects)) objectsRef.current = d.objects;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureDescribe = useCallback(
    async (name: string): Promise<FieldMeta[]> => {
      const key = name.toLowerCase();
      const cached = describeCacheRef.current.get(key);
      if (cached) return cached;
      try {
        const res = await fetch(
          `/api/salesforce/objects/${encodeURIComponent(name)}`
        );
        if (!res.ok) {
          describeCacheRef.current.set(key, []);
          return [];
        }
        const d = await res.json();
        const fields: FieldMeta[] = Array.isArray(d.fields)
          ? d.fields.map(
              (f: {
                name: string;
                label: string;
                type?: string;
                relationshipName?: string | null;
                referenceTo?: string[] | null;
                picklistValues?: {
                  value: string;
                  label?: string;
                  active?: boolean;
                }[];
              }) => ({
                name: f.name,
                label: f.label,
                type: f.type,
                relationshipName: f.relationshipName,
                referenceTo: f.referenceTo,
                picklistValues: f.picklistValues,
              })
            )
          : [];
        describeCacheRef.current.set(key, fields);
        return fields;
      } catch {
        describeCacheRef.current.set(key, []);
        return [];
      }
    },
    []
  );

  const refreshAc = useCallback(async () => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? 0;
    const ctx = analyzeSoql(ta.value, caret);
    if (!ctx) {
      setAc(null);
      return;
    }
    const reqId = ++acReqRef.current;
    let items: Suggestion[] = [];
    if (ctx.kind === "object") {
      items = objectSuggestions(objectsRef.current, ctx.token);
    } else if (ctx.kind === "keyword") {
      items = keywordSuggestions(ctx.token);
    } else if (ctx.kind === "field" && ctx.fromObject) {
      items = fieldSuggestions(await ensureDescribe(ctx.fromObject), ctx.token);
    } else if (ctx.kind === "relationship" && ctx.fromObject) {
      let fields = await ensureDescribe(ctx.fromObject);
      let ok = true;
      for (const seg of ctx.relationshipPath) {
        const target = resolveRelationship(fields, seg);
        if (!target) {
          ok = false;
          break;
        }
        fields = await ensureDescribe(target);
      }
      items = ok ? fieldSuggestions(fields, ctx.token) : [];
    } else if (ctx.kind === "picklist" && ctx.fromObject) {
      const fields = await ensureDescribe(ctx.fromObject);
      const f = fields.find(
        (x) => x.name.toLowerCase() === ctx.fieldForPicklist?.toLowerCase()
      );
      items = picklistSuggestions(f, ctx.token);
    }
    if (reqId !== acReqRef.current) return; // a newer request superseded this
    if (items.length === 0) {
      setAc(null);
      return;
    }
    // Guard against a stale caret: if the selection moved while metadata was
    // being fetched, don't pop a menu anchored to where the caret used to be.
    if ((ta.selectionStart ?? 0) !== caret) return;
    const coords = caretCoordinates(ta, ctx.tokenStart);
    setAc({
      items,
      active: 0,
      top: coords.top - ta.scrollTop + coords.height,
      left: coords.left - ta.scrollLeft,
      tokenStart: ctx.tokenStart,
      caret,
      navigated: false,
    });
  }, [ensureDescribe]);

  // Debounce the popup so it appears after a brief pause, not on every keystroke.
  const closeAc = useCallback(() => {
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    setAc(null);
  }, []);

  const scheduleAc = useCallback(() => {
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    acTimerRef.current = setTimeout(() => void refreshAc(), 130);
  }, [refreshAc]);

  const acceptSuggestion = useCallback(
    (s: Suggestion) => {
      const ta = taRef.current;
      if (!ta || !ac) return;
      const next = soql.slice(0, ac.tokenStart) + s.value + soql.slice(ac.caret);
      const pos = ac.tokenStart + s.value.length;
      setSoql(next);
      setAc(null);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    },
    [ac, soql, setSoql]
  );

  // Keep the highlighted active option scrolled into view.
  useEffect(() => {
    if (!ac || !acListRef.current) return;
    const node = acListRef.current.children[ac.active] as
      | HTMLElement
      | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [ac]);

  const runLint = useCallback(async () => {
    const ta = taRef.current;
    const text = ta ? ta.value : soql;
    const caret = ta ? ta.selectionStart ?? -1 : -1;
    const objectNames = objectsRef.current.length
      ? new Set(objectsRef.current.map((o) => o.name.toLowerCase()))
      : null;
    // Only validate fields when the FROM object is one we can describe.
    const from = fromObjectOf(text);
    let fields: Set<string> | null = null;
    let fieldList: string[] | null = null;
    if (from && (!objectNames || objectNames.has(from.toLowerCase()))) {
      const describe = await ensureDescribe(from);
      if (describe.length) {
        fields = new Set(describe.map((f) => f.name.toLowerCase()));
        fieldList = describe.map((f) => f.name);
      }
    }
    setDiagnostics(
      lintSoql(text, { objects: objectNames, fields, fieldList }, caret)
    );
  }, [soql, ensureDescribe]);

  // Debounced lint on text/caret changes.
  const scheduleLint = useCallback(() => {
    if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
    lintTimerRef.current = setTimeout(() => void runLint(), 250);
  }, [runLint]);

  // Lint once on mount and whenever the query text changes.
  useEffect(() => {
    scheduleLint();
    return () => {
      if (lintTimerRef.current) clearTimeout(lintTimerRef.current);
    };
  }, [soql, scheduleLint]);

  // Clear any pending timers on unmount.
  useEffect(
    () => () => {
      if (acTimerRef.current) clearTimeout(acTimerRef.current);
      if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
    },
    []
  );

  function jumpTo(d: Diagnostic) {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(d.start, d.end);
    void runLint();
  }

  const validate = useCallback(async () => {
    const text = taRef.current?.value ?? soql;
    if (!text.trim()) return;
    setValidating(true);
    setServerValid(false);
    setServerDiag(null);
    try {
      const res = await fetch("/api/salesforce/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerDiag(
          serverDiagnostic(text, data.error || "Validation failed", null)
        );
        return;
      }
      if (data.valid) {
        setServerValid(true);
        return;
      }
      const fe = friendlyError(data.error);
      const loc = parseSoqlErrorLocation(data.error);
      let message = fe.hint ? `${fe.title} — ${fe.hint}` : fe.title;
      let fix: Fix | undefined;

      if (isMissingCommaError(data.error) && loc) {
        // Insert a comma just before the aliased token Salesforce points at.
        let ins = offsetOf(text, loc.line, loc.col);
        while (ins > 0 && /\s/.test(text[ins - 1])) ins--;
        fix = { start: ins, end: ins, replacement: ",", label: "Insert comma" };
        message = "Missing comma between fields";
      } else {
        const inv = parseInvalidField(data.error);
        if (inv && loc) {
          const from = fromObjectOf(text);
          const describe = from ? await ensureDescribe(from) : [];
          const guess = nearest(
            inv.column,
            describe.map((f) => f.name),
            distanceBudget(inv.column)
          );
          if (guess) {
            const off = offsetOf(text, loc.line, loc.col);
            fix = {
              start: off,
              end: off + inv.column.length,
              replacement: guess,
              label: `Use '${guess}'`,
            };
            message = `${fe.title} — did you mean '${guess}'?`;
          }
        }
      }
      setServerDiag(serverDiagnostic(text, message, loc, fix));
    } catch {
      setServerDiag(serverDiagnostic(text, "Network error during validation", null));
    } finally {
      setValidating(false);
    }
  }, [soql, ensureDescribe]);

  const applyFix = useCallback(
    (fix: Fix) => {
      const base = taRef.current?.value ?? soql;
      const next = base.slice(0, fix.start) + fix.replacement + base.slice(fix.end);
      setSoql(next);
      setServerDiag(null);
      setServerValid(false);
      const pos = fix.start + fix.replacement.length;
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(pos, pos);
        }
      });
    },
    [soql, setSoql]
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setResult(null);
    try {
      const res = await fetch("/api/salesforce/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql, maxRecords: limit }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Query failed");
      } else {
        setResult(data);
        setStatus(
          `Success. ${data.records.length} of ${data.totalSize} row(s)${
            data.done ? "" : " (truncated)"
          }`
        );
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [soql, limit]);

  async function exportData(format: ExportFormat) {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/salesforce/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql, maxRecords: 50000, format }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `soql-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function saveCurrent() {
    const name = prompt("Save query as:");
    if (!name || !name.trim()) return;
    try {
      const res = await fetch("/api/salesforce/saved-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          soql,
          builderState: { colWidths: colw.widths },
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to save");
      else {
        await loadSaved();
        // Flag the new entry so the sidebar can flash a "New" indicator that
        // fades over 60s.
        const newId: string | null = data.query?.id ?? null;
        if (newId) {
          setJustSavedId(newId);
          if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
          justSavedTimerRef.current = setTimeout(
            () => setJustSavedId(null),
            60000
          );
        }
      }
    } catch {
      setError("Network error");
    }
  }

  async function deleteSaved(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this saved query?")) return;
    await fetch(`/api/salesforce/saved-queries/${id}`, { method: "DELETE" });
    await loadSaved();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Run always wins, even with the autocomplete menu open.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      closeAc();
      run();
      return;
    }
    if (ac) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAc((a) =>
          a
            ? { ...a, active: (a.active + 1) % a.items.length, navigated: true }
            : a
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAc((a) =>
          a
            ? {
                ...a,
                active: (a.active - 1 + a.items.length) % a.items.length,
                navigated: true,
              }
            : a
        );
        return;
      }
      // Tab always accepts the highlighted item.
      if (e.key === "Tab") {
        e.preventDefault();
        acceptSuggestion(ac.items[ac.active]);
        return;
      }
      // Enter accepts only if the user has navigated the list; otherwise it
      // inserts a newline (so typing + Enter works normally, esp. on mobile).
      if (e.key === "Enter") {
        if (ac.navigated) {
          e.preventDefault();
          acceptSuggestion(ac.items[ac.active]);
        } else {
          closeAc();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeAc();
        return;
      }
    }
  }

  function onKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      scheduleLint(); // caret moved without changing text
    }
    const navKeys = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"];
    if (ac && navKeys.includes(e.key)) return;
    if (["Shift", "Control", "Meta", "Alt"].includes(e.key)) return;
    scheduleAc();
  }

  function formatCurrent() {
    const formatted = formatSoql(soql);
    closeAc();
    if (formatted && formatted !== soql) setSoql(formatted);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(formatted.length, formatted.length);
      }
    });
  }

  const lineCount = Math.max(soql.split("\n").length, 1);
  const gutter = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");
  const allDiagnostics = serverDiag ? [...diagnostics, serverDiag] : diagnostics;
  const columns = result ? columnsFrom(result.records) : [];
  const records = result?.records ?? [];
  const win = useVirtualRows(resultScrollRef, records.length, ROW_HEIGHT);
  const colw = useColumnWidths("sfde.soql.colwidths");

  return (
    <div>
      <h1>SOQL Editor</h1>
      <div className="sqled">
        {/* Sidebar */}
        <aside className="sqled-side">
          <button
            className="btn secondary"
            style={{ width: "100%" }}
            onClick={() => {
              setSoql("");
              taRef.current?.focus();
            }}
          >
            + New query
          </button>

          <h3>Saved</h3>
          {needsMigration && (
            <p className="muted" style={{ fontSize: 12, padding: "0 4px" }}>
              Run migration 0003 to enable saving.
            </p>
          )}
          {saved.length === 0 && !needsMigration && (
            <p className="muted" style={{ fontSize: 12, padding: "0 4px" }}>
              No saved queries yet.
            </p>
          )}
          {saved.map((q) => (
            <div
              key={q.id}
              className={`sqled-item${q.id === justSavedId ? " just-saved" : ""}`}
              onClick={() => {
                setSoql(q.soql);
                if (q.builder_state?.colWidths)
                  colw.setWidths(q.builder_state.colWidths);
              }}
              title={q.soql}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {q.name}
                {q.id === justSavedId && (
                  <span className="saved-new" aria-label="Just saved">
                    New
                  </span>
                )}
              </span>
              <button
                className="linkbtn"
                onClick={(e) => deleteSaved(q.id, e)}
                title="Delete"
                aria-label={`Delete saved query ${q.name}`}
              >
                ✕
              </button>
            </div>
          ))}

          <h3>Templates</h3>
          {TEMPLATES.map((t) => (
            <div
              key={t.label}
              className="sqled-item"
              onClick={() => setSoql(t.soql)}
              title={t.soql}
            >
              {t.label}
            </div>
          ))}
        </aside>

        {/* Main editor */}
        <div className="sqled-main">
          <div className="sqled-toolbar">
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Limit
              </span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                style={{ width: "auto" }}
              >
                {LIMITS.map((l) => (
                  <option key={l} value={l}>
                    {l.toLocaleString()} rows
                  </option>
                ))}
              </select>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <label
                className="sqled-wrap-toggle"
                title="Soft-wrap long lines in the editor"
              >
                <input
                  type="checkbox"
                  checked={wrap}
                  onChange={(e) => setWrap(e.target.checked)}
                />
                Wrap
              </label>
              <button
                className="btn secondary"
                onClick={formatCurrent}
                disabled={!soql.trim()}
                title="Auto-format: reflow into canonical multi-line SOQL"
              >
                Format
              </button>
              <button className="btn secondary" onClick={saveCurrent}>
                Save
              </button>
              <button
                className="btn secondary"
                onClick={validate}
                disabled={validating || !soql.trim()}
                title="Validate against Salesforce without running (Query Explain)"
              >
                {validating ? "Checking…" : "Check ✓"}
              </button>
              <button className="btn" onClick={run} disabled={loading}>
                {loading ? "Running…" : "Run ▶"}
              </button>
            </div>
          </div>

          <div className={`sqled-editor${wrap ? " wrap" : ""}`}>
            <div className="sqled-gutter" ref={gutterRef}>
              {gutter}
            </div>
            <div className="sqled-code">
              <pre
                className="sqled-highlight"
                ref={preRef}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: highlightSoql(soql) }}
              />
              <pre
                className="sqled-lint"
                ref={lintPreRef}
                aria-hidden="true"
                dangerouslySetInnerHTML={{
                  __html: buildLintOverlay(soql, allDiagnostics),
                }}
              />
              <textarea
                ref={taRef}
                className="sqled-textarea"
                value={soql}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(e) => {
                  setSoql(e.target.value);
                  scheduleAc();
                  // Server validation result is stale the moment the text changes.
                  if (serverDiag) setServerDiag(null);
                  if (serverValid) setServerValid(false);
                }}
                onKeyDown={onKeyDown}
                onKeyUp={onKeyUp}
                onClick={() => {
                  scheduleAc();
                  scheduleLint();
                }}
                onBlur={() => closeAc()}
                onScroll={(e) => {
                  const t = e.currentTarget;
                  if (gutterRef.current) gutterRef.current.scrollTop = t.scrollTop;
                  if (preRef.current) {
                    preRef.current.scrollTop = t.scrollTop;
                    preRef.current.scrollLeft = t.scrollLeft;
                  }
                  if (lintPreRef.current) {
                    lintPreRef.current.scrollTop = t.scrollTop;
                    lintPreRef.current.scrollLeft = t.scrollLeft;
                  }
                  if (ac) closeAc();
                }}
                placeholder="Write SOQL, then press Run (⌘/Ctrl+Enter)…"
                role="combobox"
                aria-expanded={ac ? true : false}
                aria-controls="soql-ac-list"
                aria-autocomplete="list"
              />
              {ac && (
                <ul
                  className="ac-menu"
                  id="soql-ac-list"
                  ref={acListRef}
                  role="listbox"
                  style={{ top: ac.top, left: ac.left }}
                >
                  {ac.items.map((it, i) => (
                    <li
                      key={it.value + i}
                      role="option"
                      aria-selected={i === ac.active}
                      className={`ac-item${i === ac.active ? " active" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        acceptSuggestion(it);
                      }}
                      onMouseEnter={() =>
                        setAc((a) => (a ? { ...a, active: i } : a))
                      }
                    >
                      <span className="ac-val">{it.label ?? it.value}</span>
                      {it.detail && (
                        <span className="ac-detail">{it.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {(allDiagnostics.length > 0 || serverValid) && (
            <div className="sqled-problems" role="list">
              {serverValid && allDiagnostics.length === 0 && (
                <span className="lintmsg valid" role="listitem">
                  <span aria-hidden="true">✅</span> Valid — Salesforce accepted
                  this query
                </span>
              )}
              {allDiagnostics.slice(0, 8).map((d, i) => (
                <span key={`${d.start}-${i}`} className="lintmsg-group">
                  <button
                    type="button"
                    role="listitem"
                    className={`lintmsg ${d.severity}`}
                    onClick={() => jumpTo(d)}
                    title={`Go to line ${d.line}, column ${d.col}`}
                  >
                    <span aria-hidden="true">
                      {d.severity === "error" ? "⛔" : "⚠️"}
                    </span>{" "}
                    {d.message}{" "}
                    <span className="muted">
                      (Ln {d.line}:{d.col})
                    </span>
                  </button>
                  {d.fix && (
                    <button
                      type="button"
                      className="lintfix"
                      onClick={() => applyFix(d.fix!)}
                      title="Apply this fix"
                    >
                      {d.fix.label}
                    </button>
                  )}
                </span>
              ))}
              {allDiagnostics.length > 8 && (
                <span className="muted" style={{ fontSize: 12, padding: "2px 6px" }}>
                  +{allDiagnostics.length - 8} more
                </span>
              )}
            </div>
          )}

          <div className="sqled-results">
            <div className="sqled-results-head">
              <span
                className={`sqled-status ${
                  error ? "err" : status ? "ok" : ""
                }`}
              >
                {error ? friendlyError(error).title : status ? status : "Ready"}
              </span>
              <ExportMenu
                exporting={exporting}
                disabled={!result || result.records.length === 0}
                onExport={exportData}
              />
            </div>

            {error && (
              <div style={{ padding: 12 }}>
                <ErrorNotice error={error} />
              </div>
            )}

            {result && result.records.length > 0 && (
              <div
                className="table-wrap"
                ref={resultScrollRef}
                style={{ maxHeight: 460, overflowY: "auto", border: "none" }}
              >
                <table className="rz-table" style={{ width: colw.total(columns) }}>
                  <colgroup>
                    {columns.map((c) => (
                      <col key={c} style={{ width: colw.widthOf(c) }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c} style={{ position: "relative" }}>
                          {c}
                          <span
                            className="col-resize"
                            onPointerDown={(e) => colw.startResize(c, e)}
                            title="Drag to resize column"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {win.padTop > 0 && (
                      <tr aria-hidden="true" style={{ height: win.padTop }}>
                        <td
                          colSpan={columns.length}
                          style={{ padding: 0, border: 0 }}
                        />
                      </tr>
                    )}
                    {records.slice(win.start, win.end).map((r, i) => (
                      <tr key={win.start + i}>
                        {columns.map((c) => (
                          <td key={c} title={cellValue(r[c])}>
                            {cellValue(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {win.padBottom > 0 && (
                      <tr aria-hidden="true" style={{ height: win.padBottom }}>
                        <td
                          colSpan={columns.length}
                          style={{ padding: 0, border: 0 }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {result && result.records.length === 0 && (
              <p className="muted" style={{ padding: 14 }}>
                No rows returned.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
