import { describe, it, expect } from "vitest";
import {
  nextWidth,
  totalWidth,
  MIN_COL_WIDTH,
  DEFAULT_COL_WIDTH,
} from "./useColumnWidths";

describe("nextWidth", () => {
  it("adds the drag delta to the starting width", () => {
    expect(nextWidth(160, 40)).toBe(200);
    expect(nextWidth(160, -30)).toBe(130);
  });
  it("floors at the minimum width", () => {
    expect(nextWidth(80, -100)).toBe(MIN_COL_WIDTH);
    expect(nextWidth(100, -100, 50)).toBe(50);
  });
  it("rounds sub-pixel deltas", () => {
    expect(nextWidth(100, 10.6)).toBe(111);
  });
});

describe("totalWidth", () => {
  it("sums explicit widths and falls back to the default", () => {
    const cols = ["Id", "Name", "Industry"];
    expect(totalWidth(cols, { Id: 80, Name: 200 })).toBe(
      80 + 200 + DEFAULT_COL_WIDTH
    );
  });
  it("uses a custom default", () => {
    expect(totalWidth(["A", "B"], {}, 100)).toBe(200);
  });
  it("is 0 for no columns", () => {
    expect(totalWidth([], { A: 100 })).toBe(0);
  });
});
