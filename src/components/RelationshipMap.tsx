"use client";

import { useEffect, useMemo, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import ObjectPicker from "@/components/ObjectPicker";

interface GlobalObject {
  name: string;
  label: string;
  queryable: boolean;
  custom: boolean;
}

interface Field {
  name: string;
  type: string;
  referenceTo?: string[];
  relationshipName?: string | null;
}

interface ChildRelationship {
  relationshipName: string | null;
  childSObject: string;
  field: string;
}

interface Describe {
  name: string;
  label: string;
  fields: Field[];
  childRelationships: ChildRelationship[];
}

interface RelNode {
  object: string; // API name of the related object
  edges: string[]; // field / relationship names on the edge
}

function truncate(s: string, n = 22): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Group parent lookups by target object (e.g. CreatedById + OwnerId -> User). */
function parentsOf(d: Describe): RelNode[] {
  const map = new Map<string, string[]>();
  for (const f of d.fields) {
    if (f.type === "reference" && f.referenceTo) {
      for (const target of f.referenceTo) {
        if (!target) continue;
        const arr = map.get(target) || [];
        arr.push(f.name);
        map.set(target, arr);
      }
    }
  }
  return [...map.entries()]
    .map(([object, edges]) => ({ object, edges }))
    .sort((a, b) => a.object.localeCompare(b.object));
}

/** Group child relationships by child object. */
function childrenOf(d: Describe): RelNode[] {
  const map = new Map<string, string[]>();
  for (const c of d.childRelationships) {
    if (!c.childSObject) continue;
    const arr = map.get(c.childSObject) || [];
    if (c.relationshipName) arr.push(c.relationshipName);
    map.set(c.childSObject, arr);
  }
  return [...map.entries()]
    .map(([object, edges]) => ({ object, edges }))
    .sort((a, b) => a.object.localeCompare(b.object));
}

const NODE_W = 178;
const NODE_H = 30;
const GAP = 12;
const CENTER_W = 210;
const CENTER_H = 46;
const WIDTH = 900;

export default function RelationshipMap() {
  const [objects, setObjects] = useState<GlobalObject[]>([]);
  const [center, setCenter] = usePersistentState<string>("sfde.schema.center", "");
  const [describe, setDescribe] = useState<Describe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllChildren, setShowAllChildren] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/salesforce/objects");
        const data = await res.json();
        if (res.ok) setObjects(data.objects || []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!center) return;
    setLoading(true);
    setError(null);
    setShowAllChildren(false);
    (async () => {
      try {
        const res = await fetch(`/api/salesforce/objects/${center}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to load object");
          setDescribe(null);
        } else {
          setDescribe({
            name: data.name,
            label: data.label,
            fields: data.fields || [],
            childRelationships: (data.childRelationships || []).filter(
              (c: ChildRelationship) => c.relationshipName
            ),
          });
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [center]);

  const parents = useMemo(() => (describe ? parentsOf(describe) : []), [describe]);
  const allChildren = useMemo(
    () => (describe ? childrenOf(describe) : []),
    [describe]
  );
  const CHILD_CAP = 22;
  const children =
    showAllChildren || allChildren.length <= CHILD_CAP
      ? allChildren
      : allChildren.slice(0, CHILD_CAP);

  const rowH = NODE_H + GAP;
  const height =
    Math.max(parents.length, children.length, 1) * rowH + 60;
  const centerX = WIDTH / 2;
  const centerY = height / 2;
  const leftX = 20;
  const rightX = WIDTH - 20 - NODE_W;

  function columnY(count: number, i: number): number {
    const startY = (height - count * rowH) / 2 + GAP / 2;
    return startY + i * rowH;
  }

  function edgePath(x1: number, y1: number, x2: number, y2: number): string {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }

  function RelNodeRect({
    node,
    x,
    y,
    side,
  }: {
    node: RelNode;
    x: number;
    y: number;
    side: "left" | "right";
  }) {
    const label = `${node.object}${
      node.edges.length ? ` via ${node.edges.join(", ")}` : ""
    }. Re-center map on this object.`;
    return (
      <g
        className="schema-node-group"
        role="button"
        tabIndex={0}
        aria-label={label}
        style={{ cursor: "pointer" }}
        onClick={() => setCenter(node.object)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCenter(node.object);
          }
        }}
      >
        <title>
          {node.object}
          {node.edges.length ? ` · ${node.edges.join(", ")}` : ""}
        </title>
        <rect
          x={x}
          y={y}
          width={NODE_W}
          height={NODE_H}
          rx={7}
          className={`schema-node ${side}`}
        />
        <text x={x + 10} y={y + NODE_H / 2 + 4} className="schema-node-text">
          {truncate(node.object)}
        </text>
      </g>
    );
  }

  return (
    <div>
      <h1>Schema — Object Relationships</h1>
      <p className="muted">
        Parent (lookup) objects on the left, child objects on the right. Click any
        related object to re-center the map.
      </p>
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <label htmlFor="schema-obj">Object</label>
        <ObjectPicker
          id="schema-obj"
          objects={objects}
          value={center}
          onSelect={setCenter}
        />
      </div>

      {loading && <div className="card spinner">Loading relationships…</div>}

      {describe && !loading && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>
              {describe.label}{" "}
              <span className="muted" style={{ fontSize: 14 }}>
                ({describe.name})
              </span>
            </h2>
            <span className="muted">
              {parents.length} parent · {allChildren.length} child
            </span>
          </div>

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <svg
              viewBox={`0 0 ${WIDTH} ${height}`}
              width="100%"
              style={{ minWidth: 640, display: "block" }}
              role="group"
              aria-label={`Relationship map for ${describe.name}: ${parents.length} parent object(s) on the left, ${children.length} child object(s) on the right. Related objects are focusable buttons; activate one to re-center the map.`}
            >
              {/* edges: parents -> center */}
              {parents.map((p, i) => {
                const y = columnY(parents.length, i) + NODE_H / 2;
                return (
                  <path
                    key={`pe-${p.object}`}
                    d={edgePath(leftX + NODE_W, y, centerX - CENTER_W / 2, centerY)}
                    className="schema-edge parent"
                    fill="none"
                  />
                );
              })}
              {/* edges: center -> children */}
              {children.map((c, i) => {
                const y = columnY(children.length, i) + NODE_H / 2;
                return (
                  <path
                    key={`ce-${c.object}`}
                    d={edgePath(centerX + CENTER_W / 2, centerY, rightX, y)}
                    className="schema-edge child"
                    fill="none"
                  />
                );
              })}

              {/* parent nodes */}
              {parents.map((p, i) => (
                <RelNodeRect
                  key={`p-${p.object}`}
                  node={p}
                  x={leftX}
                  y={columnY(parents.length, i)}
                  side="left"
                />
              ))}
              {/* child nodes */}
              {children.map((c, i) => (
                <RelNodeRect
                  key={`c-${c.object}`}
                  node={c}
                  x={rightX}
                  y={columnY(children.length, i)}
                  side="right"
                />
              ))}

              {/* center node */}
              <g>
                <rect
                  x={centerX - CENTER_W / 2}
                  y={centerY - CENTER_H / 2}
                  width={CENTER_W}
                  height={CENTER_H}
                  rx={9}
                  className="schema-center"
                />
                <text
                  x={centerX}
                  y={centerY + 5}
                  textAnchor="middle"
                  className="schema-center-text"
                >
                  {truncate(describe.name, 26)}
                </text>
              </g>
            </svg>
          </div>

          {allChildren.length > CHILD_CAP && (
            <p className="muted" style={{ marginTop: 8 }}>
              Showing {children.length} of {allChildren.length} child
              relationships.{" "}
              <button
                type="button"
                className="linkbtn"
                style={{ color: "var(--accent)" }}
                onClick={() => setShowAllChildren((s) => !s)}
              >
                {showAllChildren ? "Show fewer" : "Show all"}
              </button>
            </p>
          )}

          {parents.length === 0 && allChildren.length === 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              This object has no lookup or child relationships.
            </p>
          )}
        </div>
      )}

      {!center && !loading && (
        <div className="card muted">
          Pick an object above to visualize its relationships.
        </div>
      )}
    </div>
  );
}
