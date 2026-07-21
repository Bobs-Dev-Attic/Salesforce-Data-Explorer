import { getAdminClient } from "./supabase";
import { decrypt, encrypt } from "./crypto";

/**
 * Salesforce REST + OAuth helpers.
 *
 * OAuth 2.0 Web Server (authorization code) flow:
 *   1. Redirect user to /services/oauth2/authorize
 *   2. Salesforce redirects back with ?code=...
 *   3. Exchange code for access_token + refresh_token (server side)
 *   4. Store the encrypted refresh_token; mint fresh access tokens on demand.
 */

const API_VERSION = "v61.0";

export function loginBaseUrl(): string {
  return process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
}

export function redirectUri(): string {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/salesforce/callback`;
}

export function authorizeUrl(state: string): string {
  const clientId = requireEnv("SALESFORCE_CLIENT_ID");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: "api refresh_token offline_access",
    state,
  });
  return `${loginBaseUrl()}/services/oauth2/authorize?${params.toString()}`;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

interface SalesforceTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string; // identity URL, e.g. https://login.salesforce.com/id/<orgId>/<userId>
  token_type: string;
  issued_at?: string;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForTokens(
  code: string
): Promise<SalesforceTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: requireEnv("SALESFORCE_CLIENT_ID"),
    client_secret: requireEnv("SALESFORCE_CLIENT_SECRET"),
    redirect_uri: redirectUri(),
  });
  const res = await fetch(`${loginBaseUrl()}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SalesforceTokenResponse;
}

/** Use a refresh token to mint a new access token. */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; instance_url: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("SALESFORCE_CLIENT_ID"),
    client_secret: requireEnv("SALESFORCE_CLIENT_SECRET"),
  });
  const res = await fetch(`${loginBaseUrl()}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as SalesforceTokenResponse;
  return { access_token: json.access_token, instance_url: json.instance_url };
}

export interface StoredConnection {
  id: string;
  org_id: string | null;
  username: string | null;
  instance_url: string;
  label: string | null;
}

/** Persist a new connection (encrypting the refresh token first). */
export async function saveConnection(params: {
  orgId: string | null;
  username: string | null;
  instanceUrl: string;
  refreshToken: string;
  label?: string | null;
}): Promise<StoredConnection> {
  const supabase = getAdminClient();
  const refresh_token_encrypted = encrypt(params.refreshToken);
  const row = {
    org_id: params.orgId,
    username: params.username,
    instance_url: params.instanceUrl,
    refresh_token_encrypted,
    label: params.label ?? params.username ?? params.instanceUrl,
    is_active: true,
  };
  // Upsert on org_id so re-connecting the same org replaces credentials.
  const { data, error } = await supabase
    .from("salesforce_connections")
    .upsert(row, { onConflict: "org_id" })
    .select("id, org_id, username, instance_url, label")
    .single();
  if (error) throw new Error(`Failed to save connection: ${error.message}`);
  return data as StoredConnection;
}

/** Fetch the active connection (single-user: most recently updated). */
export async function getActiveConnection(): Promise<StoredConnection | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_connections")
    .select("id, org_id, username, instance_url, label")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredConnection) ?? null;
}

export async function disconnect(connectionId: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("salesforce_connections")
    .delete()
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
}

/** Return a ready-to-use access token + instance url for a connection. */
export async function getAccessToken(
  connectionId: string
): Promise<{ accessToken: string; instanceUrl: string }> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_connections")
    .select("refresh_token_encrypted, instance_url")
    .eq("id", connectionId)
    .single();
  if (error || !data) throw new Error("Connection not found");
  const refreshToken = decrypt(data.refresh_token_encrypted as string);
  const refreshed = await refreshAccessToken(refreshToken);
  // instance_url can change (e.g. after a My Domain migration); keep it fresh.
  if (refreshed.instance_url && refreshed.instance_url !== data.instance_url) {
    await supabase
      .from("salesforce_connections")
      .update({ instance_url: refreshed.instance_url })
      .eq("id", connectionId);
  }
  return {
    accessToken: refreshed.access_token,
    instanceUrl: refreshed.instance_url || (data.instance_url as string),
  };
}

/** Low-level authenticated request against the Salesforce REST API. */
export async function sfFetch(
  connectionId: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const { accessToken, instanceUrl } = await getAccessToken(connectionId);
  const url = path.startsWith("http")
    ? path
    : `${instanceUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

export interface SoqlResult {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: Record<string, unknown>[];
}

/** Run a SOQL query. Follows nextRecordsUrl up to `maxRecords`. */
export async function runSoql(
  connectionId: string,
  soql: string,
  maxRecords = 2000
): Promise<SoqlResult> {
  const first = await sfFetch(
    connectionId,
    `/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`
  );
  if (!first.ok) {
    throw new Error(await first.text());
  }
  const page = (await first.json()) as SoqlResult;
  const records = page.records.slice();
  let done = page.done;
  let nextUrl = page.nextRecordsUrl;
  while (!done && nextUrl && records.length < maxRecords) {
    const res = await sfFetch(connectionId, nextUrl);
    if (!res.ok) throw new Error(await res.text());
    const next = (await res.json()) as SoqlResult;
    records.push(...next.records);
    done = next.done;
    nextUrl = next.nextRecordsUrl;
  }
  return {
    totalSize: page.totalSize,
    done,
    nextRecordsUrl: nextUrl,
    records: records.slice(0, maxRecords),
  };
}

// ------------------------------------------------------------------
// Metadata (describe) with Supabase caching
// ------------------------------------------------------------------

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

async function getCached<T>(
  connectionId: string,
  key: string
): Promise<T | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("sf_metadata_cache")
    .select("payload, fetched_at")
    .eq("connection_id", connectionId)
    .eq("cache_key", key)
    .maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.fetched_at as string).getTime();
  if (age > CACHE_TTL_MS) return null;
  return data.payload as T;
}

