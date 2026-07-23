import { describe, it, expect } from "vitest";
import { friendlyError } from "./sfError";

describe("friendlyError", () => {
  it("extracts the real message from a SOQL INVALID_FIELD error", () => {
    const raw = JSON.stringify([
      {
        message:
          "\nSELECT Id, Foo FROM Account\n            ^\nERROR at Row:1:Column:12\nNo such column 'Foo' on entity 'Account'.",
        errorCode: "INVALID_FIELD",
      },
    ]);
    const fe = friendlyError(raw);
    expect(fe.title).toBe("No such column 'Foo' on entity 'Account'.");
    expect(fe.code).toBe("INVALID_FIELD");
    expect(fe.hint).toMatch(/field-level security/);
    expect(fe.detail).toBe(raw);
  });

  it("maps a MALFORMED_QUERY code to a syntax hint", () => {
    const raw = JSON.stringify([
      { message: "unexpected token: FROM", errorCode: "MALFORMED_QUERY" },
    ]);
    const fe = friendlyError(raw);
    expect(fe.title).toBe("unexpected token: FROM");
    expect(fe.code).toBe("MALFORMED_QUERY");
    expect(fe.hint).toMatch(/syntax/);
  });

  it("handles an OAuth invalid_grant object", () => {
    const fe = friendlyError({
      error: "invalid_grant",
      error_description: "expired access/refresh token",
    });
    expect(fe.code).toBe("invalid_grant");
    expect(fe.title).toBe("expired access/refresh token");
    expect(fe.hint).toMatch(/reconnect the org/);
  });

  it("falls back to the hint when there's a code but no message", () => {
    const fe = friendlyError(
      JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }])
    );
    expect(fe.code).toBe("INVALID_SESSION_ID");
    expect(fe.title).toMatch(/session expired/);
    expect(fe.hint).toBeUndefined(); // hint became the title, not duplicated
  });

  it("passes through a plain non-JSON string", () => {
    const fe = friendlyError("Network error");
    expect(fe.title).toBe("Network error");
    expect(fe.code).toBeUndefined();
    expect(fe.hint).toBeUndefined();
  });

  it("keeps malformed JSON as the title", () => {
    const fe = friendlyError("{not valid json");
    expect(fe.title).toBe("{not valid json");
  });

  it("gives a generic title when nothing usable is present", () => {
    const fe = friendlyError(JSON.stringify([{}]));
    expect(fe.title).toBe("The request failed.");
  });
});
