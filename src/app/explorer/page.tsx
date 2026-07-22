import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/session";
import { getActiveConnection } from "@/lib/salesforce";
import DataExplorer from "@/components/DataExplorer";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  if (!isAuthenticated()) redirect("/login");
  const conn = await getActiveConnection();
  if (!conn) {
    return (
      <div className="card">
        <h1>Data Explorer</h1>
        <p className="muted">Connect a Salesforce org first.</p>
        <Link className="btn sf" href="/connections">
          Set up a connection
        </Link>
      </div>
    );
  }
  return <DataExplorer />;
}
