import { describe, it, expect } from "vitest";
import { colLetter, cellRef } from "./colLetter";

describe("colLetter", () => {
  it("maps single letters", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(1)).toBe("B");
    expect(colLetter(25)).toBe("Z");
  });
  it("rolls over to two letters", () => {
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(27)).toBe("AB");
    expect(colLetter(51)).toBe("AZ");
    expect(colLetter(52)).toBe("BA");
    expect(colLetter(701)).toBe("ZZ");
  });
  it("rolls over to three letters", () => {
    expect(colLetter(702)).toBe("AAA");
  });
  it("guards bad input", () => {
    expect(colLetter(-1)).toBe("");
    expect(colLetter(NaN)).toBe("");
  });
});

describe("cellRef", () => {
  it("builds A1-style references", () => {
    expect(cellRef(0, 1)).toBe("A1");
    expect(cellRef(2, 3)).toBe("C3");
    expect(cellRef(26, 10)).toBe("AA10");
  });
});
