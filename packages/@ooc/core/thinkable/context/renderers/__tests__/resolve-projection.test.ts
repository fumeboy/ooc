/**
 * resolveProjection 默认投影（视角分流）测试。
 *
 * 对象没自定义 readable module 时，框架默认投影**视角分流**：
 * - self 视角（看自己，thread.self objectId === inst.id）→ 渲 self.md 内容
 * - peer 视角（别人看它）→ 渲 readable.md 内容
 * - 两者皆空 → 空 context window `<window class="<inst.class>" id="..."/>`（无 placeholder 文案）
 *
 * self.md / readable.md 是所有 ooc object 的通用身份文件（非 agent 专属）。
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
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class.js";

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

  const instOf = (id: string): OocObjectInstance => ({
    id,
    class: id,
    title: id,
    status: "open",
    createdAt: 0,
    data: {},
  });

  /** thread 的 self objectId = viewer（决定 self/peer 视角）。 */
  const threadViewedBy = (viewer: string) =>
    makeThread({
      objectId: viewer,
      persistence: { baseDir, sessionId: "s1", objectId: viewer, threadId: "t" },
      skipCreatorWindow: true,
    });

  it("self 视角（看自己）→ 渲 self.md 内容", async () => {
    await createStoneObject({ baseDir, objectId: "obj_a" });
    await writeFile(join(stoneDir({ baseDir, objectId: "obj_a" }), "self.md"), "我是 obj_a 的 self 身份", "utf8");

    const proj = await resolveProjection(instOf("obj_a"), threadViewedBy("obj_a"), createObjectRegistry(), {
      baseDir,
      sessionId: "s1",
    });
    expect(proj.class).toBe("obj_a");
    expect(JSON.stringify(proj.content)).toContain("我是 obj_a 的 self 身份");
  });

  it("peer 视角（别人看它）→ 渲 readable.md 内容", async () => {
    await createStoneObject({ baseDir, objectId: "obj_a" });
    await writeFile(join(stoneDir({ baseDir, objectId: "obj_a" }), "self.md"), "obj_a 的 self", "utf8");
    await writeFile(join(stoneDir({ baseDir, objectId: "obj_a" }), "readable.md"), "obj_a 面向他人的描述", "utf8");

    // 视角者是 obj_b，投影 obj_a → peer 视角 → readable.md，不是 self.md
    const proj = await resolveProjection(instOf("obj_a"), threadViewedBy("obj_b"), createObjectRegistry(), {
      baseDir,
      sessionId: "s1",
    });
    expect(JSON.stringify(proj.content)).toContain("obj_a 面向他人的描述");
    expect(JSON.stringify(proj.content)).not.toContain("obj_a 的 self");
  });

  it("self.md / readable.md 皆空 → 空 context window，无 placeholder 文案", async () => {
    await createStoneObject({ baseDir, objectId: "obj_c" }); // self.md/readable.md 空

    const proj = await resolveProjection(instOf("obj_c"), threadViewedBy("obj_c"), createObjectRegistry(), {
      baseDir,
      sessionId: "s1",
    });
    expect(proj.class).toBe("obj_c");
    expect(proj.content).toEqual([]);
    expect(JSON.stringify(proj.content)).not.toContain("placeholder");
    expect(JSON.stringify(proj.content)).not.toContain("后台注册中");
  });
});
