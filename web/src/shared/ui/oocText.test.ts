import { describe, expect, it } from "bun:test";
import { splitOocText, hasOocUri } from "./oocText";

describe("splitOocText", () => {
  it("returns single text segment when no ooc uri", () => {
    expect(splitOocText("just plain text")).toEqual([
      { kind: "text", text: "just plain text" },
    ]);
  });

  it("splits a bare flow uri out of surrounding text", () => {
    const r = splitOocText(
      "see ooc://client/flows/s1/objects/alan/pages/report now",
    );
    expect(r).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "ooc",
        uri: "ooc://client/flows/s1/objects/alan/pages/report",
        route: "/flows/s1/objects/alan/pages/report",
      },
      { kind: "text", text: " now" },
    ]);
  });

  it("splits a bare stone uri", () => {
    const r = splitOocText("open ooc://client/stones/user");
    expect(r).toEqual([
      { kind: "text", text: "open " },
      {
        kind: "ooc",
        uri: "ooc://client/stones/user",
        route: "/stones/user",
      },
    ]);
  });

  it("does not consume trailing punctuation into the uri", () => {
    const r = splitOocText("go ooc://client/stones/user.");
    expect(r).toEqual([
      { kind: "text", text: "go " },
      { kind: "ooc", uri: "ooc://client/stones/user", route: "/stones/user" },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps unrecognized ooc uri as plain text", () => {
    const r = splitOocText("nope ooc://client/flows/x/objects/y here");
    expect(r).toEqual([
      { kind: "text", text: "nope ooc://client/flows/x/objects/y here" },
    ]);
  });

  it("leaves https links untouched", () => {
    expect(splitOocText("visit https://example.com ok")).toEqual([
      { kind: "text", text: "visit https://example.com ok" },
    ]);
  });

  it("handles multiple uris", () => {
    const r = splitOocText(
      "a ooc://client/stones/user b ooc://client/stones/alan c",
    );
    expect(r).toEqual([
      { kind: "text", text: "a " },
      { kind: "ooc", uri: "ooc://client/stones/user", route: "/stones/user" },
      { kind: "text", text: " b " },
      { kind: "ooc", uri: "ooc://client/stones/alan", route: "/stones/alan" },
      { kind: "text", text: " c" },
    ]);
  });
});

describe("hasOocUri", () => {
  it("true when a recognizable bare uri exists", () => {
    expect(hasOocUri("x ooc://client/stones/user y")).toBe(true);
  });
  it("false for unrecognized ooc text", () => {
    expect(hasOocUri("ooc://client/flows/x here")).toBe(false);
  });
  it("false for plain text", () => {
    expect(hasOocUri("plain")).toBe(false);
  });
});
