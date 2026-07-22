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

  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    new Set(["standard"])
  );
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(new Set());
  const [expandedSub, setExpandedSub] = useState<Set<string>>(new Set());
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
      openObject(last, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function openObject(name: string, expand: boolean) {
    selectObject(name);
    if (expand) {
      setExpandedObjects((s) => new Set(s).add(name));
    }
  }

  function toggleCat(cat: string) {
    setExpandedCats((s) => {
      const n = new Set(s);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });
  }
  function toggleObject(name: string) {
    setExpandedObjects((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else {
        n.add(name);
        ensureDescribe(name);
      }
      return n;
    });
  }
  function toggleSub(key: string) {
    setExpandedSub((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
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
    const open = expandedObjects.has(o.name);
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
                  twist={expandedSub.has(fieldsKey) ? "open" : "closed"}
                  icon="🗂️"
                  onClick={() => toggleSub(fieldsKey)}
                  onTwist={() => toggleSub(fieldsKey)}
                >
                  Fields <span className="api">{desc.fields.length}</span>
                </Row>
                {expandedSub.has(fieldsKey) &&
                  desc.fields.map((fld) => (
                    <Row key={fld.name} depth={3} icon={iconForField(fld)}>
                      {fld.name}
                      <span className="api">{fld.type}</span>
                    </Row>
                  ))}

                <Row
                  depth={2}
                  twist={expandedSub.has(childKey) ? "open" : "closed"}
                  icon="🧬"
                  onClick={() => toggleSub(childKey)}
                  onTwist={() => toggleSub(childKey)}
                >
                  Child Relationships{" "}
                  <span className="api">{desc.childRelationships.length}</span>
                </Row>
                {expandedSub.has(childKey) &&
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
              twist={expandedCats.has("standard") ? "open" : "closed"}
              icon="📦"
              onClick={() => toggleCat("standard")}
              onTwist={() => toggleCat("standard")}
            >
              Standard Objects <span className="api">{standard.length}</span>
            </Row>
            {expandedCats.has("standard") &&
              standard.map((o) => <ObjectNode key={o.name} o={o} />)}

            <Row
              depth={0}
              twist={expandedCats.has("custom") ? "open" : "closed"}
              icon="🧩"
              onClick={() => toggleCat("custom")}
              onTwist={() => toggleCat("custom")}
            >
              Custom Objects <span className="api">{custom.length}</span>
            </Row>
            {expandedCats.has("custom") &&
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
