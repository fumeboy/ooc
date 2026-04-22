/**
 * Running Session 动态摘要（currentAction）端点测试
 *
 * 覆盖 `GET /api/flows/:sid` 的新增字段 `subFlows[i].currentAction`：
 * - 最新 thinking 首句优先
 * - 其次 tool_use.title
 * - 兜底最新 action 的 name/type
 * - 超过 50 字符截断补 `…`
 * - finished 状态不带 currentAction
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_running_session_摘要.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { World } from "../src/world/world.js";
import { handleRoute } from "../src/server/server.js";
import { ThreadsTree } from "../src/thread/tree.js";
import type { LLMConfig } from "../src/thinkable/config.js";
import type { ThreadAction } from "../src/thread/types.js";

/** 测试用 LLMConfig：不依赖 OOC_API_KEY（本组测试不发起 LLM 调用）。 */
const TEST_LLM_CONFIG: LLMConfig = {
  provider: "openai-compatible",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "test-model",
  maxTokens: 1024,
  timeout: 5,
  thinking: { enabled: false },
};

const TEST_ROOT = join(import.meta.dir, ".tmp_current_action_test");

/**
 * 构造一个最小 Flow 目录：
 * - 一个 supervisor 对象线程树（running 状态 + 指定 actions）
 * - 一个 finished 对象线程树（done 状态 + 完整 summary）
 */
async function setup(actions: ThreadAction[]): Promise<{ world: World; sid: string }> {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(join(TEST_ROOT, "kernel", "traits"), { recursive: true });
  mkdirSync(join(TEST_ROOT, "library", "traits"), { recursive: true });

  /* supervisor object stone 占位 */
  const stoneDir = join(TEST_ROOT, "stones", "supervisor");
  mkdirSync(stoneDir, { recursive: true });
  writeFileSync(join(stoneDir, "readme.md"), "# supervisor\n", "utf-8");
  writeFileSync(join(stoneDir, "data.json"), JSON.stringify({ name: "supervisor" }), "utf-8");

  /* flows/s_test/objects/supervisor/（running 线程 + 指定 actions） */
  const sid = "s_test";
  const supervisorFlowDir = join(TEST_ROOT, "flows", sid, "objects", "supervisor");
  const tree = await ThreadsTree.create(supervisorFlowDir, "supervisor root", "init");
  /* 写 actions 到 root thread */
  const base = tree.readThreadData(tree.rootId);
  if (!base) throw new Error("root thread data not found");
  tree.writeThreadData(tree.rootId, { ...base, actions });
  /* 确保 status 是 running */
  await tree.setNodeStatus(tree.rootId, "running");

  /* 另建一个 finished 对象：alice（done 状态），验证 finished 不带 currentAction */
  const aliceFlowDir = join(TEST_ROOT, "flows", sid, "objects", "alice");
  const aliceTree = await ThreadsTree.create(aliceFlowDir, "alice root", "init");
  await aliceTree.setNodeStatus(aliceTree.rootId, "done");
  await aliceTree.updateNodeMeta(aliceTree.rootId, { summary: "alice 已完成全部工作" });

  /* 写一份最小 flow 数据文件到 supervisor 目录，供 readFlow 成功 */
  writeFlowJson(supervisorFlowDir, sid, "supervisor", "running");
  writeFlowJson(aliceFlowDir, sid, "alice", "finished");

  const world = new World({ rootDir: TEST_ROOT, llmConfig: TEST_LLM_CONFIG });
  world.init();
  return { world, sid };
}

/** 写最小 data.json（readFlow 识别此格式）。 */
function writeFlowJson(dir: string, sid: string, stoneName: string, status: string): void {
  mkdirSync(dir, { recursive: true });
  const flow = {
    sessionId: sid,
    stoneName,
    status,
    messages: [],
    data: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeFileSync(join(dir, "data.json"), JSON.stringify(flow), "utf-8");
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

async function getFlow(world: World, sid: string): Promise<{ subFlows: Array<{ stoneName: string; status: string; currentAction?: string }> }> {
  const req = new Request(`http://localhost/api/flows/${sid}`, { method: "GET" });
  const res = await handleRoute("GET", `/api/flows/${sid}`, req, world);
  expect(res.status).toBe(200);
  const body = await res.json() as { success: boolean; data: { subFlows: Array<{ stoneName: string; status: string; currentAction?: string }> } };
  expect(body.success).toBe(true);
  return body.data;
}

describe("GET /api/flows/:sid currentAction 动态摘要", () => {
  test("优先级 1：最新 thinking 首句", async () => {
    const actions: ThreadAction[] = [
      { id: "a1", type: "tool_use", timestamp: 1, content: "", title: "读文件 gene.md" },
      { id: "a2", type: "thinking", timestamp: 2, content: "我正在分析用户的意图\n第二行应该被忽略" },
    ];
    const { world, sid } = await setup(actions);
    const data = await getFlow(world, sid);
    const sup = data.subFlows.find((s) => s.stoneName === "supervisor");
    expect(sup?.currentAction).toBe("我正在分析用户的意图");
  });

  test("优先级 2：无 thinking 时取最新 tool_use.title", async () => {
    const actions: ThreadAction[] = [
      { id: "a1", type: "tool_use", timestamp: 1, content: "", title: "旧 tool" },
      { id: "a2", type: "tool_use", timestamp: 2, content: "", title: "新 tool：读取 readme" },
    ];
    const { world, sid } = await setup(actions);
    const data = await getFlow(world, sid);
    const sup = data.subFlows.find((s) => s.stoneName === "supervisor");
    expect(sup?.currentAction).toBe("新 tool：读取 readme");
  });

  test("优先级 3：兜底最新 action 的 name/type", async () => {
    const actions: ThreadAction[] = [
      { id: "a1", type: "inject", timestamp: 1, content: "", name: "inject_trait" },
    ];
    const { world, sid } = await setup(actions);
    const data = await getFlow(world, sid);
    const sup = data.subFlows.find((s) => s.stoneName === "supervisor");
    expect(sup?.currentAction).toBe("inject_trait");
  });

  test("超过 50 字符截断补 …", async () => {
    const long = "这是一段非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的 thinking 内容用来验证截断规则";
    const actions: ThreadAction[] = [
      { id: "a1", type: "thinking", timestamp: 1, content: long },
    ];
    const { world, sid } = await setup(actions);
    const data = await getFlow(world, sid);
    const sup = data.subFlows.find((s) => s.stoneName === "supervisor");
    expect(sup?.currentAction).toBeDefined();
    expect(sup!.currentAction!.length).toBeLessThanOrEqual(50);
    expect(sup!.currentAction!.endsWith("…")).toBe(true);
  });

  test("actions 为空时 currentAction 为 undefined（不出现在响应里）", async () => {
    const { world, sid } = await setup([]);
    const data = await getFlow(world, sid);
    const sup = data.subFlows.find((s) => s.stoneName === "supervisor");
    expect(sup).toBeDefined();
    expect(sup!.currentAction).toBeUndefined();
  });

  test("finished 状态不带 currentAction", async () => {
    const actions: ThreadAction[] = [
      { id: "a1", type: "thinking", timestamp: 1, content: "supervisor 正在思考" },
    ];
    const { world, sid } = await setup(actions);
    const data = await getFlow(world, sid);
    const alice = data.subFlows.find((s) => s.stoneName === "alice");
    expect(alice).toBeDefined();
    expect(alice!.status).toBe("finished");
    expect(alice!.currentAction).toBeUndefined();
  });
});
