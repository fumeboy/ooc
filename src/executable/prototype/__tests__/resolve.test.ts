// src/executable/prototype/__tests__/resolve.test.ts
import { describe, expect, test } from "bun:test";
import { buildObjectRegistry } from "../registry";
import { resolveAlongChain } from "../resolve";
import type { ObjectRecord } from "../object-record";

function rec(id: string, ext: string | null, has: Partial<ObjectRecord["has"]> = {}): ObjectRecord {
  return {
    id,
    extends: ext,
    ref: { baseDir: "/x", objectId: id, stonesBranch: "main" },
    has: { executable: false, readable: false, visible: false, ...has },
  };
}

describe("resolveAlongChain", () => {
  const reg = buildObjectRegistry([
    rec("root", null, { executable: true, readable: true, visible: true }),
    rec("mid", "root", { readable: true }),
    rec("leaf", "mid", { executable: true }),
  ]);

  test("own hit returns the start record", () => {
    const r = resolveAlongChain(reg, "leaf", (rec) => (rec.has.executable ? rec.id : undefined));
    expect(r?.record.id).toBe("leaf");
    expect(r?.value).toBe("leaf");
  });

  test("ancestor hit walks up the chain", () => {
    // leaf 无 readable → mid 有 readable
    const r = resolveAlongChain(reg, "leaf", (rec) => (rec.has.readable ? rec.id : undefined));
    expect(r?.record.id).toBe("mid");
  });

  test("root fallback when only root provides the slot", () => {
    // leaf/mid 都无 visible → root 兜底
    const r = resolveAlongChain(reg, "leaf", (rec) => (rec.has.visible ? rec.id : undefined));
    expect(r?.record.id).toBe("root");
  });

  test("miss all the way → undefined", () => {
    const r = resolveAlongChain(reg, "leaf", () => undefined);
    expect(r).toBeUndefined();
  });

  test("throws when startId not in registry", () => {
    expect(() => resolveAlongChain(reg, "ghost", () => "x")).toThrow(/ghost|not.*registr|不在/i);
  });

  test("same walk serves three different probes (method/visible/readable share)", () => {
    const methodProbe = (rec: ObjectRecord) => (rec.has.executable ? rec.id : undefined);
    const visibleProbe = (rec: ObjectRecord) => (rec.has.visible ? rec.id : undefined);
    const readableProbe = (rec: ObjectRecord) => (rec.has.readable ? rec.id : undefined);
    expect(resolveAlongChain(reg, "leaf", methodProbe)?.record.id).toBe("leaf");
    expect(resolveAlongChain(reg, "leaf", visibleProbe)?.record.id).toBe("root");
    expect(resolveAlongChain(reg, "leaf", readableProbe)?.record.id).toBe("mid");
  });
});
