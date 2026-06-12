/**
 * ensureSelfObjectTypeRegistered fail-loud 回归测试。
 *
 * 事故复盘：一个 self 对象的 executable/index.ts import 了不存在的模块，load 抛错。
 * 旧实现一律 console.debug + 注空 methods —— code load 失败与「根本没有 executable」无法区分，
 * agent 以为方法不存在而编造数据（silent-swallow ban 违例）。
 *
 * 修复后两条路径必须分流：
 *  (a) 无 executable/index.ts → 空 methods、安静（合法纯 self.md/readable.md 对象）。
 *  (b) 有 executable/index.ts 但 load 失败 → 不静默：注入显著 readable error，agent 在 context 看得见。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSelfObjectTypeRegistered } from "../object-windows.js";
import { makeThread } from "../../../__tests__/make-thread";
import { createObjectRegistry } from "../../../executable/windows/_shared/registry.js";
import { clearServerLoaderCache } from "../../../runtime/server-loader.js";
import {
  createStoneObject,
  writeExecutableSource,
} from "../../../persistable";

describe("ensureSelfObjectTypeRegistered fail-loud on broken executable", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-self-load-"));
    clearServerLoaderCache();
  });

  afterEach(async () => {
    clearServerLoaderCache();
    await rm(baseDir, { recursive: true, force: true });
  });

  function makeSelfThread(objectId: string) {
    return makeThread({
      id: "t_root",
      objectId,
      persistence: { baseDir, sessionId: "sess_1", objectId, threadId: "t_root" },
      skipCreatorWindow: true,
    });
  }

  it("(a) object with NO executable → empty methods, no error readable", async () => {
    // 纯 self.md/readable.md 对象，无 executable/index.ts。
    await createStoneObject({ baseDir, objectId: "agent_plain" });

    const registry = createObjectRegistry();
    const thread = makeSelfThread("agent_plain");

    await ensureSelfObjectTypeRegistered(thread, registry);

    expect(registry.has("agent_plain")).toBe(true);
    const def = registry.getObjectDefinition("agent_plain");
    expect(Object.keys(def.methods ?? {})).toEqual([]);
    // 关键：没有把 load error 当成「无方法」—— 不应注入 error readable。
    expect(def.readable).toBeUndefined();
  });

  it("(b) object with BROKEN executable → loud/visible error, NOT silently-empty", async () => {
    await createStoneObject({ baseDir, objectId: "sentry_factor" });
    // 复刻事故：import 不存在的模块 → load 抛 "Cannot find module ..."。
    await writeExecutableSource(
      { baseDir, objectId: "sentry_factor" },
      `import { nope } from "@ooc/core/this-module-does-not-exist";\n` +
        `export const window = { methods: { groupSearch: nope } };\n`,
    );

    const registry = createObjectRegistry();
    const thread = makeSelfThread("sentry_factor");

    await ensureSelfObjectTypeRegistered(thread, registry);

    expect(registry.has("sentry_factor")).toBe(true);
    const def = registry.getObjectDefinition("sentry_factor");
    // 仍是空 methods（load 失败拿不到方法），但区别在于：
    expect(Object.keys(def.methods ?? {})).toEqual([]);
    // fail-loud：必须注入可见的 error readable，让 agent 在 context 里看到方法库没装上。
    expect(def.readable).toBeDefined();

    const nodes = await def.readable!({ thread, window: { id: "sentry_factor", class: "sentry_factor" } as any });
    const serialized = JSON.stringify(nodes);
    expect(serialized).toContain("executable_load_error");
    // 错误原文要可见（agent 才知道该修什么）。
    expect(serialized).toContain("加载失败");
    // 显式反编造指引。
    expect(serialized).toContain("不要");
  });

  it("(b') broken executable error readable carries the underlying load message", async () => {
    await createStoneObject({ baseDir, objectId: "sentry_factor2" });
    await writeExecutableSource(
      { baseDir, objectId: "sentry_factor2" },
      `import "@ooc/core/definitely-missing-xyz";\nexport const window = { methods: {} };\n`,
    );

    const registry = createObjectRegistry();
    const thread = makeSelfThread("sentry_factor2");

    await ensureSelfObjectTypeRegistered(thread, registry);

    const def = registry.getObjectDefinition("sentry_factor2");
    expect(def.readable).toBeDefined();
    const nodes = await def.readable!({ thread, window: { id: "sentry_factor2", class: "sentry_factor2" } as any });
    const serialized = JSON.stringify(nodes);
    // 底层 import 失败原文（module 名）必须透出到 context。
    expect(serialized).toMatch(/Cannot find module|definitely-missing-xyz/);
  });
});
