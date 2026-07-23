"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState, readPersisted } from "@/lib/usePersistentState";
import { FunnelIcon, FieldMetadataDialog } from "@/components/fieldUi";

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
  length?: number;
  nillable?: boolean;
  referenceTo?: string[];
  relationshipName?: string | null;
  picklistValues?: { value: string; active: boolean }[];
}

interface ChildRelationship {
  relationshipName: string | null;
  childSObject: string;
  field: string;
}

interface DescribeResult {
  name: string;
  label: string;
  fields: SObjectField[];
  childRelationships: ChildRelationship[];
}

export default function ObjectExplorer() {
  const [objects, setObjects] = useState<GlobalObject[]>([]);
  const [filter, setFilter] = usePersistentState("sfde.objects.filter", "");
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [describeCache, setDescribeCache] = useState<
    Record<string, DescribeResult>
  >({});
  const [selected, setSelected] = useState<string | null>(null);

  // Full tree expansion state persists across sessions (arrays for JSON).
  const [expandedCats, setExpandedCats] = usePersistentState<string[]>(
    "sfde.objects.cats",
    ["standard"]
  );
  const [expandedObjects, setExpandedObjects] = usePersistentState<string[]>(
    "sfde.objects.expanded",
    []
  );
  const [expandedSub, setExpandedSub] = usePersistentState<string[]>(
    "sfde.objects.sub",
    []
  );
  const restoredRef = useRef(false);

  // Approximate record counts + sort mode for the tree.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [sortMode, setSortMode] = usePersistentState<"name" | "count">(
    "sfde.objects.sortMode",
    "name"
  );

  const loadCounts = async (refresh = false) => {
    setCountsLoading(true);
    try {
      const res = await fetch(
        `/api/salesforce/record-counts${refresh ? "?refresh=1" : ""}`
      );
      const data = await res.json();
      if (res.ok) setCounts(data.counts || {});
    } catch {
      /* ignore — counts are optional */
    } finally {
      setCountsLoading(false);
    }
  };

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Field metadata dialog (full describe of a single field)
  const [fieldModal, setFieldModal] = useState<Record<string, unknown> | null>(
    null
  );
  useEffect(() => {
    if (!fieldModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFieldModal(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fieldModal]);

  // Fields table sorting + per-column filtering
  type SortKey = "label" | "name" | "type" | "details";
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState({
    label: "",
    name: "",
    type: "",
    details: "",
  });
  const [openFilterCol, setOpenFilterCol] = useState<SortKey | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // Close the filter flyout on outside click (but not when clicking a funnel).
  useEffect(() => {
    if (!openFilterCol) return;
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t.closest && t.closest(".funnel-btn")) return;
      if (flyoutRef.current && !flyoutRef.current.contains(t)) {
        setOpenFilterCol(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openFilterCol]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  useEffect(() => {
    (async () => {
      setLoadingList(true);
      try {
        const res = await fetch("/api/salesforce/objects");
        const data = await res.json();
        if (!res.ok) setError(data.error || "Failed to load objects");
        else setObjects(data.objects || []);
      } catch {
        setError("Network error");
      } finally {
        setLoadingList(false);
      }
    })();
    const last = readPersisted<string>("sfde.objects.selected");
    if (last && !restoredRef.current) {
      restoredRef.current = true;
      selectObject(last);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load describes for any objects that are expanded (e.g. restored from a
  // previous session) so their tree sub-nodes render.
  useEffect(() => {
    for (const name of expandedObjects) {
      if (!describeCache[name]) ensureDescribe(name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedObjects]);

  async function ensureDescribe(name: string) {
    if (describeCache[name]) return;
    try {
      const res = await fetch(`/api/salesforce/objects/${name}`);
      const data = await res.json();
      if (res.ok) {
        setDescribeCache((c) => ({
          ...c,
          [name]: {
            name: data.name,
            label: data.label,
            fields: data.fields || [],
            childRelationships: (data.childRelationships || []).filter(
              (r: ChildRelationship) => r.relationshipName
            ),
          },
        }));
      } else {
        setError(data.error || "Failed to describe");
      }
    } catch {
      setError("Network error");
    }
  }

  function selectObject(name: string) {
    setSelected(name);
    try {
      window.localStorage.setItem("sfde.objects.selected", JSON.stringify(name));
    } catch {
      /* ignore */
    }
    ensureDescribe(name);
  }

  function toggleCat(cat: string) {
    setExpandedCats((a) =>
      a.includes(cat) ? a.filter((x) => x !== cat) : [...a, cat]
    );
  }
  function toggleObject(name: string) {
    setExpandedObjects((a) =>
      a.includes(name) ? a.filter((x) => x !== name) : [...a, name]
    );
    ensureDescribe(name);
  }
  function toggleSub(key: string) {
    setExpandedSub((a) =>
      a.includes(key) ? a.filter((x) => x !== key) : [...a, key]
    );
  }

  const { standard, custom } = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (o: GlobalObject) =>
      !f || o.name.toLowerCase().includes(f) || o.label.toLowerCase().includes(f);
    const std: GlobalObject[] = [];
    const cus: GlobalObject[] = [];
    for (const o of objects) {
      if (!match(o)) continue;
      (o.custom ? cus : std).push(o);
    }
    const cmp = (a: GlobalObject, b: GlobalObject) => {
      if (sortMode === "count") {
        const ca = counts[a.name];
        const cb = counts[b.name];
        // Objects with a known count first, highest count first.
        if (ca === undefined && cb === undefined)
          return a.label.localeCompare(b.label);
        if (ca === undefined) return 1;
        if (cb === undefined) return -1;
        return cb - ca;
      }
      return a.label.localeCompare(b.label);
    };
    std.sort(cmp);
    cus.sort(cmp);
    return { standard: std, custom: cus };
  }, [objects, filter, sortMode, counts]);

  function Row({
    depth,
    twist,
    icon,
    children,
    onClick,
    onTwist,
    active,
    title,
  }: {
    depth: number;
    twist?: "open" | "closed" | null;
    icon: string;
    children: React.ReactNode;
    onClick?: () => void;
    onTwist?: () => void;
    active?: boolean;
    title?: string;
  }) {
    return (
      <div
        className={`tree-row${active ? " selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={onClick}
        title={title}
      >
        <span
          className="tree-twist"
          onClick={(e) => {
            if (onTwist) {
              e.stopPropagation();
              onTwist();
            }
          }}
        >
          {twist === "open" ? "▾" : twist === "closed" ? "▸" : ""}
        </span>
        <span className="tree-icon">{icon}</span>
        <span className="tree-label">{children}</span>
      </div>
    );
  }

  function ObjectNode({ o }: { o: GlobalObject }) {
    const open = expandedObjects.includes(o.name);
    const desc = describeCache[o.name];
    const fieldsKey = `${o.name}:fields`;
    const childKey = `${o.name}:children`;
    return (
      <div>
        <Row
          depth={1}
          twist={open ? "open" : "closed"}
          icon={open ? "📂" : "📁"}
          active={selected === o.name}
          onClick={() => selectObject(o.name)}
          onTwist={() => toggleObject(o.name)}
          title={o.name}
        >
          {o.label}
          <span className="api">{o.name}</span>
          {counts[o.name] !== undefined && (
            <span className="count-badge">
              {counts[o.name].toLocaleString()}
            </span>
          )}
        </Row>
        {open && (
          <div>
            {!desc ? (
              <Row depth={2} icon="⏳">
                <span className="api">Loading…</span>
              </Row>
            ) : (
              <>
                <Row
                  depth={2}
                  twist={expandedSub.includes(fieldsKey) ? "open" : "closed"}
                  icon="🗂️"
                  onClick={() => toggleSub(fieldsKey)}
                  onTwist={() => toggleSub(fieldsKey)}
                >
                  Fields <span className="api">{desc.fields.length}</span>
                </Row>
                {expandedSub.includes(fieldsKey) &&
                  desc.fields.map((fld) => (
                    <Row
                      key={fld.name}
                      depth={3}
                      icon={iconForField(fld)}
                      onClick={() =>
                        setFieldModal(
                          fld as unknown as Record<string, unknown>
                        )
                      }
                      title="Click for full field metadata"
                    >
                      {fld.name}
                      <span className="api">{fld.type}</span>
                    </Row>
                  ))}

                <Row
                  depth={2}
                  twist={expandedSub.includes(childKey) ? "open" : "closed"}
                  icon="🧬"
                  onClick={() => toggleSub(childKey)}
                  onTwist={() => toggleSub(childKey)}
                >
                  Child Relationships{" "}
                  <span className="api">{desc.childRelationships.length}</span>
                </Row>
                {expandedSub.includes(childKey) &&
                  desc.childRelationships.map((cr) => (
                    <Row key={cr.relationshipName} depth={3} icon="🔗">
                      {cr.relationshipName}
                      <span className="api">→ {cr.childSObject}</span>
                    </Row>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const detail = selected ? describeCache[selected] : null;

  const fieldRows = useMemo(() => {
    if (!detail) return [];
    const rows = detail.fields.map((f) => ({
      f,
      label: f.label || "",
      name: f.name || "",
      type: f.type || "",
      details: fieldDetails(f),
    }));
    const cf = colFilters;
    const filtered = rows.filter(
      (r) =>
        r.label.toLowerCase().includes(cf.label.toLowerCase()) &&
        r.name.toLowerCase().includes(cf.name.toLowerCase()) &&
        r.type.toLowerCase().includes(cf.type.toLowerCase()) &&
        r.details.toLowerCase().includes(cf.details.toLowerCase())
    );
    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => a[sortKey].localeCompare(b[sortKey]) * dir);
    return filtered;
  }, [detail, colFilters, sortKey, sortDir]);

  return (
    <div>
      <h1>Object Explorer</h1>
      <p className="muted">
        {loadingList
          ? "Loading objects…"
          : `${objects.length} objects · metadata cached in Supabase`}
      </p>
      {error && <div className="alert error">{error}</div>}

      <div className="grid-tree">
        {/* Tree */}
        <div className="card" style={{ padding: 12 }}>
          <input
            placeholder="Filter objects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div
            className="row"
            style={{ gap: 8, marginBottom: 10, fontSize: 13 }}
          >
            <span className="muted">Sort</span>
            <div className="seg" style={{ flex: "0 0 auto" }}>
              <button
                className={sortMode === "name" ? "on" : ""}
                onClick={() => setSortMode("name")}
              >
                Name
              </button>
              <button
                className={sortMode === "count" ? "on" : ""}
                onClick={() => setSortMode("count")}
              >
                Records
              </button>
            </div>
            <button
              className="linkbtn"
              onClick={() => loadCounts(true)}
              title="Refresh record counts"
              disabled={countsLoading}
            >
              {countsLoading ? "…" : "↻"}
            </button>
          </div>
          <div className="tree" style={{ maxHeight: 560, overflow: "auto" }}>
            <Row
              depth={0}
              twist={expandedCats.includes("standard") ? "open" : "closed"}
              icon="📦"
              onClick={() => toggleCat("standard")}
              onTwist={() => toggleCat("standard")}
            >
              Standard Objects <span className="api">{standard.length}</span>
            </Row>
            {expandedCats.includes("standard") &&
              standard.map((o) => <ObjectNode key={o.name} o={o} />)}

            <Row
              depth={0}
              twist={expandedCats.includes("custom") ? "open" : "closed"}
              icon="🧩"
              onClick={() => toggleCat("custom")}
              onTwist={() => toggleCat("custom")}
            >
              Custom Objects <span className="api">{custom.length}</span>
            </Row>
            {expandedCats.includes("custom") &&
              custom.map((o) => <ObjectNode key={o.name} o={o} />)}
          </div>
        </div>

        {/* Details pane */}
        <div>
          {!selected && (
            <div className="card muted">
              Select an object in the tree to see its fields.
            </div>
          )}
          {selected && !detail && <div className="card spinner">Describing…</div>}
          {detail && (
            <div className="card">
              <h2>
                {detail.label}{" "}
                <span className="muted" style={{ fontSize: 14 }}>
                  ({detail.name})
                </span>
              </h2>
              <p className="muted">
                {fieldRows.length} of {detail.fields.length} fields ·{" "}
                {detail.childRelationships.length} child relationships
              </p>
              <div
                className="table-wrap"
                style={{ maxHeight: 520, overflowY: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      {(
                        [
                          ["label", "Label"],
                          ["name", "API name"],
                          ["type", "Type"],
                          ["details", "Details"],
                        ] as [SortKey, string][]
                      ).map(([key, label]) => (
                        <th key={key} style={{ position: "relative" }}>
                          <span
                            onClick={() => sortBy(key)}
                            style={{ cursor: "pointer", userSelect: "none" }}
                            title="Click to sort"
                          >
                            {label}
                            {sortKey === key
                              ? sortDir === "asc"
                                ? " ▲"
                                : " ▼"
                              : ""}
                          </span>
                          <button
                            className={`funnel-btn${
                              colFilters[key] ? " active" : ""
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenFilterCol((c) => (c === key ? null : key));
                            }}
                            title={
                              colFilters[key]
                                ? `Filtered: "${colFilters[key]}"`
                                : "Filter column"
                            }
                            aria-label="Filter column"
                          >
                            <FunnelIcon active={Boolean(colFilters[key])} />
                          </button>
                          {openFilterCol === key && (
                            <div className="col-flyout" ref={flyoutRef}>
                              <input
                                autoFocus
                                value={colFilters[key]}
                                onChange={(e) =>
                                  setColFilters((c) => ({
                                    ...c,
                                    [key]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === "Escape")
                                    setOpenFilterCol(null);
                                }}
                                placeholder={`Filter ${label.toLowerCase()}…`}
                                style={{ padding: "6px 8px", fontSize: 13 }}
                              />
                              <button
                                className="btn secondary"
                                style={{ padding: "6px 10px", fontSize: 12 }}
                                onClick={() =>
                                  setColFilters((c) => ({ ...c, [key]: "" }))
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
                    {fieldRows.map((r) => (
                      <tr
                        key={r.name}
                        onClick={() =>
                          setFieldModal(
                            r.f as unknown as Record<string, unknown>
                          )
                        }
                        style={{ cursor: "pointer" }}
                        title="Click for full field metadata"
                      >
                        <td title={r.label}>{r.label}</td>
                        <td>
                          <code>{r.name}</code>
                        </td>
                        <td>{r.type}</td>
                        <td>{r.details}</td>
                      </tr>
                    ))}
                    {fieldRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          No fields match the filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {fieldModal && (
        <FieldMetadataDialog
          field={fieldModal}
          onClose={() => setFieldModal(null)}
        />
      )}
    </div>
  );
}

function fieldDetails(f: SObjectField): string {
  if (f.referenceTo && f.referenceTo.length > 0)
    return `→ ${f.referenceTo.join(", ")}`;
  if (f.picklistValues && f.picklistValues.length > 0)
    return `${f.picklistValues.length} values`;
  if (f.length) return `len ${f.length}`;
  return "";
}

function iconForField(f: SObjectField): string {
  const t = (f.type || "").toLowerCase();
  if (t === "reference") return "🔗";
  if (t === "id") return "🔑";
  if (t === "boolean") return "☑️";
  if (t === "date" || t === "datetime" || t === "time") return "📅";
  if (["int", "double", "currency", "percent"].includes(t)) return "🔢";
  if (t === "picklist" || t === "multipicklist") return "▾";
  if (t === "email") return "✉️";
  if (t === "phone") return "📞";
  if (t === "url") return "🔗";
  return "🔹";
}
