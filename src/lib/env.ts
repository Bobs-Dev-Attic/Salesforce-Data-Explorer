import { activeKeyId } from "./crypto";

/**
 * Environment validation. Missing/invalid config otherwise surfaces as a deep,
 * confusing failure mid-request; `assertEnv()` fails fast with one aggregated
 * message, and `checkEnv()` powers the `/api/health` route without ever
 * returning secret *values* (only names + presence/validity).
 */

export interface EnvCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail?: string;
}

function present(name: string): boolean {
  return Boolean((process.env[name] || "").trim());
}

export function checkEnv(): { ok: boolean; checks: EnvCheck[] } {
  const checks: EnvCheck[] = [];

  const requireVar = (name: string, validate?: () => string | null) => {
    let ok = present(name);
    let detail: string | undefined = ok ? undefined : "not set";
    if (ok && validate) {
      const err = validate();
      if (err) {
        ok = false;
        detail = err;
      }
    }
    checks.push({ name, ok, required: true, detail });
  };

  requireVar("APP_PASSWORD");
  requireVar("APP_SESSION_SECRET");
  requireVar("SUPABASE_SERVICE_ROLE_KEY");
  requireVar("NEXT_PUBLIC_SUPABASE_URL", () => {
    try {
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string);
      return null;
    } catch {
      return "not a valid URL";
    }
  });

  // Encryption keyring: at least one valid 32-byte key must resolve. activeKeyId
  // parses/validates the whole keyring and throws with a specific reason.
  {
    let ok = true;
    let detail: string | undefined;
    try {
      activeKeyId();
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? e.message : "invalid encryption key config";
    }
    checks.push({
      name: "CREDENTIALS_ENCRYPTION_KEY",
      ok,
      required: true,
      detail,
    });
  }

  // Recommended (warn only — absence doesn't fail health).
  {
    const ok = present("APP_BASE_URL");
    checks.push({
      name: "APP_BASE_URL",
      ok,
      required: false,
      detail: ok
        ? undefined
        : "unset — defaults to http://localhost:3000; OAuth redirect_uri will be wrong in production",
    });
  }

  const ok = checks.filter((c) => c.required).every((c) => c.ok);
  return { ok, checks };
}

/** Throw with an aggregated message if any *required* env var is missing/invalid. */
export function assertEnv(): void {
  const { ok, checks } = checkEnv();
  if (!ok) {
    const bad = checks
      .filter((c) => c.required && !c.ok)
      .map((c) => `${c.name} (${c.detail || "invalid"})`);
    throw new Error(`Environment misconfiguration: ${bad.join("; ")}`);
  }
}
