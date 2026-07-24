"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS: [string, string][] = [
  ["/", "Home"],
  ["/explorer", "Explorer"],
  ["/query", "SOQL"],
  ["/objects", "Objects"],
  ["/schema", "Schema"],
  ["/bulk", "Bulk"],
];

/**
 * Primary section links. On wide screens they render inline; on narrow screens
 * they collapse behind a hamburger toggle (a dropdown panel under the top bar),
 * so the nav no longer overflows the viewport on mobile.
 */
export default function PrimaryNav() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the mobile menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div className="primary-nav" ref={ref}>
      <button
        type="button"
        className="nav-toggle"
        aria-label="Navigation menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ☰
      </button>
      <div className={`nav-links${open ? " open" : ""}`}>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}>
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
