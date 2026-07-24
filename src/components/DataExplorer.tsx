"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  readPersisted,
  writePersisted,
  usePersistentState,
} from "@/lib/usePersistentState";
import { FunnelIcon, FieldMetadataDialog } from "@/components/fieldUi";
import ObjectPicker from "@/components/ObjectPicker";
import ErrorNotice from "@/components/ErrorNotice";
import ExportMenu, { type ExportFormat } from "@/components/ExportMenu";
import ExcelDataView from "@/components/ExcelDataView";
import { useVirtualRows } from "@/lib/useVirtualRows";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useFocusTrap } from "@/lib/useFocusTrap";

const EXPLORER_KEY = "sfde.explorer.state";
const RESULT_ROW_HEIGHT = 33; // fixed height of a result row (cells are nowrap)

interface GlobalObject {
  name: string;
  label: string;
  queryable: boolean;
  custom: boolean;
}

interface PicklistValue {
  value: string;
  label?: string;
  active?: boolean;
}

interface SObjectField {
  name: string;
  label: string;
  type: string;
  filterable?: boolean;
  sortable?: boolean;
  relationshipName?: string | null;
  referenceTo?: string[];
  picklistValues?: PicklistValue[];
}

interface ChildRelationship {
  relationshipName: string | null;
  childSObject: string;
  field: string;
}

interface Filter {
  field: string;
  operator: string;
  value: string;
}

interface SavedQuery {
  id: string;
  name: string;
  object_name: string | null;
  soql: string;
  builder_state: BuilderState | null;
}

interface BuilderState {
  selectedObject: string;
  columns: string[];
  filters: Filter[];
  logic: string;
  orderBy: string;
  orderDir: string;
  limit: string;
  childSelections: Record<string, string[]>;
  colWidths?: Record<string, number>;
}

const OPERATORS = ["=", "!=", "<", "<=", ">", ">=", "LIKE", "IN", "NOT IN"];

const QUOTED_TYPES = new Set([
  "string",
  "id",
  "reference",
  "textarea",
  "picklist",
  "multipicklist",
  "email",
  "phone",
  "url",
  "encryptedstring",
  "combobox",
  "base64",
]);

function needsQuote(type: string | undefined): boolean {
  if (!type) return true;
  return QUOTED_TYPES.has(type.toLowerCase());
}

function quote(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function normalizeDateTime(v: string): string {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return `${s}Z`;
  return s;
}

function formatValue(type: string | undefined, raw: string, force = false): string {
  const v = raw.trim();
  const t = (type || "").toLowerCase();
  if (!force && t === "datetime") return normalizeDateTime(v);
  if (force || needsQuote(type)) return quote(v);
  return v;
}

/** Flatten a record for display: dotted parent fields, child subqueries as counts. */
function flattenForDisplay(rec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "attributes") continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const asRec = v as Record<string, unknown>;
        if (Array.isArray(asRec.records)) {
          out[key] = `${(asRec.records as unknown[]).length} row(s)`;
        } else {
          walk(asRec, key);
        }
      } else {
        out[key] = v === null || v === undefined ? "" : String(v);
      }
    }
  };
  walk(rec, "");
  return out;
}

