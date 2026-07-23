import { RefObject, useEffect, useState } from "react";

export interface VirtualWindow {
  /** First row index to render (inclusive). */
  start: number;
  /** Last row index to render (exclusive). */
  end: number;
  /** Spacer height above the rendered rows, in px. */
  padTop: number;
  /** Spacer height below the rendered rows, in px. */
  padBottom: number;
  /** False when the list is small enough to render in full. */
  enabled: boolean;
}

/**
 * Windowing for large result grids: instead of rendering every row to the DOM
 * (sluggish past a couple thousand), render only the rows near the viewport
 * plus an overscan, and pad the scroll height with spacer rows above/below.
 *
 * Relies on a uniform `rowHeight` — valid here because result-table cells are
 * `white-space: nowrap` (fixed height). Below `threshold` rows it disables
 * itself and the caller renders the list normally.
 */
export function useVirtualRows(
  scrollRef: RefObject<HTMLElement>,
  rowCount: number,
  rowHeight: number,
  opts: { overscan?: number; threshold?: number } = {}
): VirtualWindow {
  const overscan = opts.overscan ?? 12;
  const threshold = opts.threshold ?? 150;
  const enabled = rowCount > threshold;
  // Start with a small window so the first paint of a large list doesn't render
  // every row before the scroll effect narrows it.
  const [range, setRange] = useState(() => ({
    start: 0,
    end: enabled ? Math.min(rowCount, 60) : rowCount,
  }));

  useEffect(() => {
    if (!enabled) {
      setRange({ start: 0, end: rowCount });
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const scrollTop = el.scrollTop;
      const viewport = el.clientHeight || 400;
      const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
      const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
      setRange({ start, end: Math.min(rowCount, start + visible) });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled, rowCount, rowHeight, overscan, scrollRef]);

  if (!enabled) {
    return { start: 0, end: rowCount, padTop: 0, padBottom: 0, enabled: false };
  }
  const start = Math.max(0, Math.min(range.start, rowCount));
  const end = Math.min(range.end, rowCount);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (rowCount - end) * rowHeight),
    enabled: true,
  };
}
