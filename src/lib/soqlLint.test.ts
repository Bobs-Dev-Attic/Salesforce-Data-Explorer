import { describe, it, expect } from "vitest";
import { lintSoql } from "./soqlLint";

const objects = new Set(["account", "contact", "opportunity"]);
const accountFields = new Set([
  "id",
  "name",
  "industry",
  "createddate",
  "ownerid",
  "annualrevenue",
]);

function messages(text: string, meta = {}, caret = -1) {
  return lintSoql(text, meta, caret).map((d) => d.message);
}

describe("structural lint", () => {
  it("flags an unterminated string literal", () => {
    const d = lintSoql("SELECT Id FROM Account WHERE Name = 'abc");
    expect(d.some((x) => x.message === "Unterminated string literal")).toBe(
      true
    );
    expect(d[0].severity).toBe("error");
  });

  it("flags an unmatched opening paren", () => {
    const d = lintSoql("SELECT Id FROM Account WHERE (Name = 'x'");
    expect(d.some((x) => x.message === "Unmatched '('")).toBe(true);
  });

  it("flags an unmatched closing paren", () => {
    const d = lintSoql("SELECT Id FROM Account WHERE Name = 'x')");
    expect(d.some((x) => x.message === "Unmatched ')'")).toBe(true);
  });

  it("accepts balanced parens and closed strings", () => {
    const d = lintSoql(
      "SELECT Id FROM Account WHERE (Name = 'x' AND Industry = 'y')"
    );
    expect(d).toEqual([]);
  });

  it("does not count parens inside string literals", () => {
    const d = lintSoql("SELECT Id FROM Account WHERE Name = '((('");
    expect(d).toEqual([]);
  });

  it("reports 1-based line/col for the diagnostic", () => {
    const d = lintSoql("SELECT Id\nFROM Account\nWHERE Name = 'oops");
    const unterm = d.find((x) => x.message === "Unterminated string literal")!;
    expect(unterm.line).toBe(3);
    expect(unterm.col).toBe(14);
  });
});

describe("unknown object", () => {
  it("flags an object not in the known set", () => {
    const d = lintSoql("SELECT Id FROM Acount", { objects });
    expect(d.some((x) => x.message === "Unknown object 'Acount'")).toBe(true);
  });

  it("accepts a known object (case-insensitive)", () => {
    expect(messages("SELECT Id FROM account", { objects })).toEqual([]);
  });

  it("does not flag while the object token is under the caret", () => {
    // caret at end of "Acc" — still typing
    const text = "SELECT Id FROM Acc";
    expect(messages(text, { objects }, text.length)).toEqual([]);
  });

  it("stays silent when the object set is not loaded", () => {
    expect(messages("SELECT Id FROM Zzz", {})).toEqual([]);
  });
});

describe("unknown fields", () => {
  const meta = { objects, fields: accountFields };

  it("flags an unknown field in SELECT", () => {
    const d = lintSoql("SELECT Naem FROM Account", meta);
    expect(d.some((x) => x.message === "Unknown field 'Naem'")).toBe(true);
    expect(d.find((x) => x.message === "Unknown field 'Naem'")!.severity).toBe(
      "warning"
    );
  });

  it("accepts known fields across clauses", () => {
    expect(
      messages(
        "SELECT Id, Name FROM Account WHERE Industry = 'x' ORDER BY CreatedDate",
        meta
      )
    ).toEqual([]);
  });

  it("does not flag relationship paths", () => {
    expect(
      messages("SELECT Account.Name FROM Contact", {
        objects,
        fields: new Set(["id"]),
      })
    ).toEqual([]);
  });

  it("does not flag function calls or their known args", () => {
    expect(messages("SELECT COUNT(Id) FROM Account", meta)).toEqual([]);
  });

  it("does not flag aggregate aliases after a paren", () => {
    // "total" follows ) — treated as an alias, not a field
    expect(
      messages("SELECT COUNT(Id) total FROM Account GROUP BY Industry", meta)
    ).toEqual([]);
  });

  it("skips date-literal keywords in WHERE", () => {
    expect(
      messages(
        "SELECT Id FROM Account WHERE CreatedDate = LAST_N_DAYS:30",
        meta
      )
    ).toEqual([]);
  });

  it("bails on subqueries (can't validate a child object's fields)", () => {
    expect(
      messages(
        "SELECT Id, (SELECT LastName FROM Contacts) FROM Account",
        meta
      )
    ).toEqual([]);
  });

  it("does not flag the field currently under the caret", () => {
    const text = "SELECT Nam FROM Account";
    const caret = "SELECT Nam".length;
    expect(messages(text, meta, caret)).toEqual([]);
  });

  it("stays silent when the field set is not loaded", () => {
    expect(messages("SELECT Whatever FROM Account", { objects })).toEqual([]);
  });
});
