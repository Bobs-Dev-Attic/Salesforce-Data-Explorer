"use client";

import { useEffect, useState } from "react";

/**
 * App-wide loading indicator. Wraps window.fetch once to count in-flight
 * requests and shows a thin animated bar at the top of the screen (plus a small
 * "Working…" pill) whenever any request is active — so the UI never looks hung.
 */

let active = 0;
const listeners = new Set<(n: number) => void>();
function emit() {
  for (const l of listeners) l(active);
}

let patched = false;
function patchFetch() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    active++;
    emit();
    try {
      return await orig(...args);
    } finally {
      active = Math.max(0, active - 1);
      emit();
    }
  };
}

export default function GlobalProgress() {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    patchFetch();
    const l = (n: number) => setCount(n);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (count > 0) {
      setVisible(true);
      return;
    }
    // Keep the finishing animation briefly, then hide.
    const t = setTimeout(() => setVisible(false), 350);
    return () => clearTimeout(t);
  }, [count]);

  return (
    <>
      <div className={`global-progress${visible ? " on" : ""}`}>
        <div className="global-progress-bar" />
      </div>
      {visible && (
        <div className="working-pill" role="status" aria-live="polite">
          <span className="working-dot" /> Working…
        </div>
      )}
    </>
  );
}
