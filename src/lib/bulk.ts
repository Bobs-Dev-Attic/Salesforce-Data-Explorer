import { getAccessToken, API_VERSION } from "./salesforce";

/**
 * Salesforce Bulk API 2.0 helpers.
 *
 * Two flows:
 *  - Query jobs  (export): POST a SOQL query, poll, download CSV results.
 *  - Ingest jobs (import): POST job spec, PUT CSV data, close, poll, read results.
 *
 * Docs: /services/data/vXX.X/jobs/query and /jobs/ingest
 */

export type IngestOperation =
  | "insert"
  | "update"
  | "upsert"
  | "delete"
  | "hardDelete";

async function bulkFetch(
  connectionId: string,
  path: string,
  init: RequestInit & { rawBody?: string; accept?: string } = {}
): Promise<Response> {
  const { accessToken, instanceUrl } = await getAccessToken(connectionId);
  const url = path.startsWith("http")
    ? path
    : `${instanceUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(init.headers as Record<string, string>),
  };
  if (init.accept) headers["Accept"] = init.accept;
  return fetch(url, { ...init, headers });
}

// ------------------------------------------------------------------
// Query jobs (bulk export)
// ------------------------------------------------------------------

export interface BulkJob {
  id: string;
  state: string; // Open | UploadComplete | InProgress | JobComplete | Aborted | Failed
  object?: string;
  operation?: string;
  numberRecordsProcessed?: number;
  numberRecordsFailed?: number;
  errorMessage?: string;
}

export async function createQueryJob(
  connectionId: string,
  soql: string
): Promise<BulkJob> {
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "query", query: soql }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as BulkJob;
}

export async function getQueryJob(
  connectionId: string,
  jobId: string
): Promise<BulkJob> {
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/query/${jobId}`,
    { headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as BulkJob;
}

/**
 * Fetch one page of query results as CSV. Returns the CSV text plus the
 * Sforce-Locator for the next page (or null when done).
 */
export async function getQueryResults(
  connectionId: string,
  jobId: string,
  locator?: string,
  maxRecords = 100000
): Promise<{ csv: string; nextLocator: string | null }> {
  const params = new URLSearchParams({ maxRecords: String(maxRecords) });
  if (locator) params.set("locator", locator);
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/query/${jobId}/results?${params.toString()}`,
    { accept: "text/csv" }
  );
  if (!res.ok) throw new Error(await res.text());
  const csv = await res.text();
  const next = res.headers.get("Sforce-Locator");
  // Salesforce sends the literal string "null" when there are no more pages.
  const nextLocator = !next || next === "null" ? null : next;
  return { csv, nextLocator };
}

// ------------------------------------------------------------------
// Ingest jobs (bulk import)
// ------------------------------------------------------------------

export async function createIngestJob(
  connectionId: string,
  params: {
    object: string;
    operation: IngestOperation;
    externalIdFieldName?: string;
  }
): Promise<BulkJob> {
  const body: Record<string, string> = {
    object: params.object,
    operation: params.operation,
    contentType: "CSV",
    lineEnding: "LF",
  };
  if (params.operation === "upsert") {
    if (!params.externalIdFieldName) {
      throw new Error("upsert requires an externalIdFieldName");
    }
    body.externalIdFieldName = params.externalIdFieldName;
  }
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/ingest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as BulkJob;
}

export async function uploadIngestData(
  connectionId: string,
  jobId: string,
  csv: string
): Promise<void> {
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/ingest/${jobId}/batches`,
    {
      method: "PUT",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    }
  );
  if (!res.ok) throw new Error(await res.text());
}

export async function closeIngestJob(
  connectionId: string,
  jobId: string
): Promise<BulkJob> {
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/ingest/${jobId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "UploadComplete" }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as BulkJob;
}

export async function abortIngestJob(
  connectionId: string,
  jobId: string
): Promise<void> {
  await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/ingest/${jobId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "Aborted" }),
    }
  );
}

export async function getIngestJob(
  connectionId: string,
  jobId: string
): Promise<BulkJob> {
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/ingest/${jobId}`,
    { headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as BulkJob;
}

export type IngestResultKind = "successfulResults" | "failedResults";

export async function getIngestResults(
  connectionId: string,
  jobId: string,
  kind: IngestResultKind
): Promise<string> {
  const res = await bulkFetch(
    connectionId,
    `/services/data/${API_VERSION}/jobs/ingest/${jobId}/${kind}`,
    { accept: "text/csv" }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

/** One-shot ingest: create → upload → close, returning the job to poll. */
export async function startIngest(
  connectionId: string,
  params: {
    object: string;
    operation: IngestOperation;
    externalIdFieldName?: string;
    csv: string;
  }
): Promise<BulkJob> {
  const job = await createIngestJob(connectionId, params);
  await uploadIngestData(connectionId, job.id, params.csv);
  return closeIngestJob(connectionId, job.id);
}
