import { NextResponse } from "next/server";
import {
  checkPassword,
  createSessionCookie,
  isPasswordConfigured,
} from "@/lib/session";
import {
  checkRateLimit,
  clientIp,
  recordFailure,
  recordSuccess,
} from "@/lib/rateLimit";
import { assertEnv } from "@/lib/env";

export const runtime = "nodejs";

function lockedResponse(retryAfterSec?: number) {
  return NextResponse.json(
    {
      error:
        "Too many failed attempts. Please wait before trying again.",
    },
    {
      status: 429,
      headers: retryAfterSec ? { "Retry-After": String(retryAfterSec) } : undefined,
    }
  );
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers);

  // Refuse before touching the password when this client is locked out.
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return lockedResponse(limit.retryAfterSec);
  }

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
    const result = recordFailure(ip);
    if (result.locked) {
      return lockedResponse(result.retryAfterSec);
    }
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  recordSuccess(ip);

  // Password is correct — fail fast with a clear message if the rest of the
  // environment is misconfigured, instead of a deep 500 from the calls below.
  try {
    assertEnv();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server misconfiguration" },
      { status: 503 }
    );
  }

  const cookie = await createSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
