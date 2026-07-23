"use client";

import { useState } from "react";
import { friendlyError, type FriendlyError } from "@/lib/sfError";

/**
 * Renders a raw error as a friendly notice: a readable headline, an optional
 * hint, the error code as a tag, and a "copy details" affordance that copies
 * the full raw payload (so precision isn't lost).
 */
export default function ErrorNotice({
  error,
  className = "",
}: {
  error: string | FriendlyError;
  className?: string;
}) {
  const fe: FriendlyError =
    typeof error === "string" ? friendlyError(error) : error;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fe.detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const showDetails = fe.detail && fe.detail.trim() !== fe.title.trim();

  return (
    <div className={`alert error error-notice ${className}`} role="alert">
      <div className="error-notice-head">
        <span className="error-notice-title">{fe.title}</span>
        {fe.code && <span className="error-code">{fe.code}</span>}
      </div>
      {fe.hint && <div className="error-notice-hint">{fe.hint}</div>}
      {showDetails && (
        <div className="error-notice-actions">
          <button type="button" className="linkbtn" onClick={copy}>
            {copied ? "Copied ✓" : "Copy details"}
          </button>
          <details>
            <summary>Show raw error</summary>
            <pre className="error-notice-raw">{fe.detail}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
