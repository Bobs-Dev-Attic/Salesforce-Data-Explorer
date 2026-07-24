"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ExportMenu, { type ExportFormat } from "@/components/ExportMenu";
import ObjectPicker from "@/components/ObjectPicker";
import { useVirtualRows } from "@/lib/useVirtualRows";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { usePersistentState } from "@/lib/usePersistentState";
import {
  applyGridView,
  distinctValues,
  type SortSpec,
  type ValueFilters,
} from "@/lib/gridFilter";
import { FunnelIcon } from "@/components/fieldUi";

const XL_ROW_H = 24;
const XL_MIN_ROW_H = 18;
const XL_MAX_ROW_H = 240;
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
  errorSlot?: React.ReactNode;
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
    errorSlot,
    onExitExcel,
  } = props;

  // The Excel view fills the viewport; lock body scroll while it's mounted.
  useEffect(() => {
    document.body.classList.add("xl-active");
    return () => document.body.classList.remove("xl-active");
  }, []);

  const [tab, setTab] = useState<Tab>("home");
  const [panel, setPanel] = useState<Panel>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [wrap, setWrap] = usePersistentState<boolean>("sfde.xl.wrap", false);
  const [rowH, setRowH] = usePersistentState<number>("sfde.xl.rowh", XL_ROW_H);
  const colw = useColumnWidths("sfde.xl.colw", { defaultWidth: XL_COL_W });
  const ribbonRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const rowHRef = useRef(rowH);
  rowHRef.current = rowH;

  // Drag the bottom edge of a row header to set a uniform row height.
  const startRowResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const baseline = rowHRef.current;
    const onMove = (ev: PointerEvent) => {
      const next = Math.round(baseline + (ev.clientY - startY));
      setRowH(Math.min(XL_MAX_ROW_H, Math.max(XL_MIN_ROW_H, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("col-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("col-resizing");
  };

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

  // --- Excel-Table AutoFilter (client-side sort + per-column value filter) ---
  const [sortSpec, setSortSpec] = useState<SortSpec | null>(null);
  const [valueFilters, setValueFilters] = useState<ValueFilters>({});
  const [menu, setMenu] = useState<{ col: string; x: number; y: number } | null>(
    null
  );
  const [menuSearch, setMenuSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());

  // A new result set (different columns) invalidates any prior sort/filter.
  const colKey = resultColumns.join("");
  useEffect(() => {
    setSortSpec(null);
    setValueFilters({});
    setSel(null);
    setMenu(null);
  }, [colKey]);

  const displayRows = useMemo(
    () => applyGridView(rows, resultColumns, valueFilters, sortSpec),
    [rows, resultColumns, valueFilters, sortSpec]
  );
  const isFiltered = displayRows.length !== rows.length;

  // Distinct values of the open menu's column (for the checkbox list).
  const menuValues = useMemo(
    () => (menu ? distinctValues(rows, menu.col) : []),
    [menu, rows]
  );
  const visibleValues = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return menuValues;
    return menuValues.filter((v) => v.toLowerCase().includes(q));
  }, [menuValues, menuSearch]);
  const allVisibleChecked =
    visibleValues.length > 0 && visibleValues.every((v) => draft.has(v));

  function openMenu(col: string, e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cur = valueFilters[col];
    setMenuSearch("");
    setDraft(new Set(cur ?? distinctValues(rows, col)));
    const x = Math.max(4, Math.min(rect.left, window.innerWidth - 240));
    setMenu({ col, x, y: rect.bottom });
  }
  function applySort(col: string, dir: "asc" | "desc") {
    setSortSpec({ col, dir });
    setMenu(null);
  }
  function toggleDraft(v: string) {
    setDraft((d) => {
      const n = new Set(d);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }
  function toggleAllVisible() {
    setDraft((d) => {
      const n = new Set(d);
      if (visibleValues.every((v) => n.has(v)))
        visibleValues.forEach((v) => n.delete(v));
      else visibleValues.forEach((v) => n.add(v));
      return n;
    });
  }
  function applyFilter() {
    if (!menu) return;
    const all = menuValues.length === draft.size && menuValues.every((v) => draft.has(v));
    setValueFilters((f) => {
      const n = { ...f };
      if (all) delete n[menu.col];
      else n[menu.col] = Array.from(draft);
      return n;
    });
    setMenu(null);
  }
  function clearFilter(col: string) {
    setValueFilters((f) => {
      const n = { ...f };
      delete n[col];
      return n;
    });
    setMenu(null);
  }

  // Close the header menu on outside click / Escape / grid scroll.
  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest(".xl-hmenu") && !t.closest(".xl-fh-menu")) setMenu(null);
    }
    const grid = gridRef.current;
    const close = () => setMenu(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    grid?.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      grid?.removeEventListener("scroll", close);
    };
  }, [menu]);

  // Wrapped cells have content-driven heights, which the fixed-height
  // virtualizer can't measure — render every row directly in wrap mode.
  const win = useVirtualRows(gridRef, wrap ? 0 : displayRows.length, rowH);
  const start = wrap ? 0 : win.start;
  const end = wrap ? displayRows.length : win.end;
  const tableWidth = GUTTER_W + colw.total(resultColumns);

  // Status-bar aggregates for the selected column (over the filtered view).
  const stats = useMemo(() => {
    if (!sel || !resultColumns.length) return null;
    const col = resultColumns[sel.c];
    let count = 0;
    let numeric = 0;
    let sum = 0;
    for (const r of displayRows) {
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
  }, [sel, displayRows, resultColumns]);

  const activeCellRef = sel
    ? `${resultColumns[sel.c] ?? ""}:${sel.r + 1}`
    : selectedObject || "—";
  const formulaText = sel
    ? displayRows[sel.r]?.[resultColumns[sel.c]] ?? ""
    : soql;

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
          <>
            <div className="xl-group">
              <div className="xl-group-items">
                <button
                  className={`xl-cmd${wrap ? " on" : ""}`}
                  aria-pressed={wrap}
                  onClick={() => setWrap((w) => !w)}
                  title="Wrap cell text onto multiple lines"
                >
                  {wrap ? "☑" : "☐"} Wrap Text
                </button>
                <button
                  className="xl-cmd"
                  onClick={() => {
                    colw.reset();
                    setRowH(XL_ROW_H);
                  }}
                  title="Reset all row heights and column widths"
                >
                  Reset Sizes
                </button>
              </div>
              <div className="xl-group-label">Cells</div>
            </div>
            <div className="xl-group">
              <div className="xl-group-items">
                <button className="xl-big" onClick={onExitExcel}>
                  <span className="xl-big-ico">🗂️</span>
                  Classic
                </button>
              </div>
              <div className="xl-group-label">Workbook Views</div>
            </div>
          </>
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

      {/* Error banner (kept visible inside the full-screen view) */}
      {errorSlot && <div className="xl-errorslot">{errorSlot}</div>}

      {/* Spreadsheet grid */}
      <div className="xl-grid-wrap" ref={gridRef}>
        {resultColumns.length === 0 ? (
          <div className="xl-empty">
            {selectedObject
              ? "Choose columns and click Run to populate the sheet."
              : "Pick an object on the Data tab to begin."}
          </div>
        ) : (
          <table
            className={`xl-grid${wrap ? " wrap" : ""}`}
            style={{ width: tableWidth }}
          >
            <colgroup>
              <col style={{ width: GUTTER_W }} />
              {resultColumns.map((c) => (
                <col key={c} style={{ width: colw.widthOf(c) }} />
              ))}
            </colgroup>
            <thead>
              {/* Field-name header */}
              <tr className="xl-fields">
                <th className="xl-rowhead xl-corner" />
                {resultColumns.map((c, ci) => {
                  const filtered = !!valueFilters[c];
                  const sorted = sortSpec?.col === c;
                  return (
                    <th
                      key={c}
                      className={sel?.c === ci ? "xl-fieldhead hi" : "xl-fieldhead"}
                      title={c}
                    >
                      <span className="xl-fh-label">{c}</span>
                      {sorted && (
                        <span className="xl-fh-ind" aria-hidden="true">
                          {sortSpec?.dir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                      <button
                        className={`xl-fh-menu${filtered ? " on" : ""}`}
                        onClick={(e) => openMenu(c, e)}
                        title="Sort & filter"
                        aria-label={`Sort and filter ${c}`}
                      >
                        {filtered ? <FunnelIcon active /> : "▾"}
                      </button>
                      <span
                        className="xl-col-resize"
                        onPointerDown={(e) => colw.startResize(c, e)}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to resize column"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {!wrap && win.padTop > 0 && (
                <tr aria-hidden="true" style={{ height: win.padTop }}>
                  <td colSpan={resultColumns.length + 1} style={{ padding: 0 }} />
                </tr>
              )}
              {displayRows.slice(start, end).map((r, i) => {
                const rowIdx = start + i;
                return (
                  <tr key={rowIdx} style={{ height: rowH }}>
                    <th
                      className={
                        sel?.r === rowIdx ? "xl-rowhead hi" : "xl-rowhead"
                      }
                    >
                      {rowIdx + 1}
                      <span
                        className="xl-row-resize"
                        onPointerDown={startRowResize}
                        title="Drag to resize rows"
                      />
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
              {!wrap && win.padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: win.padBottom }}>
                  <td colSpan={resultColumns.length + 1} style={{ padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Column AutoFilter menu (fixed-position, escapes the scroll clip) */}
      {menu && (
        <div className="xl-hmenu" style={{ left: menu.x, top: menu.y }}>
          <button
            className="xl-hmenu-item"
            onClick={() => applySort(menu.col, "asc")}
          >
            ▲ Sort A → Z
          </button>
          <button
            className="xl-hmenu-item"
            onClick={() => applySort(menu.col, "desc")}
          >
            ▼ Sort Z → A
          </button>
          <div className="xl-hmenu-sep" />
          <input
            className="xl-hmenu-search"
            placeholder="Search values…"
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            autoFocus
          />
          <label className="xl-hmenu-check all">
            <input
              type="checkbox"
              checked={allVisibleChecked}
              onChange={toggleAllVisible}
            />
            <span>(Select All)</span>
          </label>
          <div className="xl-hmenu-list">
            {visibleValues.length === 0 ? (
              <p className="muted" style={{ margin: "6px 8px" }}>
                No matching values.
              </p>
            ) : (
              visibleValues.map((v) => (
                <label key={v} className="xl-hmenu-check">
                  <input
                    type="checkbox"
                    checked={draft.has(v)}
                    onChange={() => toggleDraft(v)}
                  />
                  <span className={v === "" ? "muted" : undefined}>
                    {v === "" ? "(Blanks)" : v}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="xl-hmenu-actions">
            <button
              className="btn secondary"
              onClick={() => clearFilter(menu.col)}
            >
              Clear filter
            </button>
            <button className="btn" onClick={applyFilter}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="xl-statusbar">
        <span>{running ? "Running…" : "Ready"}</span>
        <span className="xl-status-right">
          {result
            ? `${displayRows.length}${
                isFiltered ? ` of ${rows.length} filtered` : ""
              } · ${rows.length} of ${result.totalSize} record(s)${
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
