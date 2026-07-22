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

const EMPTY_FORM = {
  label: "",
  loginUrl: "https://login.salesforce.com",
  clientId: "",
  clientSecret: "",
};

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

  // Form state — shared for create & edit. editingId === null means "create".
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
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

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function openEdit(app: OAuthApp) {
    setEditingId(app.id);
    setForm({
      label: app.label,
      loginUrl: app.login_url,
      clientId: app.client_id,
      clientSecret: "", // blank = keep current secret
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  async function saveApp(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const isEdit = editingId !== null;
      const res = await fetch(
        isEdit ? `/api/salesforce/apps/${editingId}` : "/api/salesforce/apps",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save");
      } else {
        closeForm();
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const [connectingId, setConnectingId] = useState<string | null>(null);

  async function connectClientCreds(id: string) {
    setConnectingId(id);
    setError(null);
    try {
      const res = await fetch("/api/salesforce/connect-client-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Client Credentials connection failed");
      } else {
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setConnectingId(null);
    }
  }

  async function deleteApp(id: string) {
    if (
      !confirm(
        "Delete this Connected App? Existing connections that used it will need to be reconnected."
      )
    )
      return;
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

  async function renameConnection(c: Connection) {
    const next = prompt("Connection name", c.label || c.username || "");
    if (next === null) return;
    const label = next.trim();
    if (!label) return;
    await fetch(`/api/salesforce/connections/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", label }),
    });
    await load();
  }

  async function removeConnection(id: string) {
    if (!confirm("Disconnect this org? Its stored refresh token will be deleted."))
      return;
    await fetch(`/api/salesforce/connections/${id}`, { method: "DELETE" });
    await load();
  }

  function appLabel(appId: string | null): string {
    const a = apps.find((x) => x.id === appId);
    return a ? a.label : "—";
  }

  const isEdit = editingId !== null;
  const callback =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/salesforce/callback`
      : "/api/auth/salesforce/callback";

  return (
    <div>
      <h1>Connections</h1>
      <p className="muted">
        Register your Salesforce Connected App credentials, then connect one or
        more orgs. Client secrets and refresh tokens are encrypted at rest.
      </p>

      {connected && <div className="alert ok">✅ Salesforce org connected.</div>}
      {error && <div className="alert error">⚠️ {error}</div>}

      {/* Connected Apps */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Connected Apps</h2>
          {!showForm && (
            <button className="btn secondary" onClick={openCreate}>
              + Add Connected App
            </button>
          )}
        </div>

        {showForm && (
          <form onSubmit={saveApp} style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 16 }}>
              {isEdit ? "Edit Connected App" : "New Connected App"}
            </h2>
            <div className="row" style={{ gap: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="c-label">Label</label>
                <input
                  id="c-label"
                  placeholder="Production / Sandbox"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="c-login">Login URL</label>
                <input
                  id="c-login"
                  value={form.loginUrl}
                  onChange={(e) =>
                    setForm({ ...form, loginUrl: e.target.value })
                  }
                  placeholder="https://login.salesforce.com"
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="c-cid">Consumer Key (Client ID)</label>
              <input
                id="c-cid"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                spellCheck={false}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="c-secret">
                Consumer Secret (Client Secret)
                {isEdit && (
                  <span className="muted"> — leave blank to keep current</span>
                )}
              </label>
              <input
                id="c-secret"
                type="password"
                value={form.clientSecret}
                onChange={(e) =>
                  setForm({ ...form, clientSecret: e.target.value })
                }
                placeholder={isEdit ? "•••••••• (unchanged)" : ""}
                spellCheck={false}
              />
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Callback URL for the Connected App: <code>{callback}</code> ·
              Scopes: <code>api</code>, <code>refresh_token</code>,{" "}
              <code>offline_access</code>. Use{" "}
              <code>https://test.salesforce.com</code> for sandboxes.
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving
                  ? "Saving…"
                  : isEdit
                  ? "Save changes"
                  : "Save Connected App"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={closeForm}
              >
                Cancel
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
                    <td className="actions-cell">
                      <div className="actions">
                        <a
                          className="btn sf"
                          href={`/api/auth/salesforce/login?appId=${a.id}`}
                        >
                          Connect org
                        </a>
                        <button
                          className="btn secondary"
                          onClick={() => connectClientCreds(a.id)}
                          disabled={connectingId === a.id}
                          title="Server-to-server; no browser redirect. Requires Client Credentials Flow enabled on the Connected App."
                        >
                          {connectingId === a.id
                            ? "Connecting…"
                            : "Connect (Client Credentials)"}
                        </button>
                        <button className="linkbtn" onClick={() => openEdit(a)}>
                          Edit
                        </button>
                        <button
                          className="linkbtn"
                          onClick={() => deleteApp(a.id)}
                        >
                          Delete
                        </button>
                      </div>
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
                      <strong>{c.label || c.username}</strong>
                      {c.username && c.label !== c.username ? (
                        <div className="api">{c.username}</div>
                      ) : null}
                      {c.org_id ? <div className="api">{c.org_id}</div> : null}
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
                    <td className="actions-cell">
                      <div className="actions">
                        {!c.is_active && (
                          <button
                            className="btn secondary"
                            onClick={() => activate(c.id)}
                          >
                            Make active
                          </button>
                        )}
                        <button
                          className="linkbtn"
                          onClick={() => renameConnection(c)}
                        >
                          Rename
                        </button>
                        <button
                          className="linkbtn"
                          onClick={() => removeConnection(c.id)}
                        >
                          Disconnect
                        </button>
                      </div>
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
