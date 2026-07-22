"use client";

import { useCallback, useEffect, useState } from "react";

interface OAuthApp {
  id: string;
  label: string;
  login_url: string;
  client_id: string;
}

interface Connection {
  id: string;
  org_id: string | null;
  username: string | null;
  instance_url: string;
  label: string | null;
  is_active: boolean;
  oauth_app_id: string | null;
}

export default function ConnectionsManager({
  connected,
  initialError,
}: {
  connected: boolean;
  initialError: string | null;
}) {
  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // new-app form state
  const [label, setLabel] = useState("");
  const [loginUrl, setLoginUrl] = useState("https://login.salesforce.com");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, connRes] = await Promise.all([
        fetch("/api/salesforce/apps"),
        fetch("/api/salesforce/connections"),
      ]);
      const appsData = await appsRes.json();
      const connData = await connRes.json();
      if (appsRes.ok) setApps(appsData.apps || []);
      if (connRes.ok) setConnections(connData.connections || []);
      if (!appsRes.ok) setError(appsData.error || "Failed to load apps");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveApp(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/salesforce/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, loginUrl, clientId, clientSecret }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
      } else {
        setLabel("");
        setClientId("");
        setClientSecret("");
        setLoginUrl("https://login.salesforce.com");
        setShowForm(false);
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp(id: string) {
    if (!confirm("Delete this Connected App? Existing connections that used it will need to be reconnected.")) return;
    await fetch(`/api/salesforce/apps/${id}`, { method: "DELETE" });
    await load();
  }

  async function activate(id: string) {
    await fetch(`/api/salesforce/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate" }),
    });
    await load();
  }

  async function removeConnection(id: string) {
    if (!confirm("Disconnect this org? Its stored refresh token will be deleted.")) return;
    await fetch(`/api/salesforce/connections/${id}`, { method: "DELETE" });
    await load();
  }

  function appLabel(appId: string | null): string {
    const a = apps.find((x) => x.id === appId);
    return a ? a.label : "—";
  }

  return (
    <div>
      <h1>Connections</h1>
      <p className="muted">
        Register your Salesforce Connected App credentials, then connect one or
        more orgs. Client secrets and refresh tokens are encrypted at rest.
      </p>

      {connected && (
        <div className="alert ok">✅ Salesforce org connected.</div>
      )}
      {error && <div className="alert error">⚠️ {error}</div>}

      {/* Connected Apps */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Connected Apps</h2>
          <button
            className="btn secondary"
            onClick={() => setShowForm((s) => !s)}
          >
            {showForm ? "Cancel" : "+ Add Connected App"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={saveApp} style={{ marginTop: 16 }}>
            <div className="row" style={{ gap: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="c-label">Label</label>
                <input
                  id="c-label"
                  placeholder="Production / Sandbox"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="c-login">Login URL</label>
                <input
                  id="c-login"
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="https://login.salesforce.com"
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="c-cid">Consumer Key (Client ID)</label>
              <input
                id="c-cid"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="c-secret">Consumer Secret (Client Secret)</label>
              <input
                id="c-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                spellCheck={false}
              />
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Callback URL for the Connected App:{" "}
              <code>
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/auth/salesforce/callback`
                  : "/api/auth/salesforce/callback"}
              </code>{" "}
              · Scopes: <code>api</code>, <code>refresh_token</code>,{" "}
              <code>offline_access</code>. Use{" "}
              <code>https://test.salesforce.com</code> for sandboxes.
            </p>
            <div style={{ marginTop: 12 }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Connected App"}
              </button>
            </div>
          </form>
        )}

        {!loading && apps.length === 0 && !showForm && (
          <p className="muted" style={{ marginTop: 12 }}>
            No Connected Apps yet. Add one to start connecting orgs.
          </p>
        )}

        {apps.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Login URL</th>
                  <th>Client ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.label}</strong>
                    </td>
                    <td>{a.login_url}</td>
                    <td title={a.client_id}>{a.client_id.slice(0, 18)}…</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <a className="btn sf" href={`/api/auth/salesforce/login?appId=${a.id}`}>
                        Connect org
                      </a>{" "}
                      <button
                        className="linkbtn"
                        onClick={() => deleteApp(a.id)}
                        style={{ marginLeft: 8 }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Saved connections */}
      <div className="card">
        <h2>Saved connections</h2>
        {loading && <p className="spinner">Loading…</p>}
        {!loading && connections.length === 0 && (
          <p className="muted">
            No connections yet. Add a Connected App above, then click{" "}
            <em>Connect org</em>.
          </p>
        )}
        {connections.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Org</th>
                  <th>Instance</th>
                  <th>App</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.username || c.label}</strong>
                      {c.org_id ? (
                        <div className="api">{c.org_id}</div>
                      ) : null}
                    </td>
                    <td title={c.instance_url}>{c.instance_url}</td>
                    <td>{appLabel(c.oauth_app_id)}</td>
                    <td>
                      {c.is_active ? (
                        <span className="badge ok">Active</span>
                      ) : (
                        <span className="badge off">Idle</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {!c.is_active && (
                        <button
                          className="btn secondary"
                          onClick={() => activate(c.id)}
                        >
                          Make active
                        </button>
                      )}{" "}
                      <button
                        className="linkbtn"
                        onClick={() => removeConnection(c.id)}
                        style={{ marginLeft: 8 }}
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