export default function DataExplorer() {
  const [objects, setObjects] = useState<GlobalObject[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(true);
  const [selectedObject, setSelectedObject] = useState("");

  const [fields, setFields] = useState<SObjectField[]>([]);
  const [childRels, setChildRels] = useState<ChildRelationship[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [fieldFilter, setFieldFilter] = useState("");

  // Parent relationship (lookup) field caches, keyed by relationship name.
  const [relatedCache, setRelatedCache] = useState<
    Record<string, { object: string; fields: SObjectField[] }>
  >({});
  const [expandedRel, setExpandedRel] = useState<Set<string>>(new Set());

  // Child subqueries: selected fields per child relationship name.
  const [childCache, setChildCache] = useState<
    Record<string, { object: string; fields: SObjectField[] }>
  >({});
  const [childSelections, setChildSelections] = useState<
    Record<string, string[]>
  >({});
  const [expandedChild, setExpandedChild] = useState<Set<string>>(new Set());

  const [filters, setFilters] = useState<Filter[]>([]);
  const [logic, setLogic] = useState("AND");
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState("ASC");
  const [limit, setLimit] = useState("50");

  const [result, setResult] = useState<{
    records: Record<string, unknown>[];
    totalSize: number;
    done: boolean;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [savedNeedsMigration, setSavedNeedsMigration] = useState(false);
  // Collapsible sections + the load-confirmation dialog.
  const [savedCollapsed, setSavedCollapsed] = usePersistentState(
    "sfde.explorer.savedCollapsed",
    false
  );
  const [soqlCollapsed, setSoqlCollapsed] = usePersistentState(
    "sfde.explorer.soqlCollapsed",
    false
  );
  const [pendingLoad, setPendingLoad] = useState<SavedQuery | null>(null);
  const [viewMode, setViewMode] = usePersistentState<"classic" | "excel">(
    "sfde.explorer.view",
    "classic"
  );

  // Full describe field objects, keyed by name, for the metadata dialog.
  const [rawFieldMap, setRawFieldMap] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [fieldModal, setFieldModal] = useState<Record<string, unknown> | null>(
    null
  );

  // Results grid: sorting + funnel column filters.
  const [resSortKey, setResSortKey] = useState<string | null>(null);
  const [resSortDir, setResSortDir] = useState<"asc" | "desc">("asc");
  const [resColFilters, setResColFilters] = useState<Record<string, string>>({});
  const [resOpenFilter, setResOpenFilter] = useState<string | null>(null);
  const resFlyoutRef = useRef<HTMLDivElement>(null);
  const resultScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fieldModal && !resOpenFilter) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFieldModal(null);
        setResOpenFilter(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fieldModal, resOpenFilter]);

  useEffect(() => {
    if (!resOpenFilter) return;
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t.closest && t.closest(".funnel-btn")) return;
      if (resFlyoutRef.current && !resFlyoutRef.current.contains(t)) {
        setResOpenFilter(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [resOpenFilter]);

  // When loading a saved query we defer applying its state until the object's
  // fields have loaded (the object-change effect resets columns/filters).
  const restoreRef = useRef<BuilderState | null>(null);

  // ---- Load objects + saved queries ----
  useEffect(() => {
    (async () => {
      setObjectsLoading(true);
      try {
        const res = await fetch("/api/salesforce/objects");
        const data = await res.json();
        if (res.ok) {
          setObjects(
            (data.objects || []).filter((o: GlobalObject) => o.queryable)
          );
        } else setError(data.error || "Failed to load objects");
      } catch {
        setError("Network error");
      } finally {
        setObjectsLoading(false);
      }
    })();
    loadSaved();

    // Restore the builder state persisted from a previous session.
    const persisted = readPersisted<BuilderState>(EXPLORER_KEY);
    if (persisted && persisted.selectedObject) {
      restoreRef.current = persisted;
      setSelectedObject(persisted.selectedObject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist builder state whenever it changes (once an object is chosen and any
  // pending restore has been applied).
  useEffect(() => {
    if (!selectedObject || restoreRef.current) return;
    writePersisted(EXPLORER_KEY, {
      selectedObject,
      columns,
      filters,
      logic,
      orderBy,
      orderDir,
      limit,
      childSelections,
    });
  }, [
    selectedObject,
    columns,
    filters,
    logic,
    orderBy,
    orderDir,
    limit,
    childSelections,
  ]);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/salesforce/saved-queries");
      const data = await res.json();
      if (res.ok) {
        setSaved(data.queries || []);
        setSavedNeedsMigration(Boolean(data.needsMigration));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // ---- Load fields when an object is chosen ----
  useEffect(() => {
    if (!selectedObject) return;
    setFieldsLoading(true);
    setFields([]);
    setChildRels([]);
    setRelatedCache({});
    setExpandedRel(new Set());
    setChildCache({});
    setExpandedChild(new Set());
    setResult(null);
    (async () => {
      try {
        const res = await fetch(`/api/salesforce/objects/${selectedObject}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to describe object");
          return;
        }
        const fs: SObjectField[] = (data.fields || []).map(
          (f: SObjectField) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            filterable: f.filterable,
            sortable: f.sortable,
            relationshipName: f.relationshipName,
            referenceTo: f.referenceTo,
            picklistValues: (f.picklistValues || []).filter(
              (p) => p.active !== false
            ),
          })
        );
        setFields(fs);
        const rawMap: Record<string, Record<string, unknown>> = {};
        for (const f of data.fields || []) rawMap[f.name] = f;
        setRawFieldMap(rawMap);
        setChildRels(
          (data.childRelationships || [])
            .filter((c: ChildRelationship) => c.relationshipName)
            .map((c: ChildRelationship) => ({
              relationshipName: c.relationshipName,
              childSObject: c.childSObject,
              field: c.field,
            }))
        );

        const restore = restoreRef.current;
        if (restore && restore.selectedObject === selectedObject) {
          setColumns(restore.columns);
          setFilters(restore.filters);
          setLogic(restore.logic);
          setOrderBy(restore.orderBy);
          setOrderDir(restore.orderDir);
          setLimit(restore.limit);
          setChildSelections(restore.childSelections || {});
          if (restore.colWidths) colw.setWidths(restore.colWidths);
          restoreRef.current = null;
        } else {
          const defaults = fs
            .filter((f) => ["Id", "Name"].includes(f.name))
            .map((f) => f.name);
          setColumns(
            defaults.length ? defaults : fs.slice(0, 5).map((f) => f.name)
          );
          setFilters([]);
          setOrderBy("");
          setChildSelections({});
        }
      } catch {
        setError("Network error");
      } finally {
        setFieldsLoading(false);
      }
    })();
    // colw.setWidths is stable and this restore is a one-shot on object load;
    // depending on colw would re-run this data-loading effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObject]);

  // ---- Relationship (parent) field loading ----
  const referenceFields = useMemo(
    () =>
      fields.filter(
        (f) =>
          f.type === "reference" &&
          f.relationshipName &&
          (f.referenceTo?.length ?? 0) > 0
      ),
    [fields]
  );

  async function toggleRel(relName: string, parentObject: string) {
    setExpandedRel((s) => {
      const next = new Set(s);
      next.has(relName) ? next.delete(relName) : next.add(relName);
      return next;
    });
    if (!relatedCache[relName]) {
      try {
        const res = await fetch(`/api/salesforce/objects/${parentObject}`);
        const data = await res.json();
        if (res.ok) {
          setRelatedCache((c) => ({
            ...c,
            [relName]: {
              object: parentObject,
              fields: (data.fields || []).map((f: SObjectField) => ({
                name: f.name,
                label: f.label,
                type: f.type,
                filterable: f.filterable,
                sortable: f.sortable,
                picklistValues: (f.picklistValues || []).filter(
                  (p) => p.active !== false
                ),
              })),
            },
          }));
        }
      } catch {
        /* ignore */
      }
    }
  }

  // ---- Child relationship loading ----
  async function toggleChild(relName: string, childObject: string) {
    setExpandedChild((s) => {
      const next = new Set(s);
      next.has(relName) ? next.delete(relName) : next.add(relName);
      return next;
    });
    if (!childCache[relName]) {
      try {
        const res = await fetch(`/api/salesforce/objects/${childObject}`);
        const data = await res.json();
        if (res.ok) {
          setChildCache((c) => ({
            ...c,
            [relName]: {
              object: childObject,
              fields: (data.fields || []).map((f: SObjectField) => ({
                name: f.name,
                label: f.label,
                type: f.type,
              })),
            },
          }));
        }
      } catch {
        /* ignore */
      }
    }
  }

  function toggleChildField(relName: string, fieldName: string) {
    setChildSelections((sel) => {
      const cur = sel[relName] || [];
      const next = cur.includes(fieldName)
        ? cur.filter((f) => f !== fieldName)
        : [...cur, fieldName];
      return { ...sel, [relName]: next };
    });
  }

  // Resolve a (possibly dotted) field's type for filter inputs & quoting.
  const fieldTypeOf = useCallback(
    (name: string): string | undefined => {
      if (name.includes(".")) {
        const [rel, sub] = name.split(".");
        return relatedCache[rel]?.fields.find((f) => f.name === sub)?.type;
      }
      return fields.find((f) => f.name === name)?.type;
    },
    [fields, relatedCache]
  );

  const fieldMeta = useCallback(
    (name: string): SObjectField | undefined => {
      if (name.includes(".")) {
        const [rel, sub] = name.split(".");
        return relatedCache[rel]?.fields.find((f) => f.name === sub);
      }
      return fields.find((f) => f.name === name);
    },
    [fields, relatedCache]
  );

  // Filterable field options: base fields + loaded relationship fields.
  const filterFieldOptions = useMemo(() => {
    const base = fields
      .filter((f) => f.filterable !== false)
      .map((f) => f.name);
    const rel: string[] = [];
    for (const [relName, info] of Object.entries(relatedCache)) {
      for (const f of info.fields) {
        if (f.filterable !== false) rel.push(`${relName}.${f.name}`);
      }
    }
    return [...base, ...rel];
  }, [fields, relatedCache]);

  const sortFieldOptions = useMemo(
    () => fields.filter((f) => f.sortable !== false).map((f) => f.name),
    [fields]
  );

  // ---- Build SOQL ----
  const soql = useMemo(() => {
    if (!selectedObject) return "";
    const childCols = Object.entries(childSelections)
      .filter(([, fs]) => fs.length)
      .map(([rel, fs]) => `(SELECT ${fs.join(", ")} FROM ${rel})`);
    const allCols = [...columns, ...childCols];
    const cols = allCols.length ? allCols.join(", ") : "Id";
    let q = `SELECT ${cols} FROM ${selectedObject}`;

    const clauses = filters
      .filter((f) => f.field && f.operator && f.value.trim() !== "")
      .map((f) => {
        const type = fieldTypeOf(f.field);
        if (f.operator === "IN" || f.operator === "NOT IN") {
          const items = f.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => formatValue(type, s));
          return `${f.field} ${f.operator} (${items.join(", ")})`;
        }
        const force = f.operator === "LIKE";
        return `${f.field} ${f.operator} ${formatValue(type, f.value, force)}`;
      });
    if (clauses.length) q += ` WHERE ${clauses.join(` ${logic} `)}`;
    if (orderBy) q += ` ORDER BY ${orderBy} ${orderDir}`;
    if (limit && Number(limit) > 0) q += ` LIMIT ${Number(limit)}`;
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedObject,
    columns,
    childSelections,
    filters,
    logic,
    orderBy,
    orderDir,
    limit,
    fields,
    relatedCache,
  ]);

  const filteredFields = useMemo(() => {
    const f = fieldFilter.trim().toLowerCase();
    if (!f) return fields;
    return fields.filter(
      (x) =>
        x.name.toLowerCase().includes(f) || x.label.toLowerCase().includes(f)
    );
  }, [fields, fieldFilter]);

  function toggleColumn(name: string) {
    setColumns((cols) =>
      cols.includes(name) ? cols.filter((c) => c !== name) : [...cols, name]
    );
  }
  function addFilter() {
    setFilters((fs) => [...fs, { field: "", operator: "=", value: "" }]);
  }
  function updateFilter(i: number, patch: Partial<Filter>) {
    setFilters((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeFilter(i: number) {
    setFilters((fs) => fs.filter((_, idx) => idx !== i));
  }

  function renderValueInput(f: Filter, i: number) {
    const meta = fieldMeta(f.field);
    const type = (meta?.type || "").toLowerCase();
    const isIn = f.operator === "IN" || f.operator === "NOT IN";
    const set = (v: string) => updateFilter(i, { value: v });
    const pick = meta?.picklistValues || [];

    if (type === "boolean") {
      return (
        <select value={f.value} onChange={(e) => set(e.target.value)}>
          <option value="">value…</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if ((type === "picklist" || type === "multipicklist") && pick.length) {
      if (isIn) {
        const selected = f.value.split(",").map((s) => s.trim()).filter(Boolean);
        return (
          <select
            multiple
            value={selected}
            onChange={(e) =>
              set(
                Array.from(e.target.selectedOptions)
                  .map((o) => o.value)
                  .join(", ")
              )
            }
            style={{ height: 90 }}
          >
            {pick.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label || p.value}
              </option>
            ))}
          </select>
        );
      }
      return (
        <select value={f.value} onChange={(e) => set(e.target.value)}>
          <option value="">value…</option>
          {pick.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label || p.value}
            </option>
          ))}
        </select>
      );
    }
    if (!isIn && type === "date") {
      return (
        <input type="date" value={f.value} onChange={(e) => set(e.target.value)} />
      );
    }
    if (!isIn && type === "datetime") {
      return (
        <input
          type="datetime-local"
          value={f.value}
          onChange={(e) => set(e.target.value)}
        />
      );
    }
    if (!isIn && ["int", "double", "currency", "percent"].includes(type)) {
      return (
        <input
          type="number"
          value={f.value}
          onChange={(e) => set(e.target.value)}
        />
      );
    }
    return (
      <input
        placeholder={isIn ? "a, b, c" : "value"}
        value={f.value}
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  async function run() {
    if (!soql) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/salesforce/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql, maxRecords: 2000 }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Query failed");
      else setResult(data);
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  async function exportData(format: ExportFormat) {
    if (!soql) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/salesforce/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soql,
          maxRecords: 50000,
          format,
          filename: selectedObject || "export",
        }),
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
      a.download = `${selectedObject || "export"}-${new Date()
        .toISOString()
        .slice(0, 10)}.${format}`;
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

  function copySoql() {
    navigator.clipboard?.writeText(soql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // ---- Saved queries ----
  function currentBuilderState(): BuilderState {
    return {
      selectedObject,
      columns,
      filters,
      logic,
      orderBy,
      orderDir,
      limit,
      childSelections,
      colWidths: colw.widths,
    };
  }

  async function saveCurrent(): Promise<boolean> {
    if (!soql) return false;
    const name = prompt("Save query as:");
    if (!name || !name.trim()) return false;
    setError(null);
    try {
      const res = await fetch("/api/salesforce/saved-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objectName: selectedObject,
          soql,
          builderState: currentBuilderState(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
        return false;
      }
      await loadSaved();
      return true;
    } catch {
      setError("Network error");
      return false;
    }
  }

  // Clicking a saved chip asks for confirmation first (see the load dialog).
  function requestLoad(q: SavedQuery) {
    setPendingLoad(q);
  }

  async function confirmSaveAndLoad() {
    const target = pendingLoad;
    if (!target) return;
    const ok = await saveCurrent();
    if (!ok) return; // save cancelled/failed — keep the dialog open
    loadQuery(target);
    setPendingLoad(null);
  }

  function confirmLoad() {
    if (!pendingLoad) return;
    loadQuery(pendingLoad);
    setPendingLoad(null);
  }

  function loadQuery(q: SavedQuery) {
    if (q.builder_state && q.builder_state.selectedObject) {
      restoreRef.current = q.builder_state;
      if (q.builder_state.selectedObject === selectedObject) {
        // Same object already loaded — apply immediately.
        const s = q.builder_state;
        setColumns(s.columns);
        setFilters(s.filters);
        setLogic(s.logic);
        setOrderBy(s.orderBy);
        setOrderDir(s.orderDir);
        setLimit(s.limit);
        setChildSelections(s.childSelections || {});
        if (s.colWidths) colw.setWidths(s.colWidths);
        restoreRef.current = null;
      } else {
        setSelectedObject(q.builder_state.selectedObject);
      }
    }
  }

  async function deleteSaved(id: string) {
    if (!confirm("Delete this saved query?")) return;
    await fetch(`/api/salesforce/saved-queries/${id}`, { method: "DELETE" });
    await loadSaved();
  }

  // ---- Results table (flattened) ----
  const displayRows = useMemo(
    () => (result ? result.records.map(flattenForDisplay) : []),
    [result]
  );
  const resultColumns = useMemo(() => {
    const seen = new Set<string>();
    const cols: string[] = [];
    for (const r of displayRows) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          cols.push(k);
        }
      }
    }
    return cols;
  }, [displayRows]);

  // Apply funnel column filters + header sort to the displayed rows.
  const viewRows = useMemo(() => {
    let rows = displayRows;
    const active = Object.entries(resColFilters).filter(([, v]) => v.trim());
    if (active.length) {
      rows = rows.filter((r) =>
        active.every(([c, v]) =>
          (r[c] ?? "").toLowerCase().includes(v.toLowerCase())
        )
      );
    }
    if (resSortKey) {
      const dir = resSortDir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[resSortKey] ?? "";
        const bv = b[resSortKey] ?? "";
        const an = Number(av);
        const bn = Number(bv);
        if (av !== "" && bv !== "" && !isNaN(an) && !isNaN(bn)) {
          return (an - bn) * dir;
        }
        return av.localeCompare(bv) * dir;
      });
    }
    return rows;
  }, [displayRows, resColFilters, resSortKey, resSortDir]);

  function resSortBy(col: string) {
    if (col === resSortKey) setResSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setResSortKey(col);
      setResSortDir("asc");
    }
  }

  const resultWin = useVirtualRows(
    resultScrollRef,
    viewRows.length,
    RESULT_ROW_HEIGHT
  );
  const colw = useColumnWidths("sfde.explorer.colwidths");

  return (
    <div>
      {error && viewMode !== "excel" && <ErrorNotice error={error} />}
      {viewMode === "excel" ? (
        <ExcelDataView
          errorSlot={error ? <ErrorNotice error={error} /> : null}
          objects={objects}
          objectsLoading={objectsLoading}
          selectedObject={selectedObject}
          onSelectObject={setSelectedObject}
          fieldsLoading={fieldsLoading}
          filteredFields={filteredFields}
          columns={columns}
          toggleColumn={toggleColumn}
          setAllColumns={() => setColumns(fields.map((f) => f.name))}
          clearColumns={() => setColumns([])}
          fieldFilter={fieldFilter}
          setFieldFilter={setFieldFilter}
          filters={filters}
          filterFieldOptions={filterFieldOptions}
          operators={OPERATORS}
          addFilter={addFilter}
          updateFilter={updateFilter}
          removeFilter={removeFilter}
          logic={logic}
          setLogic={setLogic}
          renderValueInput={renderValueInput}
          sortFieldOptions={sortFieldOptions}
          orderBy={orderBy}
          setOrderBy={setOrderBy}
          orderDir={orderDir}
          setOrderDir={setOrderDir}
          limit={limit}
          setLimit={setLimit}
          soql={soql}
          run={run}
          running={running}
          copySoql={copySoql}
          copied={copied}
          exportData={exportData}
          exporting={exporting}
          result={result}
          rows={viewRows}
          resultColumns={resultColumns}
          saved={saved}
          onLoadSaved={(id) => {
            const q = saved.find((s) => s.id === id);
            if (q) requestLoad(q);
          }}
          saveCurrent={saveCurrent}
          onExitExcel={() => setViewMode("classic")}
        />
      ) : (
        <>
          <div
            className="row"
            style={{ justifyContent: "space-between", alignItems: "flex-start" }}
          >
            <div>
              <h1 style={{ marginTop: 0 }}>Data Explorer</h1>
              <p className="muted" style={{ marginTop: 0 }}>
                Pick an object, choose columns (including related and child
                fields), add filters — the SOQL is generated for you and you can
                run, export, or save it.
              </p>
            </div>
            <button
              className="btn secondary"
              onClick={() => setViewMode("excel")}
              title="Switch to the Excel-style view"
            >
              ▦ Excel view
            </button>
          </div>

      {/* Build row: Saved queries · Columns · Filters */}
      <div className="grid3">
        {/* Saved queries (collapsible) */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="linkbtn collapse-toggle"
              aria-expanded={!savedCollapsed}
              onClick={() => setSavedCollapsed((c) => !c)}
            >
              <span aria-hidden="true">{savedCollapsed ? "▸" : "▾"}</span>
              <h2 style={{ margin: 0, display: "inline" }}>Saved queries</h2>
            </button>
            <button
              className="btn secondary"
              onClick={() => saveCurrent()}
              disabled={!soql}
            >
              Save current
            </button>
          </div>
          {!savedCollapsed && (
            <>
              {savedNeedsMigration && (
                <p className="muted" style={{ marginTop: 10 }}>
                  Run <code>0003_saved_queries.sql</code> in Supabase to enable
                  saving.
                </p>
              )}
              {saved.length > 0 ? (
                <div className="actions" style={{ marginTop: 12 }}>
                  {saved.map((q) => (
                    <span key={q.id} className="saved-chip">
                      <button
                        className="linkbtn"
                        onClick={() => requestLoad(q)}
                      >
                        {q.name}
                      </button>
                      <button
                        className="linkbtn"
                        onClick={() => deleteSaved(q.id)}
                        title="Delete"
                        style={{ marginLeft: 6 }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                !savedNeedsMigration && (
                  <p className="muted" style={{ marginTop: 10 }}>
                    No saved queries yet. Build one and click “Save current”.
                  </p>
                )
              )}
            </>
          )}
        </div>

        {/* Columns (with the object picker) */}
        <div className="card">
          <h2>Columns</h2>
          <label htmlFor="obj">Object</label>
          <ObjectPicker
            id="obj"
            objects={objects}
            value={selectedObject}
            onSelect={setSelectedObject}
            placeholder={
              objectsLoading ? "Loading objects…" : "Type to search…"
            }
          />
          {!selectedObject ? (
            <p className="muted" style={{ marginTop: 10 }}>
              Choose an object above to pick columns.
            </p>
          ) : (
            <div style={{ marginTop: 12 }}>
            {fieldsLoading ? (
              <p className="spinner">Loading fields…</p>
            ) : (
              <>
                <input
                  placeholder="Filter fields…"
                  value={fieldFilter}
                  onChange={(e) => setFieldFilter(e.target.value)}
                  style={{ marginBottom: 10 }}
                />
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <button
                    className="btn secondary"
                    onClick={() => setColumns(fields.map((f) => f.name))}
                  >
                    All
                  </button>
                  <button className="btn secondary" onClick={() => setColumns([])}>
                    None
                  </button>
                  <span className="muted">{columns.length} selected</span>
                </div>
                <div className="list" style={{ maxHeight: 300 }}>
                  {filteredFields.map((f) => (
                    <div
                      key={f.name}
                      className="list-item"
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 8,
                          cursor: "pointer",
                          flex: 1,
                          margin: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={columns.includes(f.name)}
                          onChange={() => toggleColumn(f.name)}
                          style={{ width: "auto" }}
                        />
                        <span>
                          <span className="lbl">{f.label}</span>{" "}
                          <span className="api">
                            {f.name} · {f.type}
                          </span>
                        </span>
                      </label>
                      {rawFieldMap[f.name] && (
                        <button
                          className="linkbtn"
                          title="Field metadata"
                          onClick={() => setFieldModal(rawFieldMap[f.name])}
                          style={{ fontSize: 13 }}
                        >
                          ⓘ
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Relationship (parent) fields */}
                {referenceFields.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer" }}>
                      Related (lookup) fields — {referenceFields.length}
                    </summary>
                    <div className="list" style={{ maxHeight: 260, marginTop: 8 }}>
                      {referenceFields.map((rf) => {
                        const rel = rf.relationshipName as string;
                        const parent = rf.referenceTo?.[0] as string;
                        const open = expandedRel.has(rel);
                        const info = relatedCache[rel];
                        return (
                          <div key={rel}>
                            <div
                              className="list-item"
                              onClick={() => toggleRel(rel, parent)}
                              style={{ cursor: "pointer" }}
                            >
                              <span className="lbl">
                                {open ? "▾" : "▸"} {rel}
                              </span>{" "}
                              <span className="api">→ {parent}</span>
                            </div>
                            {open &&
                              (info ? (
                                info.fields.map((sf) => {
                                  const col = `${rel}.${sf.name}`;
                                  return (
                                    <label
                                      key={col}
                                      className="list-item"
                                      style={{
                                        display: "flex",
                                        gap: 8,
                                        paddingLeft: 24,
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={columns.includes(col)}
                                        onChange={() => toggleColumn(col)}
                                        style={{ width: "auto" }}
                                      />
                                      <span>
                                        <span className="api">
                                          {col} · {sf.type}
                                        </span>
                                      </span>
                                    </label>
                                  );
                                })
                              ) : (
                                <div
                                  className="list-item api"
                                  style={{ paddingLeft: 24 }}
                                >
                                  Loading…
                                </div>
                              ))}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {/* Child relationships (subqueries) */}
                {childRels.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer" }}>
                      Child relationships — {childRels.length}
                    </summary>
                    <div className="list" style={{ maxHeight: 260, marginTop: 8 }}>
                      {childRels.map((cr) => {
                        const rel = cr.relationshipName as string;
                        const open = expandedChild.has(rel);
                        const info = childCache[rel];
                        const sel = childSelections[rel] || [];
                        return (
                          <div key={rel}>
                            <div
                              className="list-item"
                              onClick={() => toggleChild(rel, cr.childSObject)}
                              style={{ cursor: "pointer" }}
                            >
                              <span className="lbl">
                                {open ? "▾" : "▸"} {rel}
                              </span>{" "}
                              <span className="api">
                                → {cr.childSObject}
                                {sel.length ? ` · ${sel.length} field(s)` : ""}
                              </span>
                            </div>
                            {open &&
                              (info ? (
                                info.fields.map((sf) => (
                                  <label
                                    key={sf.name}
                                    className="list-item"
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      paddingLeft: 24,
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={sel.includes(sf.name)}
                                      onChange={() =>
                                        toggleChildField(rel, sf.name)
                                      }
                                      style={{ width: "auto" }}
                                    />
                                    <span>
                                      <span className="api">
                                        {sf.name} · {sf.type}
                                      </span>
                                    </span>
                                  </label>
                                ))
                              ) : (
                                <div
                                  className="list-item api"
                                  style={{ paddingLeft: 24 }}
                                >
                                  Loading…
                                </div>
                              ))}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </>
            )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="card">
          <h2>Filters</h2>
          {!selectedObject ? (
            <p className="muted" style={{ marginTop: 10 }}>
              Select an object to add filters.
            </p>
          ) : (
            <>
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <span className="muted">Combine with</span>
              <select
                value={logic}
                onChange={(e) => setLogic(e.target.value)}
                style={{ width: "auto" }}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            </div>

            {filters.map((f, i) => (
              <div
                key={i}
                className="row"
                style={{ gap: 6, marginBottom: 8, flexWrap: "nowrap" }}
              >
                <select
                  value={f.field}
                  onChange={(e) => updateFilter(i, { field: e.target.value })}
                >
                  <option value="">field…</option>
                  {filterFieldOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={(e) => updateFilter(i, { operator: e.target.value })}
                  style={{ width: 110 }}
                >
                  {OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <div style={{ flex: 1 }}>{renderValueInput(f, i)}</div>
                <button
                  className="linkbtn"
                  onClick={() => removeFilter(i)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
            <button className="btn secondary" onClick={addFilter}>
              + Add filter
            </button>

            <div className="row" style={{ gap: 10, marginTop: 16 }}>
              <div style={{ flex: 1 }}>
                <label>Order by</label>
                <select value={orderBy} onChange={(e) => setOrderBy(e.target.value)}>
                  <option value="">(none)</option>
                  {sortFieldOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: 90 }}>
                <label>Dir</label>
                <select
                  value={orderDir}
                  onChange={(e) => setOrderDir(e.target.value)}
                >
                  <option>ASC</option>
                  <option>DESC</option>
                </select>
              </div>
              <div style={{ width: 90 }}>
                <label>Limit</label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
            </div>
            </>
          )}
          </div>
        </div>

      {/* Generated SOQL (collapsible) */}
      {selectedObject && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button
              type="button"
              className="linkbtn collapse-toggle"
              aria-expanded={!soqlCollapsed}
              onClick={() => setSoqlCollapsed((c) => !c)}
            >
              <span aria-hidden="true">{soqlCollapsed ? "▸" : "▾"}</span>
              <h2 style={{ margin: 0, display: "inline" }}>Generated SOQL</h2>
            </button>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary" onClick={copySoql}>
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                className="btn secondary"
                onClick={() => saveCurrent()}
                disabled={!soql}
              >
                Save
              </button>
              <button className="btn" onClick={run} disabled={running || !soql}>
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </div>
          {!soqlCollapsed && (
            <pre
              style={{
                marginTop: 12,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                overflowX: "auto",
                fontFamily:
                  '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
                fontSize: 13,
                whiteSpace: "pre-wrap",
              }}
            >
              {soql}
            </pre>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="card">
          <div
            className="row"
            style={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <p className="muted" style={{ margin: 0 }}>
              {result.records.length} of {result.totalSize} record(s)
              {!result.done && " (truncated)"}
            </p>
            <ExportMenu
              exporting={exporting}
              disabled={!soql || displayRows.length === 0}
              onExport={exportData}
            />
          </div>
          {displayRows.length > 0 ? (
            <div
              className="table-wrap"
              ref={resultScrollRef}
              style={{ maxHeight: 560, overflowY: "auto", marginTop: 12 }}
            >
              <table
                className="rz-table"
                style={{ width: colw.total(resultColumns) }}
              >
                <colgroup>
                  {resultColumns.map((c) => (
                    <col key={c} style={{ width: colw.widthOf(c) }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {resultColumns.map((c) => (
                      <th key={c} style={{ position: "relative" }}>
                        <span
                          onClick={() => resSortBy(c)}
                          style={{ cursor: "pointer", userSelect: "none" }}
                          title="Click to sort"
                        >
                          {c}
                          {resSortKey === c
                            ? resSortDir === "asc"
                              ? " ▲"
                              : " ▼"
                            : ""}
                        </span>
                        <span
                          className="col-resize"
                          onPointerDown={(e) => colw.startResize(c, e)}
                          title="Drag to resize column"
                        />
                        <button
                          className={`funnel-btn${
                            resColFilters[c] ? " active" : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setResOpenFilter((o) => (o === c ? null : c));
                          }}
                          title={
                            resColFilters[c]
                              ? `Filtered: "${resColFilters[c]}"`
                              : "Filter column"
                          }
                          aria-label="Filter column"
                        >
                          <FunnelIcon active={Boolean(resColFilters[c])} />
                        </button>
                        {resOpenFilter === c && (
                          <div className="col-flyout" ref={resFlyoutRef}>
                            <input
                              autoFocus
                              value={resColFilters[c] || ""}
                              onChange={(e) =>
                                setResColFilters((f) => ({
                                  ...f,
                                  [c]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape")
                                  setResOpenFilter(null);
                              }}
                              placeholder={`Filter ${c}…`}
                              style={{ padding: "6px 8px", fontSize: 13 }}
                            />
                            <button
                              className="btn secondary"
                              style={{ padding: "6px 10px", fontSize: 12 }}
                              onClick={() =>
                                setResColFilters((f) => ({ ...f, [c]: "" }))
                              }
                            >
                              Clear
                            </button>
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultWin.padTop > 0 && (
                    <tr aria-hidden="true" style={{ height: resultWin.padTop }}>
                      <td
                        colSpan={resultColumns.length}
                        style={{ padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                  {viewRows.slice(resultWin.start, resultWin.end).map((r, i) => (
                    <tr key={resultWin.start + i}>
                      {resultColumns.map((c) => (
                        <td key={c} title={r[c] ?? ""}>
                          {r[c] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {resultWin.padBottom > 0 && (
                    <tr
                      aria-hidden="true"
                      style={{ height: resultWin.padBottom }}
                    >
                      <td
                        colSpan={resultColumns.length}
                        style={{ padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                  {viewRows.length === 0 && (
                    <tr>
                      <td colSpan={resultColumns.length} className="muted">
                        No rows match the filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No records returned.</p>
          )}
        </div>
      )}
        </>
      )}

      {fieldModal && (
        <FieldMetadataDialog
          field={fieldModal}
          onClose={() => setFieldModal(null)}
        />
      )}

      {pendingLoad && (
        <LoadConfirmDialog
          query={pendingLoad}
          offerSave={Boolean(soql) && !saved.some((s) => s.soql === soql)}
          onCancel={() => setPendingLoad(null)}
          onLoad={confirmLoad}
          onSaveAndLoad={confirmSaveAndLoad}
        />
      )}
    </div>
  );
}

/**
 * Confirms loading a saved query (which replaces the current builder), and —
 * when the current query isn't already saved — offers to save it first.
 */
function LoadConfirmDialog({
  query,
  offerSave,
  onCancel,
  onLoad,
  onSaveAndLoad,
}: {
  query: SavedQuery;
  offerSave: boolean;
  onCancel: () => void;
  onLoad: () => void;
  onSaveAndLoad: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onCancel);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Load saved query"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>Load “{query.name}”?</h2>
          <button className="linkbtn" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ padding: "14px 18px" }}>
          <p style={{ marginTop: 0 }}>
            This replaces your current query with the saved one.
          </p>
          {offerSave && (
            <p className="muted" style={{ marginBottom: 0 }}>
              Your current query isn’t saved — you can save it first so you
              don’t lose it.
            </p>
          )}
          <div
            className="row"
            style={{ gap: 8, marginTop: 18, justifyContent: "flex-end" }}
          >
            <button className="btn secondary" onClick={onCancel}>
              Cancel
            </button>
            {offerSave && (
              <button className="btn secondary" onClick={onSaveAndLoad}>
                Save current &amp; load
              </button>
            )}
            <button className="btn" onClick={onLoad}>
              Load
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
