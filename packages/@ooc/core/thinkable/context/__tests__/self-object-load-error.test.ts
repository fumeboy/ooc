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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSelfObjectTypeRegistered } from "../object-windows.js";
import { makeThread } from "../../../__tests__/make-thread";
import { createObjectRegistry } from "@ooc/core/runtime/object-registry.js";
import { clearServerLoaderCache } from "../../../runtime/server-loader.js";
import {
  createStoneObject,
  writeExecutableSource,
  stoneDir,
} from "../../../persistable";

// Wave4：class 装配入口 = stone 根 index.ts（`export const Class`），loader 真实 import 它。
// 「broken executable」复刻 = 写一段 import 不存在模块的根 index.ts → load 抛错。
async function writeBrokenStoneClass(baseDir: string, objectId: string, code: string): Promise<void> {
  await writeFile(join(stoneDir({ baseDir, objectId }), "index.ts"), code, "utf8");
}

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

  // Wave4：RegisteredClass.readable 是 ReadableModule（readable(ctx,self,win) → ReadableProjection）。
  // 渲染期投影 self 窗的 context = { object:{id,class}, thread }。
  async function projectReadable(
    def: NonNullable<ReturnType<ReturnType<typeof createObjectRegistry>["getClass"]>>,
    objectId: string,
    thread: ReturnType<typeof makeSelfThread>,
  ): Promise<string> {
    const projection = await def.readable!.readable(
      { object: { id: objectId, class: objectId }, thread },
      {},
      undefined,
    );
    return JSON.stringify(projection.content);
  }

  it("(a) object with NO executable → empty methods, no error readable", async () => {
    // 纯 self.md/readable.md 对象，无 executable/index.ts。
    await createStoneObject({ baseDir, objectId: "agent_plain" });

    const registry = createObjectRegistry();
    const thread = makeSelfThread("agent_plain");

    await ensureSelfObjectTypeRegistered(thread, registry);

    expect(registry.has("agent_plain")).toBe(true);
    const def = registry.getClass("agent_plain")!;
    expect(def.executable?.methods ?? []).toEqual([]);
    // 关键：没有把 load error 当成「无方法」—— 不应注入 error readable。
    expect(def.readable).toBeUndefined();
  });

  it("(b) object with BROKEN executable → loud/visible error, NOT silently-empty", async () => {
    await createStoneObject({ baseDir, objectId: "sentry_factor" });
    // 复刻事故：根 index.ts（class 装配入口）import 不存在的模块 → load 抛 "Cannot find module ..."。
    await writeBrokenStoneClass(
      baseDir,
      "sentry_factor",
      `import { nope } from "@ooc/core/this-module-does-not-exist";\n` +
        `export const Class = { executable: { methods: [nope] } };\n`,
    );
    // executable/index.ts 存在 = fail-loud 探测信号「磁盘上确有 executable 源」（区分「根本无 executable」）。
    await writeExecutableSource({ baseDir, objectId: "sentry_factor" }, `export const x = 1;\n`);

    const registry = createObjectRegistry();
    const thread = makeSelfThread("sentry_factor");

    await ensureSelfObjectTypeRegistered(thread, registry);

    expect(registry.has("sentry_factor")).toBe(true);
    const def = registry.getClass("sentry_factor")!;
    // 仍是空 methods（load 失败拿不到方法），但区别在于：
    expect(def.executable?.methods ?? []).toEqual([]);
    // fail-loud：必须注入可见的 error readable，让 agent 在 context 里看到方法库没装上。
    expect(def.readable).toBeDefined();

    const serialized = await projectReadable(def, "sentry_factor", thread);
    expect(serialized).toContain("executable_load_error");
    // 错误原文要可见（agent 才知道该修什么）。
    expect(serialized).toContain("加载失败");
    // 显式反编造指引。
    expect(serialized).toContain("不要");
  });

  it("(c) 空占位注册不毒化单例：源码后来可见时重新加载（修 Issue#2）", async () => {
    // 复刻毒化态：前一次 render 在源码瞬时不可见时（如对象未提交 stone 仓 / worktree 未就绪）
    // load miss → register(selfId, {}) 注册了**空占位**（无 executable/readable/parentClass）。
    const registry = createObjectRegistry();
    registry.register("rec_recover", {});
    expect(registry.has("rec_recover")).toBe(true);

    // 此刻源码已就绪：stone 带合法 index.ts（export const Class，含一条 object method）。
    await createStoneObject({ baseDir, objectId: "rec_recover" });
    await writeBrokenStoneClass(
      baseDir,
      "rec_recover",
      `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";\n` +
        `export const Class: OocClass = { executable: { methods: [\n` +
        `  { name: "DoThing", description: "do a thing", exec: () => "ok" },\n` +
        `] } };\n`,
    );

    const thread = makeSelfThread("rec_recover");
    await ensureSelfObjectTypeRegistered(thread, registry);

    // 旧实现：has()==true → 幂等守卫跳过 → 永远停在空占位（毒化）。
    // 修复后：空占位不算实质注册 → 重新加载 → 方法注册上。
    const def = registry.getClass("rec_recover")!;
    expect((def.executable?.methods ?? []).map((m) => m.name)).toContain("DoThing");
  });

  it("(b') broken executable error readable carries the underlying load message", async () => {
    await createStoneObject({ baseDir, objectId: "sentry_factor2" });
    await writeBrokenStoneClass(
      baseDir,
      "sentry_factor2",
      `import "@ooc/core/definitely-missing-xyz";\nexport const Class = { executable: { methods: [] } };\n`,
    );
    await writeExecutableSource({ baseDir, objectId: "sentry_factor2" }, `export const x = 1;\n`);

    const registry = createObjectRegistry();
    const thread = makeSelfThread("sentry_factor2");

    await ensureSelfObjectTypeRegistered(thread, registry);

    const def = registry.getClass("sentry_factor2")!;
    expect(def.readable).toBeDefined();
    const serialized = await projectReadable(def, "sentry_factor2", thread);
    // 底层 import 失败原文（module 名）必须透出到 context。
    expect(serialized).toMatch(/Cannot find module|definitely-missing-xyz/);
  });
});