async function setCached(
  connectionId: string,
  key: string,
  payload: unknown
): Promise<void> {
  const supabase = getAdminClient();
  await supabase.from("sf_metadata_cache").upsert(
    {
      connection_id: connectionId,
      cache_key: key,
      payload: payload as object,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,cache_key" }
  );
}

export interface GlobalObject {
  name: string;
  label: string;
  queryable: boolean;
  custom: boolean;
}

export async function describeGlobal(
  connectionId: string,
  forceRefresh = false
): Promise<GlobalObject[]> {
  const key = "describeGlobal";
  if (!forceRefresh) {
    const cached = await getCached<GlobalObject[]>(connectionId, key);
    if (cached) return cached;
  }
  const res = await sfFetch(
    connectionId,
    `/services/data/${API_VERSION}/sobjects/`
  );
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    sobjects: {
      name: string;
      label: string;
      queryable: boolean;
      custom: boolean;
    }[];
  };
  const objects: GlobalObject[] = json.sobjects.map((s) => ({
    name: s.name,
    label: s.label,
    queryable: s.queryable,
    custom: s.custom,
  }));
  await setCached(connectionId, key, objects);
  return objects;
}

export async function describeSObject(
  connectionId: string,
  objectName: string,
  forceRefresh = false
): Promise<Record<string, unknown>> {
  const safe = objectName.replace(/[^a-zA-Z0-9_]/g, "");
  const key = `describe:${safe}`;
  if (!forceRefresh) {
    const cached = await getCached<Record<string, unknown>>(connectionId, key);
    if (cached) return cached;
  }
  const res = await sfFetch(
    connectionId,
    `/services/data/${API_VERSION}/sobjects/${safe}/describe/`
  );
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as Record<string, unknown>;
  await setCached(connectionId, key, json);
  return json;
}

export { API_VERSION };
