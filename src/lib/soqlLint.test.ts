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
  "accountnumber",
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

  it("suggests the nearest field for a typo, with a replace fix", () => {
    const d = lintSoql("SELECT Naem FROM Account", {
      objects,
      fields: accountFields,
      fieldList: ["Id", "Name", "Industry", "CreatedDate"],
    });
    const f = d.find((x) => x.message.startsWith("Unknown field 'Naem'"))!;
    expect(f.message).toContain("did you mean 'Name'?");
    expect(f.fix).toEqual({
      start: 7,
      end: 11,
      replacement: "Name",
      label: "Use 'Name'",
    });
  });
});

describe("missing comma", () => {
  const meta = { objects, fields: accountFields };

  it("flags two adjacent SELECT fields and offers an insert-comma fix", () => {
    const text = "SELECT Id, Name AccountNumber FROM Account";
    const d = lintSoql(text, meta);
    const mc = d.find((x) => x.message.startsWith("Missing comma"))!;
    expect(mc).toBeTruthy();
    expect(mc.severity).toBe("error");
    expect(mc.message).toBe("Missing comma before 'AccountNumber'?");
    // Applying the fix yields valid field separation.
    const fixed =
      text.slice(0, mc.fix!.start) + mc.fix!.replacement + text.slice(mc.fix!.end);
    expect(fixed).toBe("SELECT Id, Name, AccountNumber FROM Account");
  });

  it("does not flag a correct comma-separated list", () => {
    expect(
      messages("SELECT Id, Name, AccountNumber FROM Account", meta)
    ).toEqual([]);
  });

  it("does not flag aggregate aliasing (legal)", () => {
    expect(
      messages("SELECT COUNT(Id) total FROM Account GROUP BY Industry", meta)
    ).toEqual([]);
  });

  it("does not flag a relationship field on its own", () => {
    expect(messages("SELECT Account.Name FROM Contact", { objects })).toEqual(
      []
    );
  });

  it("does not flag the second field while it is under the caret", () => {
    const text = "SELECT Id, Name Acc";
    expect(messages(text, meta, text.length)).toEqual([]);
  });
});
