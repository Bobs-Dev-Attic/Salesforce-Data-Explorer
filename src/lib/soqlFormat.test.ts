import { describe, it, expect } from "vitest";
import { formatSoql } from "./soqlFormat";

describe("formatSoql", () => {
  it("reflows a one-line query into canonical multi-line", () => {
    const out = formatSoql(
      "SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 100"
    );
    expect(out).toBe(
      [
        "SELECT",
        "    Id,",
        "    Name",
        "FROM Account",
        "ORDER BY CreatedDate DESC",
        "LIMIT 100",
      ].join("\n")
    );
  });

  it("uppercases clause keywords and breaks top-level AND/OR in WHERE", () => {
    const out = formatSoql(
      "select id,name from account where industry='Banking' and annualrevenue>100 order by name"
    );
    expect(out).toBe(
      [
        "SELECT",
        "    id,",
        "    name",
        "FROM account",
        "WHERE industry='Banking'",
        "    AND annualrevenue>100",
        "ORDER BY name",
      ].join("\n")
    );
  });

  it("keeps a single-field SELECT on one line", () => {
    expect(formatSoql("SELECT Id FROM Account")).toBe(
      "SELECT Id\nFROM Account"
    );
  });

  it("does not split commas or clauses inside a subquery", () => {
    const out = formatSoql(
      "SELECT Id, (SELECT LastName, FirstName FROM Contacts) FROM Account"
    );
    expect(out).toBe(
      [
        "SELECT",
        "    Id,",
        "    (SELECT LastName, FirstName FROM Contacts)",
        "FROM Account",
      ].join("\n")
    );
  });

  it("preserves string literals verbatim (incl. keywords/commas inside)", () => {
    const out = formatSoql(
      "SELECT Id FROM Account WHERE Name = 'A, B and C from X'"
    );
    expect(out).toBe(
      ["SELECT Id", "FROM Account", "WHERE Name = 'A, B and C from X'"].join(
        "\n"
      )
    );
  });

  it("collapses messy whitespace and is idempotent", () => {
    const messy = "SELECT   Id,\n\n  Name\tFROM   Account   WHERE  Id != null";
    const once = formatSoql(messy);
    expect(once).toBe(
      ["SELECT", "    Id,", "    Name", "FROM Account", "WHERE Id != null"].join(
        "\n"
      )
    );
    expect(formatSoql(once)).toBe(once); // running again is stable
  });

  it("returns non-SELECT input as a tidy single line, unharmed", () => {
    expect(formatSoql("  count()  ")).toBe("count()");
  });

  it("handles an empty string", () => {
    expect(formatSoql("   ")).toBe("");
  });

  it("does not treat a field like FromDate as a FROM clause", () => {
    const out = formatSoql("SELECT FromDate__c FROM Event");
    expect(out).toBe("SELECT FromDate__c\nFROM Event");
  });
});
