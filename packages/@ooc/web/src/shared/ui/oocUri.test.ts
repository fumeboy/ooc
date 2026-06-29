import { describe, expect, it } from "bun:test";
import { parseOocUri, isOocUri } from "./oocUri";

describe("parseOocUri", () => {
  it("maps flow page form to SPA route", () => {
    expect(
      parseOocUri("ooc://client/flows/s_xyz/alan/pages/report-2026"),
    ).toBe("/flows/s_xyz/alan/pages/report-2026");
  });

  it("maps stone form to /stones route", () => {
    expect(parseOocUri("ooc://client/stones/user")).toBe("/stones/user");
  });

  it("tolerates trailing slash on stone form", () => {
    expect(parseOocUri("ooc://client/stones/user/")).toBe("/stones/user");
  });

  it("re-encodes segments containing special chars", () => {
    expect(
      parseOocUri("ooc://client/flows/s 1/a b/pages/p c"),
    ).toBe("/flows/s%201/a%20b/pages/p%20c");
  });

  it("returns null for unknown ooc client shape (wrong arity)", () => {
    expect(parseOocUri("ooc://client/flows/s_xyz/alan")).toBeNull();
  });

  it("returns null for non-client ooc scheme", () => {
    expect(parseOocUri("ooc://world/stones/user")).toBeNull();
    expect(parseOocUri("ooc://server/flows/s/a/pages/p")).toBeNull();
  });

  it("returns null for wrong flow keywords", () => {
    expect(
      parseOocUri("ooc://client/flows/s/objs/a/pages/p"),
    ).toBeNull();
  });

  it("returns null for empty segments", () => {
    expect(parseOocUri("ooc://client/stones/")).toBeNull();
    expect(parseOocUri("ooc://client/")).toBeNull();
  });

  it("returns null for plain https links", () => {
    expect(parseOocUri("https://example.com/flows/x")).toBeNull();
  });

  it("returns null for malformed percent-encoding", () => {
    expect(parseOocUri("ooc://client/stones/%E0%A4%A")).toBeNull();
  });

  it("returns null for non-string input", () => {
    // @ts-expect-error testing runtime guard
    expect(parseOocUri(null)).toBeNull();
  });
});

describe("isOocUri", () => {
  it("true for recognizable client uri", () => {
    expect(isOocUri("ooc://client/stones/user")).toBe(true);
  });
  it("false otherwise", () => {
    expect(isOocUri("ooc://world/x")).toBe(false);
    expect(isOocUri("just text")).toBe(false);
  });
});
