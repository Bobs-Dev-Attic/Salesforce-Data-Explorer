import { describe, it, expect } from "vitest";
import { levenshtein, nearest, distanceBudget } from "./fuzzy";

describe("levenshtein", () => {
  it("is 0 for equal strings", () => {
    expect(levenshtein("Name", "Name")).toBe(0);
  });
  it("counts single edits", () => {
    expect(levenshtein("Naem", "Name")).toBe(2); // transposition = 2 edits
    expect(levenshtein("Name", "Names")).toBe(1);
    expect(levenshtein("Name", "Nam")).toBe(1);
  });
  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("nearest", () => {
  const fields = ["Id", "Name", "CreatedDate", "AccountNumber", "Industry"];
  it("finds a close match", () => {
    expect(nearest("Naem", fields)).toBe("Name");
    expect(nearest("CreatedDat", fields)).toBe("CreatedDate");
  });
  it("returns null when nothing is close enough", () => {
    expect(nearest("Zzzzzz", fields, 2)).toBeNull();
  });
  it("ignores exact matches (not a typo) and finds no other near field", () => {
    // "Name" matches exactly (ignored); nothing else is within 2 edits.
    expect(nearest("Name", fields, 2)).toBeNull();
  });
  it("respects the distance budget", () => {
    expect(nearest("Nam", fields, 1)).toBe("Name");
    expect(nearest("Xam", fields, 1)).toBeNull(); // 2 edits from Name
  });
});

describe("distanceBudget", () => {
  it("scales with length", () => {
    expect(distanceBudget("Id")).toBe(1);
    expect(distanceBudget("Name")).toBe(1);
    expect(distanceBudget("Industry")).toBe(2);
    expect(distanceBudget("AccountNumber")).toBe(3);
  });
});
