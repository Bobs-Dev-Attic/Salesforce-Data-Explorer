"use client";

import { useEffect, useRef, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import { useFocusTrap } from "@/lib/useFocusTrap";
import ErrorNotice from "@/components/ErrorNotice";
import ObjectPicker, { type GlobalObject } from "@/components/ObjectPicker";
import { splitCsvIntoChunks } from "@/lib/csv";

// Keep each upload comfortably under Vercel's ~4.5MB request-body limit.
const MAX_CHUNK_BYTES = 3_500_000;

interface ImportJobResult {
  id: string;
  state: string;
  processed: number;
  failed: number;
}

interface PreviewReport {
  object: string;
  operation: string;
  totalRows: number;
  analyzedRows: number;
  truncated: boolean;
  willInsert: number;
  willUpdate: number;
  willDelete: number;
  notFound: number;
  unknownFields: string[];
  issues: string[];
  sampleErrors: { row: number; issue: string }[];
}

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

const DESTRUCTIVE = new Set(["delete", "hardDelete"]);

/** Count CSV data rows (excluding the header and blank lines). */
function csvRowCount(csv: string): number {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(lines.length - 1, 0);
}

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
        <div style={{ marginTop: 12 }}>
          <ErrorNotice error={error} />
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
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [jobResults, setJobResults] = useState<ImportJobResult[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [objects, setObjects] = useState<GlobalObject[]>([]);
  const [preview, setPreview] = useState<PreviewReport | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const isDestructive = DESTRUCTIVE.has(operation);
  const rowCount = csvRowCount(csv);

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

  // A preview is only valid for the exact inputs it was generated from.
  useEffect(() => {
    setPreview(null);
  }, [csv, object, operation, externalId]);

  async function runPreview() {
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/salesforce/bulk/preview", {
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
      if (!res.ok) setError(data.error || "Preview failed");
      else setPreview(data.report as PreviewReport);
    } catch {
      setError("Network error");
    } finally {
      setPreviewing(false);
    }
  }

  function downloadReport() {
    if (!preview) return;
    const p = preview;
    const lines = [
      `Bulk import preview — ${p.object} (${p.operation})`,
      "",
      `Total rows: ${p.totalRows}`,
      `Analyzed rows: ${p.analyzedRows}${
        p.truncated ? ` (capped; ${p.totalRows} total)` : ""
      }`,
      `Will insert: ${p.willInsert}`,
      `Will update: ${p.willUpdate}`,
      `Will delete: ${p.willDelete}`,
      `Not found / row errors: ${p.notFound}`,
      "",
      `Unknown columns: ${
        p.unknownFields.length ? p.unknownFields.join(", ") : "none"
      }`,
      ...(p.issues.length ? ["", "Issues:", ...p.issues.map((i) => ` - ${i}`)] : []),
      ...(p.sampleErrors.length
        ? [
            "",
            `Sample row errors (first ${p.sampleErrors.length}):`,
            ...p.sampleErrors.map((e) => ` - row ${e.row}: ${e.issue}`),
          ]
        : []),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-preview-${p.object}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const previewTotal = preview
    ? preview.willInsert + preview.willUpdate + preview.willDelete
    : 0;
  const canApprove = Boolean(
    preview && preview.issues.length === 0 && previewTotal > 0
  );

  /** Approve the previewed import; destructive ops still get a typed confirm. */
  function onApprove() {
    if (isDestructive) {
      setConfirmText("");
      setConfirming(true);
    } else {
      runImport();
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  }

  /** Poll one ingest job until it reaches a terminal state. */
  async function pollJob(
    id: string,
    onState: (s: string) => void
  ): Promise<BulkJob> {
    for (let i = 0; i < 2400; i++) {
      const res = await fetch(`/api/salesforce/bulk/ingest/${id}`);
      const data = (await res.json()) as BulkJob;
      onState(data.state);
      if (TERMINAL.includes(data.state)) return data;
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error("Import timed out while polling job status");
  }

  /**
   * Run the import: split the CSV into chunks under the platform body limit and
   * run each as its own ingest job sequentially, aggregating the results.
   */
  async function runImport() {
    setConfirming(false);
    setPreview(null);
    setStarting(true);
    setError(null);
    setJobResults([]);
    setProgress("Preparing…");
    try {
      const chunks = splitCsvIntoChunks(csv, MAX_CHUNK_BYTES);
      if (chunks.length === 0) {
        setError("No CSV rows to import");
        return;
      }
      const params = new URLSearchParams({ object, operation });
      if (operation === "upsert" && externalId) {
        params.set("externalIdFieldName", externalId);
      }
      const results: ImportJobResult[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const label =
          chunks.length > 1 ? `part ${i + 1} of ${chunks.length}` : "data";
        setProgress(`Uploading ${label}…`);
        const res = await fetch(
          `/api/salesforce/bulk/ingest?${params.toString()}`,
          {
            method: "POST",
            headers: { "Content-Type": "text/csv" },
            body: chunks[i],
          }
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to start import");
          setJobResults([...results]);
          return;
        }
        const final = await pollJob(data.jobId, (state) =>
          setProgress(`${label[0].toUpperCase()}${label.slice(1)}: ${state}…`)
        );
        results.push({
          id: data.jobId,
          state: final.state,
          processed: final.numberRecordsProcessed ?? 0,
          failed: final.numberRecordsFailed ?? 0,
        });
        setJobResults([...results]);
      }
    } catch {
      setError("Network error during import");
    } finally {
      setStarting(false);
      setProgress(null);
    }
  }

  const totalProcessed = jobResults.reduce((n, j) => n + j.processed, 0);
  const totalFailed = jobResults.reduce((n, j) => n + j.failed, 0);

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
          <ObjectPicker
            id="imp-object"
            objects={objects}
            value={object}
            onSelect={setObject}
            placeholder="Account"
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
          onClick={runPreview}
          disabled={previewing || starting || !object || !csv.trim()}
        >
          {previewing ? "Analyzing…" : "Preview import"}
        </button>
        {progress && <span className="muted">{progress}</span>}
      </div>

      {preview && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              Preview — {preview.object}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                ({preview.operation})
              </span>
            </h3>
            <span className="muted">
              {preview.analyzedRows.toLocaleString()} of{" "}
              {preview.totalRows.toLocaleString()} rows analyzed
              {preview.truncated ? " (capped)" : ""}
            </span>
          </div>

          <div className="preview-stats">
            {preview.willInsert > 0 && (
              <span className="badge ok">
                {preview.willInsert.toLocaleString()} insert
              </span>
            )}
            {preview.willUpdate > 0 && (
              <span className="badge ok">
                {preview.willUpdate.toLocaleString()} update
              </span>
            )}
            {preview.willDelete > 0 && (
              <span className="badge off">
                {preview.willDelete.toLocaleString()} delete
              </span>
            )}
            {preview.notFound > 0 && (
              <span className="badge off">
                {preview.notFound.toLocaleString()} not found
              </span>
            )}
          </div>

          {preview.unknownFields.length > 0 && (
            <p className="muted" style={{ marginTop: 10 }}>
              ⚠️ Columns not on this object (will be rejected by Salesforce):{" "}
              <code>{preview.unknownFields.join(", ")}</code>
            </p>
          )}
          {preview.issues.length > 0 && (
            <div className="alert error" style={{ marginTop: 10 }}>
              {preview.issues.map((i, n) => (
                <div key={n}>{i}</div>
              ))}
            </div>
          )}
          {preview.sampleErrors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: "pointer" }}>
                {preview.sampleErrors.length} sample row issue(s)
              </summary>
              <ul style={{ margin: "6px 0 0", fontSize: 13 }}>
                {preview.sampleErrors.map((e, n) => (
                  <li key={n}>
                    row {e.row}: {e.issue}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <button
              className={`btn${isDestructive ? " danger" : ""}`}
              onClick={onApprove}
              disabled={!canApprove || starting}
            >
              {starting
                ? "Uploading…"
                : isDestructive
                ? `Approve & ${
                    operation === "hardDelete" ? "hard delete" : "delete"
                  } ${previewTotal.toLocaleString()}`
                : `Approve & run import (${previewTotal.toLocaleString()})`}
            </button>
            <button className="btn secondary" onClick={downloadReport}>
              Download report
            </button>
            <button className="btn secondary" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
          {!canApprove && preview.issues.length === 0 && previewTotal === 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Nothing to import — no rows would be inserted, updated, or deleted.
            </p>
          )}
        </div>
      )}

      {confirming && (
        <DestructiveConfirm
          operation={operation}
          object={object}
          rowCount={preview ? preview.willDelete : rowCount}
          confirmText={confirmText}
          setConfirmText={setConfirmText}
          onCancel={() => setConfirming(false)}
          onConfirm={runImport}
        />
      )}

      {error && (
        <div style={{ marginTop: 12 }}>
          <ErrorNotice error={error} />
        </div>
      )}

      {jobResults.length > 0 && !starting && (
        <div
          className={`alert ${totalFailed > 0 ? "error" : "ok"}`}
          style={{ marginTop: 12 }}
        >
          {totalFailed > 0 ? "⚠️" : "✅"} Import complete —{" "}
          {totalProcessed.toLocaleString()} processed, {totalFailed.toLocaleString()}{" "}
          failed
          {jobResults.length > 1 ? ` across ${jobResults.length} jobs` : ""}.
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {jobResults.map((j, i) => (
              <div key={j.id} style={{ fontSize: 13 }}>
                {jobResults.length > 1 && <strong>Part {i + 1}: </strong>}
                {j.state} — {j.processed.toLocaleString()} processed,{" "}
                {j.failed.toLocaleString()} failed{" "}
                {j.processed > 0 && (
                  <>
                    ·{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        download(
                          `/api/salesforce/bulk/ingest/${j.id}/results?kind=successful`
                        );
                      }}
                    >
                      Successful CSV
                    </a>
                  </>
                )}
                {j.failed > 0 && (
                  <>
                    {" · "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        download(
                          `/api/salesforce/bulk/ingest/${j.id}/results?kind=failed`
                        );
                      }}
                    >
                      Failed CSV
                    </a>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Destructive-op confirmation
// ------------------------------------------------------------------
function DestructiveConfirm({
  operation,
  object,
  rowCount,
  confirmText,
  setConfirmText,
  onCancel,
  onConfirm,
}: {
  operation: string;
  object: string;
  rowCount: number;
  confirmText: string;
  setConfirmText: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hard = operation === "hardDelete";
  const verb = hard ? "Hard delete" : "Delete";
  const matches = confirmText.trim() === object.trim() && object.trim() !== "";
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onCancel);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Confirm ${verb.toLowerCase()}`}
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong style={{ color: "var(--danger)" }}>⚠️ Confirm {verb.toLowerCase()}</strong>
          <button className="linkbtn" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <p style={{ marginTop: 0 }}>
            You are about to <strong>{verb.toLowerCase()}</strong>{" "}
            <strong>{rowCount.toLocaleString()}</strong> record
            {rowCount === 1 ? "" : "s"} from{" "}
            <strong>{object || "(no object)"}</strong> in the active connection.
          </p>
          {hard && (
            <div className="alert error" style={{ marginBottom: 12 }}>
              Hard delete permanently removes records, bypassing the Recycle Bin.
              This cannot be undone.
            </div>
          )}
          <label htmlFor="confirm-object">
            Type the object name <code>{object}</code> to confirm
          </label>
          <input
            id="confirm-object"
            autoFocus
            value={confirmText}
            placeholder={object}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches) onConfirm();
            }}
          />
          <div
            className="row"
            style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}
          >
            <button className="btn secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn danger" onClick={onConfirm} disabled={!matches}>
              {verb} {rowCount.toLocaleString()} record{rowCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
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
