import { NextResponse } from "next/server";
import { getActiveConnection, sfFetch, API_VERSION } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Authoritative SOQL validation via Salesforce's Query Explain endpoint
 * (`/query/?explain=…`). It plans the query — checking objects, fields,
 * relationships, and syntax — WITHOUT executing it or returning rows. A valid
 * query yields a query plan (200); an invalid one yields a 400 whose body is
 * the real Salesforce error (INVALID_FIELD / MALFORMED_QUERY / …), which the
 * client maps through friendlyError + parseSoqlErrorLocation for an inline
 * squiggle.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conn = await getActiveConnection();
  if (!conn) {
    return NextResponse.json(
      { error: "No Salesforce connection" },
      { status: 400 }
    );
  }

  let soql = "";
  try {
    const body = await req.json();
    if (typeof body?.soql === "string") soql = body.soql;
  } catch {
    /* fall through to the empty-query check */
  }
  if (!soql.trim()) {
    return NextResponse.json(
      { valid: false, error: "Empty query" },
      { status: 200 }
    );
  }

  try {
    const path = `/services/data/${API_VERSION}/query/?explain=${encodeURIComponent(
      soql
    )}`;
    const res = await sfFetch(conn.id, path);
    if (res.ok) {
      return NextResponse.json({ valid: true });
    }
    // Return the raw Salesforce error text; the client formats it. 200 so the
    // client treats "invalid query" as a normal result, not a transport error.
    const text = await res.text();
    return NextResponse.json({ valid: false, error: text }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Validation failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
