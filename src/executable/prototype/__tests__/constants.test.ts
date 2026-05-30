// src/executable/prototype/__tests__/constants.test.ts
import { describe, expect, test } from "bun:test";
import { BUILTIN_PROTO_PREFIX, builtinProtoId, canonicalObjectId } from "../constants";
import type { StoneObjectRef } from "../../../persistable";

describe("constants", () => {
  test("BUILTIN_PROTO_PREFIX is the _builtin objects URI prefix", () => {
    expect(BUILTIN_PROTO_PREFIX).toBe("ooc://stones/_builtin/objects/");
  });

  test("builtinProtoId composes the builtin URI", () => {
    expect(builtinProtoId("search")).toBe("ooc://stones/_builtin/objects/search");
  });

  test("canonicalObjectId for a _builtin ref uses builtin prefix", () => {
    const ref: StoneObjectRef = { baseDir: "/x", objectId: "root", stonesBranch: "_builtin" };
    expect(canonicalObjectId(ref)).toBe("ooc://stones/_builtin/objects/root");
  });

  test("canonicalObjectId for a branch ref uses branch URI", () => {
    const ref: StoneObjectRef = { baseDir: "/x", objectId: "supervisor", stonesBranch: "ooc-4" };
    expect(canonicalObjectId(ref)).toBe("ooc://stones/ooc-4/objects/supervisor");
  });

  test("canonicalObjectId defaults missing branch to main", () => {
    const ref: StoneObjectRef = { baseDir: "/x", objectId: "a" };
    expect(canonicalObjectId(ref)).toBe("ooc://stones/main/objects/a");
  });
});
