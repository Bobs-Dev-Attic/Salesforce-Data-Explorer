import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/session";
import { getActiveConnection } from "@/lib/salesforce";
import BulkTools from "@/components/BulkTools";

export const dynamic = "force-dynamic";

export default async function BulkPage() {
  if (!isAuthenticated()) redirect("/login");
  const conn = await getActiveConnection();
  if (!conn) {
    return (
      <div className="card">
        <h1>Bulk API</h1>
        <p className="muted">Connect a Salesforce org first.</p>
        <Link className="btn sf" href="/">
          Go to dashboard
        </Link>
      </div>
    );
  }
  return <BulkTools />;
}
