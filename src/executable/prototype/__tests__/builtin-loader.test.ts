// src/executable/prototype/__tests__/builtin-loader.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuiltinObjects } from "../../../app/server/bootstrap/ensure-builtin-objects";
import { loadBuiltinRegistry } from "../builtin-loader";
import { builtinProtoId } from "../constants";
import { resolveAlongChain } from "../resolve";

let tempRoot: string | undefined;
afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("loadBuiltinRegistry", () => {
  test("scans the 8 materialized prototypes into a registry", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const reg = await loadBuiltinRegistry(tempRoot);
    expect(reg.ids().length).toBe(8);
    expect(reg.has(builtinProtoId("root"))).toBe(true);
    expect(reg.has(builtinProtoId("program"))).toBe(true);
  });

  test("root is chain terminus; non-root protos extend root", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const reg = await loadBuiltinRegistry(tempRoot);
    expect(reg.get(builtinProtoId("root"))?.extends).toBeNull();
    expect(reg.get(builtinProtoId("search"))?.extends).toBe(builtinProtoId("root"));
  });

  test("readable resolves up the chain to root for a non-root proto (L2+L3)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await ensureBuiltinObjects({ baseDir: tempRoot });
    const reg = await loadBuiltinRegistry(tempRoot);
    // program 自身 readable 空 → 沿 extends 兜底到 root（root.has.readable=true）
    const hit = resolveAlongChain(reg, builtinProtoId("program"), (rec) =>
      rec.has.readable ? rec.id : undefined,
    );
    expect(hit?.record.id).toBe(builtinProtoId("root"));
  });

  test("throws when _builtin dir is absent (ensureBuiltinObjects not run)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-blreg-"));
    await expect(loadBuiltinRegistry(tempRoot)).rejects.toThrow(/_builtin|不存在/i);
  });
});
