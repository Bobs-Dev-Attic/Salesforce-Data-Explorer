import { getActiveConnection } from "@/lib/salesforce";
import { getQueryResults } from "@/lib/bulk";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/** Strip the header row from a CSV chunk (used for pages 2..N). */
function dropHeader(csv: string): string {
  const nl = csv.indexOf("\n");
  return nl >= 0 ? csv.slice(nl + 1) : "";
}

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  if (!(await isAuthenticated())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const conn = await getActiveConnection();
  if (!conn) {
    return new Response(JSON.stringify({ error: "No Salesforce connection" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Gather all pages following the Sforce-Locator, keeping a single header.
    let locator: string | null = undefined as unknown as string | null;
    let first = true;
    const parts: string[] = [];
    // Cap iterations as a safety valve against unexpected non-terminating locators.
    for (let i = 0; i < 1000; i++) {
      const page: { csv: string; nextLocator: string | null } =
        await getQueryResults(
          conn.id,
          params.jobId,
          locator ?? undefined,
          100000
        );
      parts.push(first ? page.csv : dropHeader(page.csv));
      first = false;
      if (!page.nextLocator) break;
      locator = page.nextLocator;
    }
    const csv = parts.join("");
    const filename = `bulk-export-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch results";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
