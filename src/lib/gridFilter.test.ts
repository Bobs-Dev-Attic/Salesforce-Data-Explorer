import { describe, it, expect } from "vitest";
import {
  compareValues,
  distinctValues,
  applyGridView,
  type ValueFilters,
} from "./gridFilter";

const rows = [
  { Name: "Beta", Amount: "100", Stage: "Won" },
  { Name: "alpha", Amount: "20", Stage: "Lost" },
  { Name: "Gamma", Amount: "9", Stage: "Won" },
  { Name: "delta", Amount: "", Stage: "" },
];

describe("compareValues", () => {
  it("orders numeric strings numerically, not lexically", () => {
    expect(compareValues("9", "100")).toBeLessThan(0);
    expect(compareValues("100", "20")).toBeGreaterThan(0);
  });

  it("sorts numbers ahead of text and blanks as text", () => {
    expect(compareValues("9", "abc")).toBeLessThan(0);
    expect(compareValues("abc", "9")).toBeGreaterThan(0);
    expect(compareValues("", "abc")).toBeLessThan(0); // "" < "abc"
  });
});

describe("distinctValues", () => {
  it("dedupes, normalizes blanks to '', and sorts", () => {
    expect(distinctValues(rows, "Stage")).toEqual(["", "Lost", "Won"]);
    // numbers sort ahead of text, so a blank ("") lands last here.
    expect(distinctValues(rows, "Amount")).toEqual(["9", "20", "100", ""]);
  });

  it("treats a missing key as blank", () => {
    expect(distinctValues([{ Name: "x" }], "Missing")).toEqual([""]);
  });
});

describe("applyGridView", () => {
  const cols = ["Name", "Amount", "Stage"];

  it("returns the same reference when nothing is active", () => {
    expect(applyGridView(rows, cols, {}, null)).toBe(rows);
  });

  it("keeps only rows whose value is checked", () => {
    const filters: ValueFilters = { Stage: ["Won"] };
    const out = applyGridView(rows, cols, filters, null);
    expect(out.map((r) => r.Name)).toEqual(["Beta", "Gamma"]);
  });

  it("filters blank cells via the '' token", () => {
    const out = applyGridView(rows, cols, { Stage: [""] }, null);
    expect(out.map((r) => r.Name)).toEqual(["delta"]);
  });

  it("ANDs multiple column filters", () => {
    const out = applyGridView(
      rows,
      cols,
      { Stage: ["Won"], Amount: ["9"] },
      null
    );
    expect(out.map((r) => r.Name)).toEqual(["Gamma"]);
  });

  it("ignores filters for columns not currently shown", () => {
    const out = applyGridView(rows, cols, { Ghost: ["x"] }, null);
    expect(out).toBe(rows);
  });

  it("sorts ascending and descending without mutating input", () => {
    const asc = applyGridView(rows, cols, {}, { col: "Amount", dir: "asc" });
    expect(asc.map((r) => r.Amount)).toEqual(["9", "20", "100", ""]);
    const desc = applyGridView(rows, cols, {}, { col: "Amount", dir: "desc" });
    expect(desc.map((r) => r.Amount)).toEqual(["", "100", "20", "9"]);
    expect(rows[0].Name).toBe("Beta"); // original order intact
  });

  it("filters then sorts", () => {
    const out = applyGridView(
      rows,
      cols,
      { Stage: ["Won"] },
      { col: "Amount", dir: "desc" }
    );
    expect(out.map((r) => r.Name)).toEqual(["Beta", "Gamma"]);
  });
});
