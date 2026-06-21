/**
 * resolveProjection 投影测试。
 *
 * - self 门面窗（agent 实例，`win.isSelfWindow`，inst.class=_builtin/agent）→ 经 agent
 *   persistable.load 把 self.md hydrate 进 `data.self`，再由 agent readable 渲出身份正文。
 *   renderer 不再直接 readSelf（对象模型核心 9：self.md 只属 agent 实例，读取经 registry 派发）。
 * - peer 视角（无自定义 readable module 的普通对象，别人看它）→ 默认投影读盘 readable.md。
 * - 身份皆空 → 空 context window `<window class="<inst.class>" id="..."/>`（无 placeholder 文案）。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@ooc/core/runtime/register-builtins.js";
import { resolveProjection } from "../xml.js";
import { createObjectRegistry } from "@ooc/core/runtime/object-registry.js";
import { createStoneObject, stoneDir } from "@ooc/core/persistable";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader.js";
import { makeThread } from "../../../../__tests__/make-thread";
import { setSessionObject } from "@ooc/core/runtime/session-object-table.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";

describe("resolveProjection 默认投影视角分流", () => {
  let baseDir: string;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-resolve-proj-"));
    clearServerLoaderCache();
  });
  afterEach(async () => {
    clearServerLoaderCache();
    await rm(baseDir, { recursive: true, force: true });
  });

  // 构造 context window（OocObjectRef，不持 data）+ 把其引用对象的 data 登记进 thread 的
  // session 对象表（resolveProjection 经表解析 data）。
  const instOf = (
    thread: ThreadContext,
    id: string,
    overrides: Partial<Omit<OocObjectRef, "class">> & { class?: string; data?: unknown } = {},
  ): OocObjectRef => {
    const { class: cls, data, ...rest } = overrides;
    const klass = cls ?? id;
    setSessionObject(thread, { id, class: klass, data: data ?? {} });
    return {
      id,
      class: klass,
      title: id,
      status: "open",
      createdAt: 0,
      ...rest,
    };
  };

  /** thread 的 self objectId = viewer（决定 self/peer 视角）。 */
  const threadViewedBy = (viewer: string) =>
    makeThread({
      objectId: viewer,
      persistence: { baseDir, sessionId: "s1", objectId: viewer, threadId: "t" },
      skipCreatorWindow: true,
    });

  it("self 门面窗（agent 实例）→ persistable.load hydrate self.md → agent readable 渲身份", async () => {
    await createStoneObject({ baseDir, objectId: "obj_a" });
    await writeFile(join(stoneDir({ baseDir, objectId: "obj_a" }), "self.md"), "我是 obj_a 的 self 身份", "utf8");

    // self 门面窗：inst.class=_builtin/agent（resolveReadable/resolvePersistable 命中 agent 模块），
    // win.isSelfWindow + data 空 → resolveProjection 经 persistable.load 读盘 hydrate data.self，
    // 再由 agent readable 渲出身份正文。
    const thread = threadViewedBy("obj_a");
    const selfWin = instOf(thread, "obj_a", { class: "_builtin/agent", win: { isSelfWindow: true } as never });
    const proj = await resolveProjection(selfWin, thread, createObjectRegistry(), {
      baseDir,
      sessionId: "s1",
    });
    expect(JSON.stringify(proj.content)).toContain("我是 obj_a 的 self 身份");
  });

  it("peer 视角（别人看它）→ 渲 readable.md 内容", async () => {
    await createStoneObject({ baseDir, objectId: "obj_a" });
    await writeFile(join(stoneDir({ baseDir, objectId: "obj_a" }), "self.md"), "obj_a 的 self", "utf8");
    await writeFile(join(stoneDir({ baseDir, objectId: "obj_a" }), "readable.md"), "obj_a 面向他人的描述", "utf8");

    // 视角者是 obj_b，投影 obj_a → peer 视角 → readable.md，不是 self.md
    const thread = threadViewedBy("obj_b");
    const proj = await resolveProjection(instOf(thread, "obj_a"), thread, createObjectRegistry(), {
      baseDir,
      sessionId: "s1",
    });
    expect(JSON.stringify(proj.content)).toContain("obj_a 面向他人的描述");
    expect(JSON.stringify(proj.content)).not.toContain("obj_a 的 self");
  });

  it("self.md / readable.md 皆空 → 空 context window，无 placeholder 文案", async () => {
    await createStoneObject({ baseDir, objectId: "obj_c" }); // self.md/readable.md 空

    const thread = threadViewedBy("obj_c");
    const proj = await resolveProjection(instOf(thread, "obj_c"), thread, createObjectRegistry(), {
      baseDir,
      sessionId: "s1",
    });
    expect(proj.class).toBe("obj_c");
    expect(proj.content).toEqual([]);
    expect(JSON.stringify(proj.content)).not.toContain("placeholder");
    expect(JSON.stringify(proj.content)).not.toContain("后台注册中");
  });
});
