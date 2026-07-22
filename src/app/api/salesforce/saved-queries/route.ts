import { NextResponse } from "next/server";
import {
  isMissingTableError,
  listSavedQueries,
  saveQuery,
} from "@/lib/savedQueries";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const queries = await listSavedQueries();
    return NextResponse.json({ queries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load saved queries";
    if (isMissingTableError(msg)) {
      // Table not migrated yet — degrade gracefully.
      return NextResponse.json({ queries: [], needsMigration: true });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const soql = String(body.soql || "").trim();
  if (!name || !soql) {
    return NextResponse.json(
      { error: "name and soql are required" },
      { status: 400 }
    );
  }
  try {
    const query = await saveQuery({
      name,
      objectName: body.objectName ? String(body.objectName) : null,
      soql,
      builderState: body.builderState ?? null,
    });
    return NextResponse.json({ query });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save query";
    if (isMissingTableError(msg)) {
      return NextResponse.json(
        {
          error:
            "Saved queries need migration 0003_saved_queries.sql to be run in Supabase.",
          needsMigration: true,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
