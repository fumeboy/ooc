import { describe, expect, test } from "bun:test";
import { loadBuiltinRegistry } from "../index";
import { builtinProtoId, resolveAlongChain } from "../../../executable/prototype";

describe("loadBuiltinRegistry (src/extendable/base)", () => {
  test("scans the 8 source prototypes into a registry", async () => {
    const reg = await loadBuiltinRegistry();
    expect(reg.ids().length).toBe(8);
    for (const p of ["root", "program", "search", "file", "knowledge", "command_exec", "skill_index", "custom"]) {
      expect(reg.has(builtinProtoId(p))).toBe(true);
    }
  });

  test("root is chain terminus; non-root protos extend root", async () => {
    const reg = await loadBuiltinRegistry();
    expect(reg.get(builtinProtoId("root"))?.extends).toBeNull();
    expect(reg.get(builtinProtoId("search"))?.extends).toBe(builtinProtoId("root"));
    expect(reg.get(builtinProtoId("custom"))?.extends).toBe(builtinProtoId("root"));
  });

  test("readable resolves up the chain to root for a proto without its own readable (L2+L3)", async () => {
    const reg = await loadBuiltinRegistry();
    // command_exec 无自己的 readable.md → 沿 extends 兜底到 root（root.has.readable=true）
    const hit = resolveAlongChain(reg, builtinProtoId("command_exec"), (rec) =>
      rec.has.readable ? rec.id : undefined,
    );
    expect(hit?.record.id).toBe(builtinProtoId("root"));
  });

  test("L4.2 transcribed protos own their in-character readable.md (no fallback to root)", async () => {
    const reg = await loadBuiltinRegistry();
    // program/search/file/knowledge L4.2 转写后带 in-character readable.md → resolve 命中自身
    for (const p of ["program", "search", "file", "knowledge"]) {
      const hit = resolveAlongChain(reg, builtinProtoId(p), (rec) =>
        rec.has.readable ? rec.id : undefined,
      );
      expect(hit?.record.id).toBe(builtinProtoId(p));
    }
  });

  test("record.dir points at the source proto directory", async () => {
    const reg = await loadBuiltinRegistry();
    expect(reg.get(builtinProtoId("root"))?.dir).toContain("extendable/base/root");
  });
});
