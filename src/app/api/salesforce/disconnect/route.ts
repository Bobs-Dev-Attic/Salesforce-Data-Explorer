import { NextResponse } from "next/server";
import { disconnect, getActiveConnection } from "@/lib/salesforce";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  if (!isAuthenticated()) {
    return NextResponse.redirect(new URL("/login", base), { status: 303 });
  }
  const conn = await getActiveConnection();
  if (conn) {
    await disconnect(conn.id);
  }
  return NextResponse.redirect(new URL("/?disconnected=1", base), {
    status: 303,
  });
}
