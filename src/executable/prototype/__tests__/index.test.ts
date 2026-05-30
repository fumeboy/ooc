// src/executable/prototype/__tests__/index.test.ts
import { describe, expect, test } from "bun:test";
import * as proto from "../index";

describe("prototype barrel", () => {
  test("re-exports all public symbols", () => {
    expect(typeof proto.BUILTIN_PROTO_PREFIX).toBe("string");
    expect(typeof proto.builtinProtoId).toBe("function");
    expect(typeof proto.canonicalObjectId).toBe("function");
    expect(typeof proto.parseSelfMeta).toBe("function");
    expect(typeof proto.normalizeExtends).toBe("function");
    expect(typeof proto.loadObjectRecord).toBe("function");
    expect(typeof proto.buildObjectRegistry).toBe("function");
    expect(typeof proto.resolveAlongChain).toBe("function");
  });
});
