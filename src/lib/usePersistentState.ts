"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useState backed by localStorage. State survives navigation, logout, and
 * session timeout (localStorage is independent of the app session cookie).
 *
 * To avoid clobbering stored values before they're read (and to avoid SSR
 * hydration mismatches), the initial value is used for the first render and the
 * stored value is loaded in an effect on mount.
 */
export function usePersistentState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setState(JSON.parse(raw) as T);
    } catch {
      /* ignore malformed/blocked storage */
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore quota/blocked storage */
    }
  }, [key, state]);

  return [state, setState];
}

/** Read a persisted value once (no subscription). Returns null if absent. */
export function readPersisted<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Write a persisted value imperatively. */
export function writePersisted(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
