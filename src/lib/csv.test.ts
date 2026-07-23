import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values untouched", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell("123")).toBe("123");
  });

  it("quotes and escapes values with commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes formula-injection prefixes", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("quotes a dangerous value that also contains a comma", () => {
    // Prefixed with ' first, then RFC-4180 quoted because of the comma.
    expect(csvCell("=HYPERLINK(x),y")).toBe(`"'=HYPERLINK(x),y"`);
  });

  it("does not prefix a safe value that merely contains = later", () => {
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("toCsv", () => {
  it("emits a header row and CRLF-delimited data rows", () => {
    const csv = toCsv(
      [
        { Id: "1", Name: "Acme" },
        { Id: "2", Name: "Globex" },
      ],
      ["Id", "Name"]
    );
    expect(csv).toBe("Id,Name\r\n1,Acme\r\n2,Globex");
  });

  it("fills missing columns with empty strings", () => {
    const csv = toCsv([{ Id: "1" }], ["Id", "Name"]);
    expect(csv).toBe("Id,Name\r\n1,");
  });
});
