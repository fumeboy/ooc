/**
 * Phase 4 Task 4.2 — HTTP POST /api/flows/:sid/objects/:name/call_method
 *
 * 端点测试：
 * - 合法调用：self namespace + kind=view + ui_methods → 200 + { success: true, data: { result } }
 * - 白名单拦截：
 *   - traitId namespace !== self → 403
 *   - traitId 对应的 trait kind !== view → 403
 *   - 方法只在 llm_methods 不在 ui_methods → 403
 *   - view 不属于目标对象 → 404
 * - 副作用：notifyThread 写入根线程 inbox + 复活 done 线程
 * - 400：缺 body 或 traitId/method
 *
 * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.6
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { World } from "../src/world/world.js";
import { handleRoute } from "../src/observable/server/server.js";
import { ThreadsTree } from "../src/thinkable/thread-tree/tree.js";
import type { LLMConfig } from "../src/thinkable/llm/config.js";

/** 测试用 LLMConfig：不依赖 OOC_API_KEY。端点测试不会真正调 chat。 */
const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
};

const TEST_ROOT = join(import.meta.dir, ".tmp_call_method_test");

/** 构造一个最小 World：test-obj + 一个 self:demo view */
async function setupWorld(): Promise<{ world: World; sid: string; objDir: string; objFlowDir: string }> {
  rmSync(TEST_ROOT, { recursive: true, force: true });

  /* 目录结构：
   * TEST_ROOT/
   * ├── kernel/traits/ (空)
   * ├── library/traits/ (空)
   * ├── stones/test-obj/
   * │   ├── readme.md
   * │   ├── data.json
   * │   └── views/demo/{VIEW.md, frontend.tsx, backend.ts}
   * └── flows/s_test/objects/test-obj/ (线程树)
   */
  const stoneDir = join(TEST_ROOT, "stones", "test-obj");
  const viewDir = join(stoneDir, "views", "demo");
  mkdirSync(viewDir, { recursive: true });
  writeFileSync(join(stoneDir, "readme.md"), "# test-obj\n", "utf-8");
  writeFileSync(join(stoneDir, "data.json"), JSON.stringify({ name: "test-obj" }), "utf-8");

  writeFileSync(
    join(viewDir, "VIEW.md"),
    `---
namespace: self
name: demo
kind: view
---
demo view`,
    "utf-8",
  );
  writeFileSync(
    join(viewDir, "frontend.tsx"),
    `export default function Demo(){return null;}`,
    "utf-8",
  );
  writeFileSync(
    join(viewDir, "backend.ts"),
    `export const ui_methods = {
  submit: {
    description: "提交示例",
    params: [{ name: "x", type: "number", description: "", required: true }],
    fn: async (ctx, { x }) => {
      ctx.setData("lastX", x);
      if (ctx.notifyThread) ctx.notifyThread("收到提交: x=" + x, { from: "ui" });
      return { ok: true, x };
    },
  },
  boom: {
    description: "总是抛错",
    params: [],
    fn: async () => { throw new Error("boom!"); },
  },
};
export const llm_methods = {
  parse: {
    description: "只给 LLM",
    params: [],
    fn: async () => "parsed",
  },
};`,
    "utf-8",
  );

  /* 最小 kernel/library 占位（空目录即可） */
  mkdirSync(join(TEST_ROOT, "kernel", "traits"), { recursive: true });
  mkdirSync(join(TEST_ROOT, "library", "traits"), { recursive: true });

  /* 创建 flows/s_test 线程树（root 线程 = done 初态，用于测试复活） */
  const sid = "s_test";
  const objFlowDir = join(TEST_ROOT, "flows", sid, "objects", "test-obj");
  const tree = await ThreadsTree.create(objFlowDir, "test-obj root", "init");
  await tree.setNodeStatus(tree.rootId, "done");

  /* 初始化 World */
  const world = new World({ rootDir: TEST_ROOT, llmConfig: TEST_LLM_CONFIG });
  world.init();

  return { world, sid, objDir: stoneDir, objFlowDir };
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function makeReq(body: object): Request {
  return new Request("http://localhost/api/flows/s_test/objects/test-obj/call_method", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/flows/:sid/objects/:name/call_method", () => {
  test("合法：self:demo ui_methods.submit → 200 + result", async () => {
    const { world, objFlowDir } = await setupWorld();
    const req = makeReq({ traitId: "self:demo", method: "submit", args: { x: 42 } });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.result).toEqual({ ok: true, x: 42 });

    /* 副作用：notifyThread 写入 inbox，done 线程被复活 */
    const tree = ThreadsTree.load(objFlowDir);
    expect(tree).not.toBeNull();
    const rootId = tree!.rootId;
    const inbox = tree!.readThreadData(rootId)?.inbox ?? [];
    expect(inbox.some((m) => m.content.includes("收到提交: x=42"))).toBe(true);
    const rootNode = tree!.getNode(rootId);
    /* writeInbox 的 revival：done → running */
    expect(rootNode?.status).toBe("running");
  });

  test("403：非 self namespace 的 traitId", async () => {
    const { world } = await setupWorld();
    const req = makeReq({ traitId: "kernel:computable", method: "readFile", args: {} });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toMatch(/self/);
  });

  test("403：self:trait 但 kind=trait（非 view）", async () => {
    const { world } = await setupWorld();
    /* 创建一个普通 self trait（非 view） */
    const traitDir = join(TEST_ROOT, "stones", "test-obj", "traits", "helper");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(
      join(traitDir, "TRAIT.md"),
      `---
namespace: self
name: helper
---
helper`,
      "utf-8",
    );
    writeFileSync(
      join(traitDir, "index.ts"),
      `export const ui_methods = {
  doit: { description: "", params: [], fn: async () => "did" },
};`,
      "utf-8",
    );
    /* 重载 world 以感知新 trait */
    const world2 = new World({ rootDir: TEST_ROOT, llmConfig: TEST_LLM_CONFIG });
    world2.init();

    const req = makeReq({ traitId: "self:helper", method: "doit", args: {} });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world2);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toMatch(/view/);
  });

  test("403：方法只在 llm_methods 不在 ui_methods", async () => {
    const { world } = await setupWorld();
    const req = makeReq({ traitId: "self:demo", method: "parse", args: {} });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toMatch(/ui_methods/);
  });

  test("404：view 不存在于目标对象", async () => {
    const { world } = await setupWorld();
    const req = makeReq({ traitId: "self:nonexistent", method: "submit", args: {} });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world);
    expect(res.status).toBe(404);
  });

  test("400：缺 traitId", async () => {
    const { world } = await setupWorld();
    const req = makeReq({ method: "submit", args: {} });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world);
    expect(res.status).toBe(400);
  });

  test("500：方法自身抛错", async () => {
    const { world } = await setupWorld();
    const req = makeReq({ traitId: "self:demo", method: "boom", args: {} });
    const res = await handleRoute("POST", "/api/flows/s_test/objects/test-obj/call_method", req, world);
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error).toMatch(/boom!/);
  });
});
