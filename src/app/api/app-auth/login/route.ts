import { NextResponse } from "next/server";
import {
  checkPassword,
  createSessionCookie,
  isPasswordConfigured,
} from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let password = "";
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    password = String(body.password || "");
  } else {
    const form = await req.formData();
    password = String(form.get("password") || "");
  }

  if (!isPasswordConfigured()) {
    return NextResponse.json(
      {
        error:
          "APP_PASSWORD is not set on this deployment. Add it in Vercel → Settings → Environment Variables (Production) and redeploy.",
      },
      { status: 503 }
    );
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const cookie = createSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
