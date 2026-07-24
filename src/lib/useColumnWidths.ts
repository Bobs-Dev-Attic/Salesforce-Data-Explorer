"use client";

import { useCallback, useRef, useState } from "react";
import { readPersisted, writePersisted } from "./usePersistentState";

export const MIN_COL_WIDTH = 60;
export const DEFAULT_COL_WIDTH = 160;

export type ColWidths = Record<string, number>;

/** New width from a drag: startWidth + delta, floored at `min`, rounded. */
export function nextWidth(
  startWidth: number,
  deltaX: number,
  min = MIN_COL_WIDTH
): number {
  return Math.max(min, Math.round(startWidth + deltaX));
}

/** Sum the widths of `columns`, using `def` for any not explicitly set. */
export function totalWidth(
  columns: string[],
  widths: ColWidths,
  def = DEFAULT_COL_WIDTH
): number {
  return columns.reduce((sum, c) => sum + (widths[c] ?? def), 0);
}

export interface ColumnWidthApi {
  widths: ColWidths;
  widthOf: (col: string) => number;
  total: (columns: string[]) => number;
  /** Begin a pointer-drag resize of `col`. */
  startResize: (col: string, e: React.PointerEvent) => void;
  /** Replace all widths (e.g. restoring from a saved query). */
  setWidths: (w: ColWidths) => void;
  /** Clear all custom widths back to defaults. */
  reset: () => void;
  defaultWidth: number;
}

/**
 * Per-column pixel widths with drag-to-resize, persisted to localStorage.
 * Widths are keyed by column name so they survive changing column subsets and
 * order. Pair with `table-layout: fixed` + a `<colgroup>` (see `.rz-table`).
 */
export function useColumnWidths(
  storageKey: string,
  opts?: { defaultWidth?: number }
): ColumnWidthApi {
  const def = opts?.defaultWidth ?? DEFAULT_COL_WIDTH;
  const [widths, setWidthsState] = useState<ColWidths>(
    () => readPersisted<ColWidths>(storageKey) ?? {}
  );
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const setWidths = useCallback(
    (w: ColWidths) => {
      setWidthsState(w);
      writePersisted(storageKey, w);
    },
    [storageKey]
  );

  const startResize = useCallback(
    (col: string, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const baseline = widthsRef.current[col] ?? def;
      const onMove = (ev: PointerEvent) => {
        setWidthsState((cur) => ({
          ...cur,
          [col]: nextWidth(baseline, ev.clientX - startX),
        }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("col-resizing");
        writePersisted(storageKey, widthsRef.current);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.classList.add("col-resizing");
    },
    [def, storageKey]
  );

  const reset = useCallback(() => setWidths({}), [setWidths]);
  const widthOf = useCallback((c: string) => widths[c] ?? def, [widths, def]);
  const total = useCallback(
    (cols: string[]) => totalWidth(cols, widths, def),
    [widths, def]
  );

  return { widths, widthOf, total, startResize, setWidths, reset, defaultWidth: def };
}
