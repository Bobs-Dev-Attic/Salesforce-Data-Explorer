import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/session";
import ConnectionsManager from "@/components/ConnectionsManager";

export const dynamic = "force-dynamic";

export default function ConnectionsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  if (!isAuthenticated()) redirect("/login");
  return (
    <ConnectionsManager
      connected={Boolean(searchParams.connected)}
      initialError={searchParams.error || null}
    />
  );
}
