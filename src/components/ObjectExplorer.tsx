"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState, readPersisted } from "@/lib/usePersistentState";

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
    std.sort((a, b) => a.label.localeCompare(b.label));
    cus.sort((a, b) => a.label.localeCompare(b.label));
    return { standard: std, custom: cus };
  }, [objects, filter]);

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
                    <Row key={fld.name} depth={3} icon={iconForField(fld)}>
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
                {detail.fields.length} fields · {detail.childRelationships.length}{" "}
                child relationships
              </p>
              <div
                className="table-wrap"
                style={{ maxHeight: 520, overflowY: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>API name</th>
                      <th>Type</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.fields.map((f) => (
                      <tr key={f.name}>
                        <td title={f.label}>{f.label}</td>
                        <td>
                          <code>{f.name}</code>
                        </td>
                        <td>{f.type}</td>
                        <td>
                          {f.referenceTo && f.referenceTo.length > 0
                            ? `→ ${f.referenceTo.join(", ")}`
                            : f.picklistValues && f.picklistValues.length > 0
                            ? `${f.picklistValues.length} values`
                            : f.length
                            ? `len ${f.length}`
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
