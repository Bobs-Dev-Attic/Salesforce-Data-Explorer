import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/session";
import { getActiveConnection } from "@/lib/salesforce";
import RelationshipMap from "@/components/RelationshipMap";

export const dynamic = "force-dynamic";

export default async function SchemaPage() {
  if (!isAuthenticated()) redirect("/login");
  const conn = await getActiveConnection();
  if (!conn) {
    return (
      <div className="card">
        <h1>Schema</h1>
        <p className="muted">Connect a Salesforce org first.</p>
        <Link className="btn sf" href="/connections">
          Set up a connection
        </Link>
      </div>
    );
  }
  return <RelationshipMap />;
}
