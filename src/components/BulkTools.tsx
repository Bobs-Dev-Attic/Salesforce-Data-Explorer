"use client";

import { useEffect, useRef, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";

interface BulkJob {
  id: string;
  state: string;
  numberRecordsProcessed?: number;
  numberRecordsFailed?: number;
  errorMessage?: string;
}

const OPERATIONS = [
  { value: "insert", label: "Insert" },
  { value: "update", label: "Update" },
  { value: "upsert", label: "Upsert (external id)" },
  { value: "delete", label: "Delete" },
  { value: "hardDelete", label: "Hard delete" },
];

const TERMINAL = ["JobComplete", "Failed", "Aborted"];

function useJobPoller(
  kind: "query" | "ingest",
  jobId: string | null,
  onDone: (job: BulkJob) => void
) {
  const [job, setJob] = useState<BulkJob | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/salesforce/bulk/${kind}/${jobId}`);
        const data = (await res.json()) as BulkJob;
        if (cancelled) return;
        setJob(data);
        if (TERMINAL.includes(data.state)) {
          onDone(data);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!cancelled) timer.current = setTimeout(poll, 2500);
    }
    poll();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, kind]);

  return job;
}

function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ------------------------------------------------------------------
// Bulk Export
// ------------------------------------------------------------------
function BulkExport() {
  const [soql, setSoql] = usePersistentState(
    "sfde.bulk.exportSoql",
    "SELECT Id, Name, CreatedDate FROM Account"
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState(false);

  const job = useJobPoller("query", jobId, () => setDone(true));

  async function start() {
    setStarting(true);
    setError(null);
    setDone(false);
    setJobId(null);
    try {
      const res = await fetch("/api/salesforce/bulk/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soql }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to start");
      else setJobId(data.jobId);
    } catch {
      setError("Network error");
    } finally {
      setStarting(false);
    }
  }

  const failed = job?.state === "Failed" || job?.state === "Aborted";

  return (
    <div className="card">
      <h2>Bulk export</h2>
      <p className="muted">
        Runs a Bulk API 2.0 query job — ideal for exporting large result sets
        that exceed the standard query limit.
      </p>
      <label htmlFor="bulk-soql">SOQL</label>
      <textarea
        id="bulk-soql"
        value={soql}
        onChange={(e) => setSoql(e.target.value)}
        spellCheck={false}
      />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={start} disabled={starting}>
          {starting ? "Starting…" : "Start bulk export"}
        </button>
        {job && !done && (
          <span className="muted">
            Job {job.id} · <strong>{job.state}</strong> — polling…
          </span>
        )}
      </div>
      {error && (
        <div className="alert error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {failed && (
        <div className="alert error" style={{ marginTop: 12 }}>
          Job {job?.state}: {job?.errorMessage || "see Salesforce setup logs"}
        </div>
      )}
      {done && job?.state === "JobComplete" && (
        <div className="alert ok" style={{ marginTop: 12 }}>
          ✅ Export ready.{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              download(`/api/salesforce/bulk/query/${job.id}/results`);
            }}
          >
            Download CSV
          </a>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Import
// ------------------------------------------------------------------
function BulkImport() {
  const [object, setObject] = usePersistentState("sfde.bulk.importObject", "");
  const [operation, setOperation] = usePersistentState(
    "sfde.bulk.importOperation",
    "insert"
  );
  const [externalId, setExternalId] = usePersistentState(
    "sfde.bulk.importExternalId",
    ""
  );
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [done, setDone] = useState(false);

  const job = useJobPoller("ingest", jobId, () => setDone(true));

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function start() {
    setStarting(true);
    setError(null);
    setDone(false);
    setJobId(null);
    try {
      const res = await fetch("/api/salesforce/bulk/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object,
          operation,
          externalIdFieldName: operation === "upsert" ? externalId : undefined,
          csv,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to start import");
      else setJobId(data.jobId);
    } catch {
      setError("Network error");
    } finally {
      setStarting(false);
    }
  }

  const failedCount = job?.numberRecordsFailed ?? 0;

  return (
    <div className="card">
      <h2>Import (insert / update / upsert / delete)</h2>
      <p className="muted">
        Upload a CSV whose header row uses Salesforce field API names. Runs a
        Bulk API 2.0 ingest job.
      </p>

      <div className="row" style={{ gap: 16 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="imp-object">Object (API name)</label>
          <input
            id="imp-object"
            placeholder="Account"
            value={object}
            onChange={(e) => setObject(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="imp-op">Operation</label>
          <select
            id="imp-op"
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
          >
            {OPERATIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {operation === "upsert" && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor="imp-extid">External ID field</label>
          <input
            id="imp-extid"
            placeholder="External_Id__c"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label>CSV data</label>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        {fileName && (
          <p className="muted" style={{ marginTop: 6 }}>
            Loaded <code>{fileName}</code> ({csv.length.toLocaleString()} chars)
          </p>
        )}
        <textarea
          style={{ marginTop: 8 }}
          placeholder="…or paste CSV here (Id,Name\n001...,Acme)"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setFileName(null);
          }}
          spellCheck={false}
        />
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={start}
          disabled={starting || !object || !csv.trim()}
        >
          {starting ? "Uploading…" : "Run import"}
        </button>
        {job && !done && (
          <span className="muted">
            Job {job.id} · <strong>{job.state}</strong> — polling…
          </span>
        )}
      </div>

      {error && (
        <div className="alert error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {done && job && (
        <div
          className={`alert ${failedCount > 0 ? "error" : "ok"}`}
          style={{ marginTop: 12 }}
        >
          {job.state === "JobComplete" ? "✅" : "⚠️"} {job.state} —{" "}
          {job.numberRecordsProcessed ?? 0} processed, {failedCount} failed.{" "}
          {(job.numberRecordsProcessed ?? 0) > 0 && (
            <>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  download(
                    `/api/salesforce/bulk/ingest/${job.id}/results?kind=successful`
                  );
                }}
              >
                Successful CSV
              </a>
              {failedCount > 0 && (
                <>
                  {" · "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      download(
                        `/api/salesforce/bulk/ingest/${job.id}/results?kind=failed`
                      );
                    }}
                  >
                    Failed CSV
                  </a>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function BulkTools() {
  return (
    <div>
      <h1>Bulk API</h1>
      <p className="muted">
        Export large datasets and import/upsert records with the Salesforce Bulk
        API 2.0.
      </p>
      <BulkExport />
      <BulkImport />
    </div>
  );
}
