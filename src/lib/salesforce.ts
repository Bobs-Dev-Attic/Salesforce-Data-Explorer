import { getAdminClient } from "./supabase";
import { decrypt, encrypt } from "./crypto";

/**
 * Salesforce REST + OAuth helpers.
 *
 * Connected App credentials (login URL, consumer key/secret) are registered by
 * the user in-app and stored in `salesforce_oauth_apps` (secret encrypted).
 * Each saved connection references the app it was authorized with, so token
 * refresh uses the correct client credentials. Multiple connections may be
 * saved; one is marked active at a time.
 *
 * OAuth 2.0 Web Server (authorization code) flow:
 *   1. Redirect user to <loginUrl>/services/oauth2/authorize
 *   2. Salesforce redirects back with ?code=...
 *   3. Exchange code for access_token + refresh_token (server side)
 *   4. Store the encrypted refresh_token; mint fresh access tokens on demand.
 */

const API_VERSION = "v61.0";
const DEFAULT_SCOPE = "api refresh_token offline_access";

export function redirectUri(): string {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/salesforce/callback`;
}

// ------------------------------------------------------------------
// OAuth apps (Connected App credentials)
// ------------------------------------------------------------------

export interface OAuthApp {
  id: string;
  label: string;
  login_url: string;
  client_id: string;
}

interface OAuthAppWithSecret extends OAuthApp {
  client_secret: string;
}

export async function listOAuthApps(): Promise<OAuthApp[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_oauth_apps")
    .select("id, label, login_url, client_id")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as OAuthApp[]) ?? [];
}

export async function createOAuthApp(params: {
  label: string;
  loginUrl: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthApp> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_oauth_apps")
    .insert({
      label: params.label,
      login_url: params.loginUrl,
      client_id: params.clientId,
      client_secret_encrypted: encrypt(params.clientSecret),
    })
    .select("id, label, login_url, client_id")
    .single();
  if (error) throw new Error(`Failed to save app: ${error.message}`);
  return data as OAuthApp;
}

export async function deleteOAuthApp(id: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("salesforce_oauth_apps")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getOAuthApp(id: string): Promise<OAuthApp | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_oauth_apps")
    .select("id, label, login_url, client_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OAuthApp) ?? null;
}

export async function updateOAuthApp(
  id: string,
  params: {
    label?: string;
    loginUrl?: string;
    clientId?: string;
    clientSecret?: string;
  }
): Promise<OAuthApp> {
  const supabase = getAdminClient();
  const patch: Record<string, unknown> = {};
  if (params.label !== undefined) patch.label = params.label;
  if (params.loginUrl !== undefined) patch.login_url = params.loginUrl;
  if (params.clientId !== undefined) patch.client_id = params.clientId;
  // Only rotate the secret when a non-empty value is supplied.
  if (params.clientSecret) {
    patch.client_secret_encrypted = encrypt(params.clientSecret);
  }
  if (Object.keys(patch).length === 0) {
    const app = await getOAuthApp(id);
    if (!app) throw new Error("Connected App not found");
    return app;
  }
  const { data, error } = await supabase
    .from("salesforce_oauth_apps")
    .update(patch)
    .eq("id", id)
    .select("id, label, login_url, client_id")
    .single();
  if (error) throw new Error(`Failed to update app: ${error.message}`);
  return data as OAuthApp;
}

async function getOAuthAppWithSecret(id: string): Promise<OAuthAppWithSecret> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_oauth_apps")
    .select("id, label, login_url, client_id, client_secret_encrypted")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Connected App not found");
  return {
    id: data.id as string,
    label: data.label as string,
    login_url: data.login_url as string,
    client_id: data.client_id as string,
    client_secret: decrypt(data.client_secret_encrypted as string),
  };
}

export function authorizeUrl(app: OAuthApp, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: app.client_id,
    redirect_uri: redirectUri(),
    scope: DEFAULT_SCOPE,
    state,
  });
  const base = app.login_url.replace(/\/$/, "");
  return `${base}/services/oauth2/authorize?${params.toString()}`;
}

// ------------------------------------------------------------------
// Token exchange / refresh
// ------------------------------------------------------------------

interface SalesforceTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string; // identity URL, e.g. https://login.salesforce.com/id/<orgId>/<userId>
  token_type: string;
  issued_at?: string;
}

async function postToken(
  loginUrl: string,
  body: URLSearchParams
): Promise<SalesforceTokenResponse> {
  const base = loginUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Salesforce token request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SalesforceTokenResponse;
}

/** Exchange an authorization code for tokens (uses the app's secret). */
export async function exchangeCodeForTokens(
  appId: string,
  code: string
): Promise<{ tokens: SalesforceTokenResponse; app: OAuthApp }> {
  const app = await getOAuthAppWithSecret(appId);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: app.client_id,
    client_secret: app.client_secret,
    redirect_uri: redirectUri(),
  });
  const tokens = await postToken(app.login_url, body);
  return { tokens, app };
}

/**
 * Marker stored in place of a refresh token for connections created via the
 * server-to-server Client Credentials flow (which issues no refresh token).
 * getAccessToken re-runs the client_credentials grant to mint fresh tokens.
 */
const CLIENT_CREDENTIALS_SENTINEL = "__client_credentials__";

/** Parse "https://.../id/<orgId>/<userId>" -> orgId. */
function parseOrgId(identityUrl: string): string | null {
  try {
    const parts = new URL(identityUrl).pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("id");
    return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
  } catch {
    return null;
  }
}

/** Server-to-server token via the Client Credentials grant (no redirect_uri). */
export async function clientCredentialsToken(
  appId: string
): Promise<{ access_token: string; instance_url: string; id?: string }> {
  const app = await getOAuthAppWithSecret(appId);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: app.client_id,
    client_secret: app.client_secret,
  });
  const json = await postToken(app.login_url, body);
  return {
    access_token: json.access_token,
    instance_url: json.instance_url,
    id: json.id,
  };
}

/**
 * Connect an org using the Client Credentials flow and save it as a
 * connection. No browser round-trip / callback is involved.
 */
export async function connectClientCredentials(
  appId: string
): Promise<StoredConnection> {
  const tok = await clientCredentialsToken(appId);
  let username: string | null = null;
  let orgId: string | null = null;
  if (tok.id) {
    orgId = parseOrgId(tok.id);
    try {
      const idRes = await fetch(tok.id, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (idRes.ok) {
        const identity = (await idRes.json()) as { username?: string };
        username = identity.username ?? null;
      }
    } catch {
      // non-fatal
    }
  }
  return saveConnection({
    oauthAppId: appId,
    orgId,
    username: username ?? "client-credentials",
    instanceUrl: tok.instance_url,
    refreshToken: CLIENT_CREDENTIALS_SENTINEL,
    label: username ?? "Client Credentials",
  });
}

async function refreshAccessToken(
  appId: string,
  refreshToken: string
): Promise<{ access_token: string; instance_url: string }> {
  const app = await getOAuthAppWithSecret(appId);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: app.client_id,
    client_secret: app.client_secret,
  });
  const json = await postToken(app.login_url, body);
  return { access_token: json.access_token, instance_url: json.instance_url };
}

// ------------------------------------------------------------------
// Connections
// ------------------------------------------------------------------

export interface StoredConnection {
  id: string;
  org_id: string | null;
  username: string | null;
  instance_url: string;
  label: string | null;
  is_active: boolean;
  oauth_app_id: string | null;
}

/** Persist a new connection (encrypting the refresh token first) and make it active. */
export async function saveConnection(params: {
  oauthAppId: string;
  orgId: string | null;
  username: string | null;
  instanceUrl: string;
  refreshToken: string;
  label?: string | null;
}): Promise<StoredConnection> {
  const supabase = getAdminClient();
  const row = {
    oauth_app_id: params.oauthAppId,
    org_id: params.orgId,
    username: params.username,
    instance_url: params.instanceUrl,
    refresh_token_encrypted: encrypt(params.refreshToken),
    label: params.label ?? params.username ?? params.instanceUrl,
    is_active: true,
  };
  const cols =
    "id, org_id, username, instance_url, label, is_active, oauth_app_id";

  // Manual find-or-update so we don't depend on an ON CONFLICT target
  // (the org_id unique index is partial, which Postgres won't accept there).
  // Re-connecting the same org replaces its stored credentials.
  let existingId: string | null = null;
  if (params.orgId) {
    const { data: existing } = await supabase
      .from("salesforce_connections")
      .select("id")
      .eq("org_id", params.orgId)
      .maybeSingle();
    existingId = (existing?.id as string) ?? null;
  }

  const query = existingId
    ? supabase
        .from("salesforce_connections")
        .update(row)
        .eq("id", existingId)
        .select(cols)
        .single()
    : supabase.from("salesforce_connections").insert(row).select(cols).single();

  const { data, error } = await query;
  if (error) throw new Error(`Failed to save connection: ${error.message}`);
  const saved = data as StoredConnection;
  await setActiveConnection(saved.id);
  return saved;
}

export async function listConnections(): Promise<StoredConnection[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_connections")
    .select("id, org_id, username, instance_url, label, is_active, oauth_app_id")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as StoredConnection[]) ?? [];
}

export async function getActiveConnection(): Promise<StoredConnection | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("salesforce_connections")
    .select("id, org_id, username, instance_url, label, is_active, oauth_app_id")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as StoredConnection;
  // Fallback: no row flagged active — use the most recent connection, if any.
  const { data: latest } = await supabase
    .from("salesforce_connections")
    .select("id, org_id, username, instance_url, label, is_active, oauth_app_id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (latest as StoredConnection) ?? null;
}

/** Mark one connection active and clear the flag on all others. */
export async function setActiveConnection(connectionId: string): Promise<void> {
  const supabase = getAdminClient();
  const { error: clearErr } = await supabase
    .from("salesforce_connections")
    .update({ is_active: false })
    .neq("id", connectionId);
  if (clearErr) throw new Error(clearErr.message);
  const { error } = await supabase
    .from("salesforce_connections")
    .update({ is_active: true })
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
}

export async function renameConnection(
  connectionId: string,
  label: string
): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("salesforce_connections")
    .update({ label })
    .eq("id", connectionId);
  if (error) throw new Error(error.message);
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
    .select("refresh_token_encrypted, instance_url, oauth_app_id")
    .eq("id", connectionId)
    .single();
  if (error || !data) throw new Error("Connection not found");
  if (!data.oauth_app_id) {
    throw new Error(
      "This connection is missing its Connected App reference — please reconnect the org."
    );
  }
  const refreshToken = decrypt(data.refresh_token_encrypted as string);
  const refreshed =
    refreshToken === CLIENT_CREDENTIALS_SENTINEL
      ? await clientCredentialsToken(data.oauth_app_id as string)
      : await refreshAccessToken(data.oauth_app_id as string, refreshToken);
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

/**
 * Approximate record counts for all counted objects, in one call
 * (/limits/recordCount). Cached like other metadata.
 */
export async function getRecordCounts(
  connectionId: string,
  forceRefresh = false
): Promise<Record<string, number>> {
  const key = "recordCounts";
  if (!forceRefresh) {
    const cached = await getCached<Record<string, number>>(connectionId, key);
    if (cached) return cached;
  }
  const res = await sfFetch(
    connectionId,
    `/services/data/${API_VERSION}/limits/recordCount`
  );
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    sObjects: { count: number; name: string }[];
  };
  const map: Record<string, number> = {};
  for (const s of json.sObjects) map[s.name] = s.count;
  await setCached(connectionId, key, map);
  return map;
}

export { API_VERSION };
