"use client";

import { useEffect, useMemo, useState } from "react";

interface GlobalObject {
  name: string;
  label: string;
  queryable: boolean;
  custom: boolean;
}

interface SObjectField {
  name: string;
  label: string;
  type: string;
  filterable?: boolean;
  sortable?: boolean;
}

interface Filter {
  field: string;
  operator: string;
  value: string;
}

const OPERATORS = ["=", "!=", "<", "<=", ">", ">=", "LIKE", "IN", "NOT IN"];

// Salesforce field types whose SOQL literals must be single-quoted.
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

function formatValue(type: string | undefined, raw: string, force = false): string {
  const v = raw.trim();
  if (force || needsQuote(type)) return quote(v);
  return v; // numbers, booleans, dates, datetimes — used as typed
}

function buildSoql(params: {
  object: string;
  columns: string[];
  filters: Filter[];
  logic: string;
  orderBy: string;
  orderDir: string;
  limit: string;
  fieldType: (name: string) => string | undefined;
}): string {
  const { object, columns, filters, logic, orderBy, orderDir, limit } = params;
  if (!object) return "";
  const cols = columns.length ? columns.join(", ") : "Id";
  let q = `SELECT ${cols} FROM ${object}`;

  const clauses = filters
    .filter((f) => f.field && f.operator && f.value.trim() !== "")
    .map((f) => {
      const type = params.fieldType(f.field);
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
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("attributes" in obj) {
      const { attributes, ...rest } = obj;
      void attributes;
      return Object.values(rest).filter(Boolean).join(" · ");
    }
    return JSON.stringify(v);
  }
  return String(v);
}

export default function DataExplorer() {
  const [objects, setObjects] = useState<GlobalObject[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(true);
  const [selectedObject, setSelectedObject] = useState("");
  const [objectFilter, setObjectFilter] = useState("");

  const [fields, setFields] = useState<SObjectField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [fieldFilter, setFieldFilter] = useState("");

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

  // Load queryable objects
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
        } else {
          setError(data.error || "Failed to load objects");
        }
      } catch {
        setError("Network error");
      } finally {
        setObjectsLoading(false);
      }
    })();
  }, []);

  // Load fields when an object is chosen
  useEffect(() => {
    if (!selectedObject) return;
    setFieldsLoading(true);
    setFields([]);
    setColumns([]);
    setFilters([]);
    setOrderBy("");
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
          })
        );
        setFields(fs);
        // Default to Id + Name if present, else first 5 fields.
        const defaults = fs
          .filter((f) => ["Id", "Name"].includes(f.name))
          .map((f) => f.name);
        setColumns(
          defaults.length ? defaults : fs.slice(0, 5).map((f) => f.name)
        );
      } catch {
        setError("Network error");
      } finally {
        setFieldsLoading(false);
      }
    })();
  }, [selectedObject]);

  const fieldType = (name: string) =>
    fields.find((f) => f.name === name)?.type;

  const soql = useMemo(
    () =>
      buildSoql({
        object: selectedObject,
        columns,
        filters,
        logic,
        orderBy,
        orderDir,
        limit,
        fieldType,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedObject, columns, filters, logic, orderBy, orderDir, limit, fields]
  );

  const filteredObjects = useMemo(() => {
    const f = objectFilter.trim().toLowerCase();
    if (!f) return objects;
    return objects.filter(
      (o) =>
        o.name.toLowerCase().includes(f) || o.label.toLowerCase().includes(f)
    );
  }, [objects, objectFilter]);

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

  async function exportCsv() {
    if (!soql) return;
    try {
      const res = await fetch("/api/salesforce/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql, maxRecords: 50000 }),
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
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed");
    }
  }

  function copySoql() {
    navigator.clipboard?.writeText(soql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const resultColumns = result
    ? (() => {
        const seen = new Set<string>();
        const cols: string[] = [];
        for (const r of result.records) {
          for (const k of Object.keys(r)) {
            if (k === "attributes" || seen.has(k)) continue;
            seen.add(k);
            cols.push(k);
          }
        }
        return cols;
      })()
    : [];

  return (
    <div>
      <h1>Data Explorer</h1>
      <p className="muted">
        Pick an object, choose columns, add filters — the SOQL is generated for
        you and you can run or export it.
      </p>
      {error && <div className="alert error">{error}</div>}

      {/* Object picker */}
      <div className="card">
        <label htmlFor="obj">Object</label>
        <input
          id="obj"
          list="obj-list"
          placeholder={objectsLoading ? "Loading objects…" : "Type to search…"}
          value={objectFilter || selectedObject}
          onChange={(e) => setObjectFilter(e.target.value)}
          onBlur={(e) => {
            const match = objects.find(
              (o) =>
                o.name.toLowerCase() === e.target.value.trim().toLowerCase()
            );
            if (match) {
              setSelectedObject(match.name);
              setObjectFilter("");
            }
          }}
        />
        <datalist id="obj-list">
          {filteredObjects.slice(0, 200).map((o) => (
            <option key={o.name} value={o.name}>
              {o.label}
            </option>
          ))}
        </datalist>
        {selectedObject && (
          <p className="muted" style={{ marginTop: 8 }}>
            Selected: <code>{selectedObject}</code>
          </p>
        )}
      </div>

      {selectedObject && (
        <div className="grid2">
          {/* Columns */}
          <div className="card">
            <h2>Columns</h2>
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
                  <button
                    className="btn secondary"
                    onClick={() => setColumns([])}
                  >
                    None
                  </button>
                  <span className="muted">{columns.length} selected</span>
                </div>
                <div className="list" style={{ maxHeight: 360 }}>
                  {filteredFields.map((f) => (
                    <label
                      key={f.name}
                      className="list-item"
                      style={{ display: "flex", gap: 8, cursor: "pointer" }}
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
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Filters + options */}
          <div className="card">
            <h2>Filters</h2>
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
                  {fields
                    .filter((x) => x.filterable !== false)
                    .map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name}
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
                <input
                  placeholder={
                    f.operator.includes("IN") ? "a, b, c" : "value"
                  }
                  value={f.value}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                />
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
                <select
                  value={orderBy}
                  onChange={(e) => setOrderBy(e.target.value)}
                >
                  <option value="">(none)</option>
                  {fields
                    .filter((x) => x.sortable !== false)
                    .map((x) => (
                      <option key={x.name} value={x.name}>
                        {x.name}
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
          </div>
        </div>
      )}

      {/* Generated SOQL */}
      {selectedObject && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Generated SOQL</h2>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary" onClick={copySoql}>
                {copied ? "Copied!" : "Copy"}
              </button>
              <button className="btn secondary" onClick={exportCsv}>
                Export CSV
              </button>
              <button className="btn" onClick={run} disabled={running || !soql}>
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </div>
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
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="card">
          <p className="muted">
            {result.records.length} of {result.totalSize} record(s)
            {!result.done && " (truncated)"}
          </p>
          {result.records.length > 0 ? (
            <div
              className="table-wrap"
              style={{ maxHeight: 560, overflowY: "auto" }}
            >
              <table>
                <thead>
                  <tr>
                    {resultColumns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((r, i) => (
                    <tr key={i}>
                      {resultColumns.map((c) => (
                        <td key={c} title={cellValue(r[c])}>
                          {cellValue(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No records returned.</p>
          )}
        </div>
      )}
    </div>
  );
}
