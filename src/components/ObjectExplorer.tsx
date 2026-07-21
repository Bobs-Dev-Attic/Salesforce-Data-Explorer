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
  length?: number;
  nillable?: boolean;
  referenceTo?: string[];
  picklistValues?: { value: string; active: boolean }[];
}

interface DescribeResult {
  name: string;
  label: string;
  fields: SObjectField[];
}

export default function ObjectExplorer() {
  const [objects, setObjects] = useState<GlobalObject[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [describe, setDescribe] = useState<DescribeResult | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDescribe, setLoadingDescribe] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  async function select(name: string) {
    setSelected(name);
    setDescribe(null);
    setLoadingDescribe(true);
    setError(null);
    try {
      const res = await fetch(`/api/salesforce/objects/${name}`);
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to describe");
      else setDescribe(data);
    } catch {
      setError("Network error");
    } finally {
      setLoadingDescribe(false);
    }
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return objects;
    return objects.filter(
      (o) =>
        o.name.toLowerCase().includes(f) || o.label.toLowerCase().includes(f)
    );
  }, [objects, filter]);

  return (
    <div>
      <h1>Object Explorer</h1>
      <p className="muted">
        {loadingList
          ? "Loading objects…"
          : `${objects.length} objects · metadata cached in Supabase`}
      </p>
      {error && <div className="alert error">{error}</div>}

      <div className="grid2">
        <div>
          <input
            placeholder="Filter objects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div className="list">
            {filtered.map((o) => (
              <div
                key={o.name}
                className={`list-item ${selected === o.name ? "active" : ""}`}
                onClick={() => select(o.name)}
              >
                <div className="lbl">{o.label}</div>
                <div className="api">
                  {o.name}
                  {o.custom ? " · custom" : ""}
                </div>
              </div>
            ))}
            {!loadingList && filtered.length === 0 && (
              <div className="list-item muted">No matches</div>
            )}
          </div>
        </div>

        <div>
          {!selected && (
            <div className="card muted">
              Select an object to see its fields.
            </div>
          )}
          {loadingDescribe && <div className="card spinner">Describing…</div>}
          {describe && (
            <div className="card">
              <h2>
                {describe.label}{" "}
                <span className="muted" style={{ fontSize: 14 }}>
                  ({describe.name})
                </span>
              </h2>
              <p className="muted">{describe.fields.length} fields</p>
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
                    {describe.fields.map((f) => (
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
