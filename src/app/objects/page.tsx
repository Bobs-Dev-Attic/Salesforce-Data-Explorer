import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/session";
import { getActiveConnection } from "@/lib/salesforce";
import ObjectExplorer from "@/components/ObjectExplorer";

export const dynamic = "force-dynamic";

export default async function ObjectsPage() {
  if (!(await isAuthenticated())) redirect("/login");
  const conn = await getActiveConnection();
  if (!conn) {
    return (
      <div className="card">
        <h1>Objects</h1>
        <p className="muted">Connect a Salesforce org first.</p>
        <Link className="btn sf" href="/">
          Go to dashboard
        </Link>
      </div>
    );
  }
  return <ObjectExplorer />;
}
