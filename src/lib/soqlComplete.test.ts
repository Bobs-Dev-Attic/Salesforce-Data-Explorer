import { describe, it, expect } from "vitest";
import {
  analyzeSoql,
  rankSuggestions,
  fieldSuggestions,
  objectSuggestions,
  resolveRelationship,
  picklistSuggestions,
  keywordSuggestions,
  fromObjectOf,
  type FieldMeta,
} from "./soqlComplete";

// Helper: put the caret at the "|" marker in a template string.
function at(src: string): { text: string; caret: number } {
  const caret = src.indexOf("|");
  return { text: src.replace("|", ""), caret };
}

describe("fromObjectOf", () => {
  it("extracts the FROM object", () => {
    expect(fromObjectOf("SELECT Id FROM Account WHERE x = 1")).toBe("Account");
    expect(fromObjectOf("SELECT Id FROM My_Object__c")).toBe("My_Object__c");
    expect(fromObjectOf("SELECT Id")).toBeNull();
  });
});

describe("analyzeSoql — object context", () => {
  it("suggests objects right after FROM", () => {
    const { text, caret } = at("SELECT Id FROM Acc|");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("object");
    expect(ctx.token).toBe("Acc");
    expect(text.slice(ctx.tokenStart, caret)).toBe("Acc");
  });

  it("treats an empty FROM operand as object context", () => {
    const { text, caret } = at("SELECT Id FROM |");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("object");
    expect(ctx.token).toBe("");
  });
});

describe("analyzeSoql — field context", () => {
  it("suggests fields inside SELECT once FROM is known", () => {
    const { text, caret } = at("SELECT Nam| FROM Account");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("field");
    expect(ctx.token).toBe("Nam");
    expect(ctx.fromObject).toBe("Account");
  });

  it("suggests fields in WHERE", () => {
    const { text, caret } = at("SELECT Id FROM Account WHERE Ind|");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("field");
    expect(ctx.token).toBe("Ind");
  });

  it("suggests fields in ORDER BY", () => {
    const { text, caret } = at("SELECT Id FROM Account ORDER BY Crea|");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("field");
  });
});

describe("analyzeSoql — relationship traversal", () => {
  it("detects a dotted token and captures the path", () => {
    const { text, caret } = at("SELECT Account.Nam| FROM Contact");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("relationship");
    expect(ctx.relationshipPath).toEqual(["Account"]);
    expect(ctx.token).toBe("Nam");
    expect(text.slice(ctx.tokenStart, caret)).toBe("Nam");
  });
});

describe("analyzeSoql — picklist", () => {
  it("detects picklist context inside a quoted equality", () => {
    const { text, caret } = at(
      "SELECT Id FROM Account WHERE Industry = 'Ban|"
    );
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("picklist");
    expect(ctx.fieldForPicklist).toBe("Industry");
    expect(ctx.token).toBe("Ban");
  });

  it("detects picklist context inside an IN list", () => {
    const { text, caret } = at(
      "SELECT Id FROM Account WHERE StageName IN ('|"
    );
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("picklist");
    expect(ctx.fieldForPicklist).toBe("StageName");
  });
});

describe("analyzeSoql — keyword & null", () => {
  it("offers keywords between clauses", () => {
    const { text, caret } = at("SELECT Id FROM Account W|");
    const ctx = analyzeSoql(text, caret)!;
    expect(ctx.kind).toBe("keyword");
    expect(ctx.token).toBe("W");
  });

  it("returns null on empty whitespace with no context", () => {
    const { text, caret } = at("SELECT Id FROM Account |");
    expect(analyzeSoql(text, caret)).toBeNull();
  });
});

describe("rankSuggestions", () => {
  const cands = [
    { value: "Name" },
    { value: "AccountName", label: "AccountName" },
    { value: "LastName" },
    { value: "Id" },
  ];
  it("prefers prefix matches, then substring, alpha within tier", () => {
    const r = rankSuggestions(cands, "name").map((s) => s.value);
    expect(r[0]).toBe("Name"); // prefix on value
    // substring matches follow, alphabetical
    expect(r).toContain("AccountName");
    expect(r).toContain("LastName");
    expect(r).not.toContain("Id");
  });

  it("returns all (alpha) for an empty token", () => {
    const r = rankSuggestions(cands, "");
    expect(r.length).toBe(4);
  });

  it("respects the limit", () => {
    expect(rankSuggestions(cands, "", 2).length).toBe(2);
  });
});

describe("resolveRelationship", () => {
  const fields: FieldMeta[] = [
    {
      name: "AccountId",
      label: "Account ID",
      relationshipName: "Account",
      referenceTo: ["Account"],
    },
    { name: "Name", label: "Name" },
  ];
  it("maps a relationshipName to its target object", () => {
    expect(resolveRelationship(fields, "account")).toBe("Account");
  });
  it("returns null for an unknown relationship", () => {
    expect(resolveRelationship(fields, "Owner")).toBeNull();
  });
});

describe("picklistSuggestions", () => {
  const field: FieldMeta = {
    name: "Industry",
    label: "Industry",
    picklistValues: [
      { value: "Banking", label: "Banking" },
      { value: "Retail" },
      { value: "Old", active: false },
    ],
  };
  it("returns active picklist values, filtered by token", () => {
    const r = picklistSuggestions(field, "ret").map((s) => s.value);
    expect(r).toEqual(["Retail"]);
  });
  it("omits inactive values", () => {
    const r = picklistSuggestions(field, "").map((s) => s.value);
    expect(r).not.toContain("Old");
    expect(r).toContain("Banking");
  });
  it("returns nothing for a non-picklist field", () => {
    expect(picklistSuggestions({ name: "X", label: "X" }, "")).toEqual([]);
  });
});

describe("fieldSuggestions & objectSuggestions & keywordSuggestions", () => {
  it("builds field suggestions with detail", () => {
    const r = fieldSuggestions(
      [{ name: "Name", label: "Full Name", type: "string" }],
      "na"
    );
    expect(r[0].value).toBe("Name");
    expect(r[0].detail).toContain("string");
  });
  it("builds object suggestions", () => {
    const r = objectSuggestions([{ name: "Account", label: "Account" }], "acc");
    expect(r[0].value).toBe("Account");
  });
  it("builds keyword suggestions", () => {
    const r = keywordSuggestions("sel").map((s) => s.value);
    expect(r).toContain("SELECT");
  });
});
