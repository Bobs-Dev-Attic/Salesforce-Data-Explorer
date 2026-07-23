"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Theme = "dark" | "light";

/** Top-bar overflow menu: theme toggle + Connections + Lock. */
export default function AppMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
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
