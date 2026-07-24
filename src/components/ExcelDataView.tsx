"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ExportMenu, { type ExportFormat } from "@/components/ExportMenu";
import ObjectPicker from "@/components/ObjectPicker";
import { useVirtualRows } from "@/lib/useVirtualRows";
import { colLetter, cellRef } from "@/lib/colLetter";

const XL_ROW_H = 24;
const XL_COL_W = 132;
const GUTTER_W = 48;

export interface XlFilter {
  field: string;
  operator: string;
  value: string;
}

export interface ExcelDataViewProps {
  // Source
  objects: { name: string; label: string; queryable: boolean; custom: boolean }[];
  objectsLoading: boolean;
  selectedObject: string;
  onSelectObject: (name: string) => void;
  // Columns
  fieldsLoading: boolean;
  filteredFields: { name: string; label: string; type: string }[];
  columns: string[];
  toggleColumn: (name: string) => void;
  setAllColumns: () => void;
  clearColumns: () => void;
  fieldFilter: string;
  setFieldFilter: (v: string) => void;
  // Filters
  filters: XlFilter[];
  filterFieldOptions: string[];
  operators: string[];
  addFilter: () => void;
  updateFilter: (i: number, patch: Partial<XlFilter>) => void;
  removeFilter: (i: number) => void;
  logic: string;
  setLogic: (v: string) => void;
  renderValueInput: (f: XlFilter, i: number) => React.ReactNode;
  // Sort / limit
  sortFieldOptions: string[];
  orderBy: string;
  setOrderBy: (v: string) => void;
  orderDir: string;
  setOrderDir: (v: string) => void;
  limit: string;
  setLimit: (v: string) => void;
  // Query
  soql: string;
  run: () => void;
  running: boolean;
  copySoql: () => void;
  copied: boolean;
  exportData: (format: ExportFormat) => void;
  exporting: boolean;
  // Results
  result: { totalSize: number; done: boolean } | null;
  rows: Record<string, string>[];
  resultColumns: string[];
  // Saved
  saved: { id: string; name: string }[];
  onLoadSaved: (id: string) => void;
  saveCurrent: () => void;
  // Chrome
  onExitExcel: () => void;
}

type Tab = "home" | "data" | "view";
type Panel = "columns" | "filters" | "saved" | null;

