// src/executable/prototype/__tests__/registry.test.ts
import { describe, expect, test } from "bun:test";
import { buildObjectRegistry } from "../registry";
import type { ObjectRecord } from "../object-record";

function rec(id: string, ext: string | null): ObjectRecord {
  return {
    id,
    extends: ext,
    dir: `/x/${id}`,
    has: { executable: false, readable: false, visible: false },
  };
}

describe("buildObjectRegistry", () => {
  test("builds and resolves get/has", () => {
    const reg = buildObjectRegistry([rec("root", null), rec("a", "root")]);
    expect(reg.has("a")).toBe(true);
    expect(reg.get("a")?.extends).toBe("root");
    expect(reg.get("missing")).toBeUndefined();
  });

  test("rejects duplicate id", () => {
    expect(() => buildObjectRegistry([rec("a", "root"), rec("a", "root"), rec("root", null)]))
      .toThrow(/duplicate|重复/i);
  });

  test("rejects dangling extends (parent not present)", () => {
    expect(() => buildObjectRegistry([rec("a", "ghost")]))
      .toThrow(/dangling|不存在|ghost/i);
  });

  test("rejects self cycle (a → a)", () => {
    expect(() => buildObjectRegistry([rec("a", "a")]))
      .toThrow(/cycle|环/i);
  });

  test("rejects 2-node cycle (a → b → a)", () => {
    expect(() => buildObjectRegistry([rec("a", "b"), rec("b", "a")]))
      .toThrow(/cycle|环/i);
  });

  test("rejects longer cycle (a → b → c → a)", () => {
    expect(() => buildObjectRegistry([rec("a", "b"), rec("b", "c"), rec("c", "a")]))
      .toThrow(/cycle|环/i);
  });

  test("accepts valid DAG with shared ancestor", () => {
    const reg = buildObjectRegistry([
      rec("root", null),
      rec("a", "root"),
      rec("b", "a"),
      rec("c", "a"),
    ]);
    expect(reg.has("b")).toBe(true);
    expect(reg.has("c")).toBe(true);
  });

  test("registry snapshot is immutable", () => {
    const reg = buildObjectRegistry([rec("root", null)]);
    // get 返回的 record 不应能 mutate registry 内部状态
    const r = reg.get("root")!;
    expect(() => { (r as { id: string }).id = "hacked"; }).toThrow();
  });
});
