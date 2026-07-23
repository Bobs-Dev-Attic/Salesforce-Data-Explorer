/**
 * Turn a raw Salesforce/API error into a human-friendly notice. Server routes
 * surface Salesforce responses verbatim (often a JSON string), which is precise
 * but unreadable. `friendlyError` extracts the useful message, adds a hint for
 * common error codes, and always preserves the raw text for "copy details".
 */

export interface FriendlyError {
  /** Short, human-readable headline. */
  title: string;
  /** Optional actionable hint based on the error code. */
  hint?: string;
  /** Salesforce error code / OAuth error, when present. */
  code?: string;
  /** The full raw error text, for a copy-details affordance. */
  detail: string;
}

const CODE_HINTS: Record<string, string> = {
  INVALID_FIELD: "Check the field API name and your field-level security (FLS).",
  INVALID_TYPE: "The object doesn't exist or you don't have access to it.",
  MALFORMED_QUERY: "There's a syntax error in the SOQL.",
  INVALID_SESSION_ID: "Your Salesforce session expired — reconnect the org.",
  INVALID_QUERY_LOCATOR: "The query cursor expired — re-run the query.",
  INSUFFICIENT_ACCESS: "You don't have permission for this operation.",
  INSUFFICIENT_ACCESS_OR_READONLY:
    "You don't have permission, or the field/record is read-only.",
  REQUIRED_FIELD_MISSING: "A required field is missing from the request.",
  DUPLICATE_VALUE: "A duplicate value violates a unique constraint.",
  ENTITY_IS_DELETED: "That record has been deleted.",
  NOT_FOUND: "The requested resource was not found.",
  UNABLE_TO_LOCK_ROW: "A record was locked by another process — try again.",
  QUERY_TIMEOUT: "The query timed out — narrow it with filters or a LIMIT.",
  REQUEST_LIMIT_EXCEEDED:
    "Salesforce API request limit exceeded — wait and retry.",
};

const OAUTH_HINTS: Record<string, string> = {
  invalid_grant:
    "The connection's authorization is no longer valid — reconnect the org.",
  invalid_client:
    "The Connected App credentials are wrong — check the consumer key/secret.",
  inactive_user: "The connected Salesforce user is inactive.",
  invalid_client_id: "The Connected App consumer key is wrong.",
};

/** Pick the most informative line from a (possibly multi-line) SF message. */
function cleanMessage(msg: string): string {
  const lines = msg
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines[0] || msg.trim();
  // SOQL errors echo the query + a caret + "ERROR at Row:col" + the real message.
  const errIdx = lines.findIndex((l) => /^ERROR at Row:/i.test(l));
  if (errIdx >= 0 && lines[errIdx + 1]) return lines[errIdx + 1];
  // Otherwise the last line is usually the actual message.
  return lines[lines.length - 1];
}

function tryParse(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

export function friendlyError(raw: unknown): FriendlyError {
  const detail =
    typeof raw === "string"
      ? raw
      : (() => {
          try {
            return JSON.stringify(raw);
          } catch {
            return String(raw);
          }
        })();

  let code: string | undefined;
  let message: string | undefined;

  const parsed = typeof raw === "string" ? tryParse(raw) : raw;

  if (Array.isArray(parsed) && parsed.length) {
    const e = parsed[0] as { errorCode?: unknown; message?: unknown };
    if (typeof e?.errorCode === "string") code = e.errorCode;
    if (typeof e?.message === "string") message = e.message;
  } else if (parsed && typeof parsed === "object") {
    const e = parsed as {
      error?: unknown;
      error_description?: unknown;
      errorCode?: unknown;
      message?: unknown;
    };
    if (typeof e.error === "string") {
      // OAuth token error shape: { error, error_description }
      code = e.error;
      if (typeof e.error_description === "string") message = e.error_description;
    } else {
      if (typeof e.errorCode === "string") code = e.errorCode;
      if (typeof e.message === "string") message = e.message;
    }
  }

  const hint = code ? CODE_HINTS[code] || OAUTH_HINTS[code] : undefined;

  let title: string;
  if (message && message.trim()) {
    title = cleanMessage(message);
  } else if (hint) {
    title = hint;
  } else if (
    typeof raw === "string" &&
    raw.trim() &&
    parsed === undefined // a plain, non-JSON string
  ) {
    title = cleanMessage(raw);
  } else {
    title = "The request failed.";
  }

  return {
    title,
    hint: hint && hint !== title ? hint : undefined,
    code,
    detail,
  };
}
