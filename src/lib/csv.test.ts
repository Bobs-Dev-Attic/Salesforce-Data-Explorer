import { describe, it, expect } from "vitest";
import {
  csvCell,
  csvHeader,
  csvRow,
  toCsv,
  parseCsv,
  rawCsvRecords,
  splitCsvIntoChunks,
} from "./csv";

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

describe("parseCsv", () => {
  it("parses a simple document", () => {
    const { headers, rows } = parseCsv("Id,Name\r\n1,Acme\r\n2,Globex");
    expect(headers).toEqual(["Id", "Name"]);
    expect(rows).toEqual([
      ["1", "Acme"],
      ["2", "Globex"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const { headers, rows } = parseCsv(
      'Id,Name\n1,"Acme, Inc."\n2,"He said ""hi"""'
    );
    expect(headers).toEqual(["Id", "Name"]);
    expect(rows[0]).toEqual(["1", "Acme, Inc."]);
    expect(rows[1]).toEqual(["2", 'He said "hi"']);
  });

  it("handles newlines inside quoted fields", () => {
    const { rows } = parseCsv('Id,Note\n1,"line1\nline2"');
    expect(rows[0]).toEqual(["1", "line1\nline2"]);
  });

  it("ignores blank trailing lines and handles no trailing newline", () => {
    const { headers, rows } = parseCsv("A,B\nx,y\n\n");
    expect(headers).toEqual(["A", "B"]);
    expect(rows).toEqual([["x", "y"]]);
  });

  it("round-trips with toCsv for plain data", () => {
    const cols = ["Id", "Name"];
    const data = [
      { Id: "1", Name: "Acme, Inc." },
      { Id: "2", Name: 'Quote"' },
    ];
    const { headers, rows } = parseCsv(toCsv(data, cols));
    expect(headers).toEqual(cols);
    expect(rows).toEqual([
      ["1", "Acme, Inc."],
      ["2", 'Quote"'],
    ]);
  });
});

describe("rawCsvRecords", () => {
  it("splits on unquoted newlines and keeps quoted newlines intact", () => {
    const { header, records } = rawCsvRecords(
      'Id,Note\n1,"line1\nline2"\r\n2,plain'
    );
    expect(header).toBe("Id,Note");
    expect(records).toEqual(['1,"line1\nline2"', "2,plain"]);
  });
});

describe("splitCsvIntoChunks", () => {
  it("returns a single chunk when under the limit", () => {
    const csv = "Id,Name\n1,A\n2,B";
    expect(splitCsvIntoChunks(csv, 1_000)).toEqual([csv]);
  });

  it("repeats the header on each chunk and never splits a record", () => {
    const csv = "Id,Name\n1,AAAA\n2,BBBB\n3,CCCC";
    // Header "Id,Name\n" = 8 bytes; each row "N,XXXX\n" = 7 bytes.
    // Limit 18 → header(8) + one row(7)=15 fits, + second row would be 22 > 18.
    const chunks = splitCsvIntoChunks(csv, 18);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.startsWith("Id,Name\n")).toBe(true);
    // Reassembling the data rows across chunks preserves all rows in order.
    const rows = chunks.flatMap((c) => c.split("\n").slice(1));
    expect(rows).toEqual(["1,AAAA", "2,BBBB", "3,CCCC"]);
  });

  it("gives an over-size single record its own chunk", () => {
    const csv = "Id,Name\n1,short\n2,thisisaverylongvalue";
    const chunks = splitCsvIntoChunks(csv, 16);
    expect(chunks.length).toBe(2);
    expect(chunks[1]).toContain("thisisaverylongvalue");
  });
});

describe("csvHeader / csvRow (streaming helpers)", () => {
  it("serializes a header row", () => {
    expect(csvHeader(["Id", "Name"])).toBe("Id,Name");
  });

  it("serializes a single row against a fixed column order", () => {
    expect(csvRow({ Id: "1", Name: "Acme" }, ["Id", "Name"])).toBe("1,Acme");
  });

  it("fills missing columns and escapes as needed", () => {
    expect(csvRow({ Id: "1", Name: "=EVIL" }, ["Id", "Name", "X"])).toBe(
      "1,'=EVIL,"
    );
  });

  it("header+rows joined by CRLF reproduce toCsv", () => {
    const cols = ["Id", "Name"];
    const rows = [{ Id: "1", Name: "Acme" }];
    const streamed = [csvHeader(cols), ...rows.map((r) => csvRow(r, cols))].join(
      "\r\n"
    );
    expect(streamed).toBe(toCsv(rows, cols));
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
