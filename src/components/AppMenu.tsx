"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Theme = "dark" | "light";

/** Top-bar overflow menu: theme toggle + Connections + Lock. */
export default function AppMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [rekeying, setRekeying] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t =
      (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
    setTheme(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function applyTheme(t: Theme) {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("sfde.theme", t);
    } catch {
      /* ignore */
    }
  }

  async function rekey() {
    if (
      !confirm(
        "Re-encrypt all stored secrets under the active encryption key? Run this after rotating CREDENTIALS_ENCRYPTION_ACTIVE_KEY_ID. Safe to run anytime."
      )
    )
      return;
    setRekeying(true);
    try {
      const res = await fetch("/api/admin/rekey", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Re-key failed");
        return;
      }
      alert(
        `Re-encrypted under key "${data.activeKeyId}".\n` +
          `Connected apps: ${data.apps.rekeyed}/${data.apps.total} rewritten.\n` +
          `Connections: ${data.connections.rekeyed}/${data.connections.total} rewritten.`
      );
      setOpen(false);
    } catch {
      alert("Re-key failed (network error)");
    } finally {
      setRekeying(false);
    }
  }

  async function signOutAll() {
    if (
      !confirm(
        "Sign out ALL sessions on every device? This immediately invalidates every active session (including this one) and you'll need to unlock again."
      )
    )
      return;
    setRevoking(true);
    try {
      const res = await fetch("/api/app-auth/revoke-all", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to sign out sessions");
        return;
      }
      window.location.href = "/login";
    } catch {
      alert("Failed to sign out sessions (network error)");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="appmenu" ref={ref}>
      <button
        className="linkbtn appmenu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        aria-haspopup="true"
        aria-expanded={open}
      >
        ☰
      </button>
      {open && (
        <div className="appmenu-panel" role="menu">
          <div className="appmenu-theme">
            <span className="appmenu-label">Theme</span>
            <div className="seg">
              <button
                className={theme === "dark" ? "on" : ""}
                onClick={() => applyTheme("dark")}
              >
                🌙 Dark
              </button>
              <button
                className={theme === "light" ? "on" : ""}
                onClick={() => applyTheme("light")}
              >
                ☀️ Light
              </button>
            </div>
          </div>
          <Link
            href="/connections"
            className="appmenu-item"
            onClick={() => setOpen(false)}
          >
            Connections
          </Link>
          <button
            type="button"
            className="appmenu-item as-btn"
            onClick={rekey}
            disabled={rekeying}
          >
            {rekeying ? "Re-encrypting…" : "Re-encrypt secrets"}
          </button>
          <button
            type="button"
            className="appmenu-item as-btn"
            onClick={signOutAll}
            disabled={revoking}
          >
            {revoking ? "Signing out…" : "Sign out all sessions"}
          </button>
          <form action="/api/app-auth/logout" method="post">
            <button type="submit" className="appmenu-item as-btn">
              Lock
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
