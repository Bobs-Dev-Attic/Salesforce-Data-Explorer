import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import { getActiveConnection } from "@/lib/salesforce";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { connected?: string; sf_error?: string };
}) {
  if (!isAuthenticated()) {
    redirect("/login");
  }

  const conn = await getActiveConnection();

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">
        Securely connect to Salesforce, run SOQL, and explore your data.
      </p>

      {searchParams.connected && (
        <div className="alert ok">✅ Salesforce connected successfully.</div>
      )}
      {searchParams.sf_error && (
        <div className="alert error">⚠️ {searchParams.sf_error}</div>
      )}

      <div className="card">
        <h2>Salesforce connection</h2>
        {conn ? (
          <>
            <p>
              <span className="badge ok">Connected</span>{" "}
              <strong>{conn.username || conn.label}</strong>
            </p>
            <p className="muted">
              Instance: <code>{conn.instance_url}</code>
              {conn.org_id ? (
                <>
                  {" "}
                  · Org: <code>{conn.org_id}</code>
                </>
              ) : null}
            </p>
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn" href="/query">
                Run SOQL
              </Link>
              <Link className="btn secondary" href="/objects">
                Explore objects
              </Link>
              <Link className="btn secondary" href="/bulk">
                Bulk API
              </Link>
              <form action="/api/salesforce/disconnect" method="post" className="inline">
                <button className="btn danger" type="submit">
                  Disconnect
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p>
              <span className="badge off">Not connected</span>
            </p>
            <p className="muted">
              Connect your Salesforce org to get started. You&apos;ll log in on
              Salesforce&apos;s own page — we only store an encrypted refresh
              token.
            </p>
            <a className="btn sf" href="/api/auth/salesforce/login">
              Connect to Salesforce
            </a>
          </>
        )}
      </div>

      <div className="card">
        <h2>What you can do</h2>
        <ul className="muted">
          <li>Run ad-hoc SOQL queries and browse results in a grid.</li>
          <li>Explore every SObject and its fields (metadata is cached).</li>
          <li>Export query results to CSV.</li>
          <li>Bulk-export large datasets and import/upsert via the Bulk API 2.0.</li>
        </ul>
      </div>
    </div>
  );
}