export default function ExcelDataView(props: ExcelDataViewProps) {
  const {
    objects,
    objectsLoading,
    selectedObject,
    onSelectObject,
    fieldsLoading,
    filteredFields,
    columns,
    toggleColumn,
    setAllColumns,
    clearColumns,
    fieldFilter,
    setFieldFilter,
    filters,
    filterFieldOptions,
    operators,
    addFilter,
    updateFilter,
    removeFilter,
    logic,
    setLogic,
    renderValueInput,
    sortFieldOptions,
    orderBy,
    setOrderBy,
    orderDir,
    setOrderDir,
    limit,
    setLimit,
    soql,
    run,
    running,
    copySoql,
    copied,
    exportData,
    exporting,
    result,
    rows,
    resultColumns,
    saved,
    onLoadSaved,
    saveCurrent,
    onExitExcel,
  } = props;

  const [tab, setTab] = useState<Tab>("home");
  const [panel, setPanel] = useState<Panel>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Close a ribbon panel on outside click / Escape.
  useEffect(() => {
    if (!panel) return;
    function onDown(e: MouseEvent) {
      if (ribbonRef.current && !ribbonRef.current.contains(e.target as Node))
        setPanel(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  const win = useVirtualRows(gridRef, rows.length, XL_ROW_H);
  const tableWidth = GUTTER_W + resultColumns.length * XL_COL_W;

  // Status-bar aggregates for the selected column.
  const stats = useMemo(() => {
    if (!sel || !resultColumns.length) return null;
    const col = resultColumns[sel.c];
    let count = 0;
    let numeric = 0;
    let sum = 0;
    for (const r of rows) {
      const v = r[col];
      if (v === undefined || v === "") continue;
      count++;
      const n = Number(v);
      if (!Number.isNaN(n) && v.trim() !== "") {
        numeric++;
        sum += n;
      }
    }
    const allNumeric = count > 0 && numeric === count;
    return { count, sum, avg: numeric ? sum / numeric : 0, allNumeric };
  }, [sel, rows, resultColumns]);

  const activeCellRef = sel ? cellRef(sel.c, sel.r + 1) : selectedObject || "A1";
  const formulaText = sel ? rows[sel.r]?.[resultColumns[sel.c]] ?? "" : soql;

  return (
    <div className="xl">
      {/* Quick-access / title bar */}
      <div className="xl-title">
        <span className="xl-logo">▦</span>
        <span className="xl-fname">
          SalesforceData.xlsx{selectedObject ? ` — ${selectedObject}` : ""}
        </span>
        <span className="xl-qat">
          <button
            className="xl-qbtn"
            title="Save query"
            onClick={() => saveCurrent()}
            disabled={!soql}
          >
            💾
          </button>
          <button
            className="xl-qbtn"
            title="Run"
            onClick={run}
            disabled={running || !soql}
          >
            ▶
          </button>
        </span>
        <button className="xl-classic" onClick={onExitExcel}>
          Classic view
        </button>
      </div>

      {/* Ribbon tabs */}
      <div className="xl-tabs" role="tablist">
        {(["home", "data", "view"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`xl-tab${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "home" ? "Home" : t === "data" ? "Data" : "View"}
          </button>
        ))}
      </div>

      {/* Ribbon body */}
      <div className="xl-ribbon" ref={ribbonRef}>
        {tab === "home" && (
          <>
            <div className="xl-group">
              <div className="xl-group-items">
                <button
                  className="xl-big"
                  onClick={run}
                  disabled={running || !soql}
                >
                  <span className="xl-big-ico">▶</span>
                  {running ? "Running…" : "Run"}
                </button>
              </div>
              <div className="xl-group-label">Query</div>
            </div>
            <div className="xl-group">
              <div className="xl-group-items">
                <ExportMenu
                  exporting={exporting}
                  disabled={!soql || rows.length === 0}
                  onExport={exportData}
                />
                <button className="xl-cmd" onClick={copySoql} disabled={!soql}>
                  {copied ? "Copied!" : "Copy SOQL"}
                </button>
              </div>
              <div className="xl-group-label">Data</div>
            </div>
            <div className="xl-group">
              <div className="xl-group-items">
                <button
                  className="xl-cmd"
                  onClick={() => setPanel((p) => (p === "saved" ? null : "saved"))}
                >
                  Open ▾
                </button>
                <button
                  className="xl-cmd"
                  onClick={() => saveCurrent()}
                  disabled={!soql}
                >
                  Save
                </button>
              </div>
              <div className="xl-group-label">Workbook</div>
            </div>
          </>
        )}

        {tab === "data" && (
          <>
            <div className="xl-group">
              <div className="xl-group-items" style={{ minWidth: 240 }}>
                <ObjectPicker
                  id="xl-obj"
                  objects={objects}
                  value={selectedObject}
                  onSelect={onSelectObject}
                  placeholder={objectsLoading ? "Loading…" : "Object…"}
                />
              </div>
              <div className="xl-group-label">Source</div>
            </div>
            <div className="xl-group">
              <div className="xl-group-items">
                <button
                  className="xl-cmd"
                  disabled={!selectedObject}
                  onClick={() =>
                    setPanel((p) => (p === "columns" ? null : "columns"))
                  }
                >
                  Columns ▾
                </button>
                <button
                  className="xl-cmd"
                  disabled={!selectedObject}
                  onClick={() =>
                    setPanel((p) => (p === "filters" ? null : "filters"))
                  }
                >
                  Filter ▾{filters.length ? ` (${filters.length})` : ""}
                </button>
              </div>
              <div className="xl-group-label">Setup</div>
            </div>
            <div className="xl-group">
              <div className="xl-group-items">
                <label className="xl-field">
                  <span>Sort</span>
                  <select
                    value={orderBy}
                    onChange={(e) => setOrderBy(e.target.value)}
                    disabled={!selectedObject}
                  >
                    <option value="">(none)</option>
                    {sortFieldOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <select
                  value={orderDir}
                  onChange={(e) => setOrderDir(e.target.value)}
                  disabled={!selectedObject}
                  style={{ width: 74 }}
                >
                  <option>ASC</option>
                  <option>DESC</option>
                </select>
                <label className="xl-field">
                  <span>Limit</span>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    style={{ width: 74 }}
                  />
                </label>
              </div>
              <div className="xl-group-label">Sort &amp; Limit</div>
            </div>
          </>
        )}

        {tab === "view" && (
          <div className="xl-group">
            <div className="xl-group-items">
              <button className="xl-big" onClick={onExitExcel}>
                <span className="xl-big-ico">🗂️</span>
                Classic
              </button>
            </div>
            <div className="xl-group-label">Workbook Views</div>
          </div>
        )}

        {/* Ribbon dropdown panels */}
        {panel === "saved" && (
          <div className="xl-panel" style={{ left: 8 }}>
            <div className="xl-panel-head">Saved queries</div>
            {saved.length === 0 ? (
              <p className="muted" style={{ margin: 8 }}>
                No saved queries yet.
              </p>
            ) : (
              <div className="xl-panel-list">
                {saved.map((q) => (
                  <button
                    key={q.id}
                    className="xl-panel-item"
                    onClick={() => {
                      onLoadSaved(q.id);
                      setPanel(null);
                    }}
                  >
                    {q.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {panel === "columns" && (
          <div className="xl-panel" style={{ left: 8, width: 320 }}>
            <div className="xl-panel-head">
              Columns · {columns.length} selected
            </div>
            {fieldsLoading ? (
              <p className="muted" style={{ margin: 8 }}>
                Loading fields…
              </p>
            ) : (
              <div style={{ padding: 8 }}>
                <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                  <input
                    placeholder="Filter fields…"
                    value={fieldFilter}
                    onChange={(e) => setFieldFilter(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn secondary" onClick={setAllColumns}>
                    All
                  </button>
                  <button className="btn secondary" onClick={clearColumns}>
                    None
                  </button>
                </div>
                <div className="xl-panel-list" style={{ maxHeight: 260 }}>
                  {filteredFields.map((f) => (
                    <label key={f.name} className="xl-check">
                      <input
                        type="checkbox"
                        checked={columns.includes(f.name)}
                        onChange={() => toggleColumn(f.name)}
                      />
                      <span className="lbl">{f.label}</span>{" "}
                      <span className="api">
                        {f.name} · {f.type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {panel === "filters" && (
          <div className="xl-panel" style={{ left: 8, width: 460 }}>
            <div className="xl-panel-head">
              Filters
              <span style={{ marginLeft: "auto" }}>
                <select
                  value={logic}
                  onChange={(e) => setLogic(e.target.value)}
                  style={{ width: "auto" }}
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              </span>
            </div>
            <div style={{ padding: 8 }}>
              {filters.map((f, i) => (
                <div
                  key={i}
                  className="row"
                  style={{ gap: 6, marginBottom: 6, flexWrap: "nowrap" }}
                >
                  <select
                    value={f.field}
                    onChange={(e) => updateFilter(i, { field: e.target.value })}
                  >
                    <option value="">field…</option>
                    {filterFieldOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <select
                    value={f.operator}
                    onChange={(e) =>
                      updateFilter(i, { operator: e.target.value })
                    }
                    style={{ width: 96 }}
                  >
                    {operators.map((op) => (
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
            </div>
          </div>
        )}
      </div>

      {/* Formula bar */}
      <div className="xl-formulabar">
        <span className="xl-namebox">{activeCellRef}</span>
        <span className="xl-fx">fx</span>
        <span className="xl-formula" title={formulaText}>
          {formulaText}
        </span>
      </div>

      {/* Spreadsheet grid */}
      <div className="xl-grid-wrap" ref={gridRef}>
        {resultColumns.length === 0 ? (
          <div className="xl-empty">
            {selectedObject
              ? "Choose columns and click Run to populate the sheet."
              : "Pick an object on the Data tab to begin."}
          </div>
        ) : (
          <table className="xl-grid" style={{ width: tableWidth }}>
            <colgroup>
              <col style={{ width: GUTTER_W }} />
              {resultColumns.map((c) => (
                <col key={c} style={{ width: XL_COL_W }} />
              ))}
            </colgroup>
            <thead>
              {/* Column-letter header */}
              <tr className="xl-letters">
                <th className="xl-corner" />
                {resultColumns.map((c, ci) => (
                  <th
                    key={c}
                    className={sel?.c === ci ? "xl-collabel hi" : "xl-collabel"}
                  >
                    {colLetter(ci)}
                  </th>
                ))}
              </tr>
              {/* Field-name header */}
              <tr className="xl-fields">
                <th className="xl-rowhead" />
                {resultColumns.map((c) => (
                  <th key={c} className="xl-fieldhead" title={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {win.padTop > 0 && (
                <tr aria-hidden="true" style={{ height: win.padTop }}>
                  <td colSpan={resultColumns.length + 1} style={{ padding: 0 }} />
                </tr>
              )}
              {rows.slice(win.start, win.end).map((r, i) => {
                const rowIdx = win.start + i;
                return (
                  <tr key={rowIdx}>
                    <th
                      className={
                        sel?.r === rowIdx ? "xl-rowhead hi" : "xl-rowhead"
                      }
                    >
                      {rowIdx + 1}
                    </th>
                    {resultColumns.map((c, ci) => {
                      const selected = sel?.r === rowIdx && sel?.c === ci;
                      return (
                        <td
                          key={c}
                          className={selected ? "xl-cell sel" : "xl-cell"}
                          title={r[c] ?? ""}
                          onClick={() => setSel({ r: rowIdx, c: ci })}
                        >
                          {r[c] ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {win.padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: win.padBottom }}>
                  <td colSpan={resultColumns.length + 1} style={{ padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Sheet tabs */}
      <div className="xl-sheettabs">
        <span className="xl-sheet active">Results</span>
        <span className="xl-sheet add">+</span>
      </div>

      {/* Status bar */}
      <div className="xl-statusbar">
        <span>{running ? "Running…" : "Ready"}</span>
        <span className="xl-status-right">
          {result
            ? `${rows.length} of ${result.totalSize} record(s)${
                result.done ? "" : " (truncated)"
              }`
            : "No results yet"}
          {stats && (
            <>
              {" · "}
              {stats.allNumeric
                ? `Sum: ${stats.sum.toLocaleString()} · Average: ${stats.avg.toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 }
                  )} · `
                : ""}
              Count: {stats.count}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
