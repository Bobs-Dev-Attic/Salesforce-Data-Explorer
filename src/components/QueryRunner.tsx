"use client";

import { useState } from "react";

interface SoqlResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

function columnsFrom(records: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (k === "attributes") continue;
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // nested relationship or attributes object
    const obj = v as Record<string, unknown>;
    if ("attributes" in obj) {
      // show a compact representation of the related record
      const { attributes, ...rest } = obj;
      void attributes;
      return Object.values(rest).filter(Boolean).join(" · ");
    }
    return JSON.stringify(v);
  }
  return String(v);
}

const DEFAULT_QUERY =
  "SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 50";

export default function QueryRunner() {
  const [soql, setSoql] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<SoqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/salesforce/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql, maxRecords: 2000 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Query failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
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
      a.download = `export-${new Date().toISOString().slice(0, 10)}.csv`;
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

  const columns = result ? columnsFrom(result.records) : [];

  return (
    <div>
      <h1>SOQL Query</h1>
      <div className="card">
        <label htmlFor="soql">Query</label>
        <textarea
          id="soql"
          value={soql}
          onChange={(e) => setSoql(e.target.value)}
          spellCheck={false}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run query"}
          </button>
          <button
            className="btn secondary"
            onClick={exportCsv}
            disabled={exporting || loading}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          {result && (
            <span className="muted">
              {result.records.length} of {result.totalSize} record(s)
              {!result.done && " (truncated)"}
            </span>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {result && result.records.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 600, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.records.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c} title={cellValue(r[c])}>
                      {cellValue(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && result.records.length === 0 && (
        <div className="card muted">No records returned.</div>
      )}
    </div>
  );
}
