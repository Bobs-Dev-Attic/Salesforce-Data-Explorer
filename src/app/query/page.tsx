import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import { getActiveConnection } from "@/lib/salesforce";
import QueryRunner from "@/components/QueryRunner";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QueryPage() {
  if (!(await isAuthenticated())) redirect("/login");
  const conn = await getActiveConnection();
  if (!conn) {
    return (
      <div className="card">
        <h1>SOQL</h1>
        <p className="muted">Connect a Salesforce org first.</p>
        <Link className="btn sf" href="/">
          Go to dashboard
        </Link>
      </div>
    );
  }
  return <QueryRunner />;
}
