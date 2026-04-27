/**
 * SuperFlow — world.talk(target="super") 路由测试（Phase 1）
 *
 * 目标：把方案 B 的 `talkToSelf → reflect.ts` 替换为更简洁的通用
 *       `talk(target="super")` 通道。super 是 talk 的特殊 target，
 *       world.onTalk 识别后把消息落盘到 `stones/{fromObject}/super/`
 *       的独立 ThreadsTree 的 root inbox，不触发 ThinkLoop（跨 session
 *       常驻调度器留作后续迭代）。
 *
 * 覆盖：
 * 1. handleOnTalkToSuper 首次投递创建 super 目录与 root 线程
 * 2. 多次投递累积到同一 super 线程树（复用 rootId）
 * 3. 返回 reply=null + remoteThreadId（表示已落盘、不等回复）
 *
 * @ref docs/工程管理/迭代/all/20260422_refactor_SuperFlow转型.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { handleOnTalkToSuper } from "../src/world/super.js";
import { ThreadsTree } from "../src/thread/tree.js";

/** 为每个测试生成独立 tmp 根目录（模拟 user repo 根） */
function makeTmpRoot(prefix = "world-super-test"): string {
  const base = join(tmpdir(), `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(base, { recursive: true });
  return base;
}

describe("handleOnTalkToSuper — SuperFlow 落盘", () => {
  let rootDir: string;
  let stoneDir: string;

  beforeEach(() => {
    rootDir = makeTmpRoot();
    stoneDir = join(rootDir, "stones", "bruce");
    mkdirSync(stoneDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(rootDir)) rmSync(rootDir, { recursive: true, force: true });
  });

  test("首次投递 → 创建 {stoneDir}/super/ + threads.json + inbox", async () => {
    const result = await handleOnTalkToSuper({
      fromObject: "bruce",
      message: "记下一条经验：读 meta.md 要分段看子树",
      rootDir,
    });

    /* 返回值：不等回复的落盘投递 */
    expect(result.reply).toBeNull();
    expect(typeof result.remoteThreadId).toBe("string");

    /* 物理落盘 */
    const superDir = join(stoneDir, "super");
    const threadsJson = join(superDir, "threads.json");
    expect(existsSync(threadsJson)).toBe(true);

    const raw = JSON.parse(readFileSync(threadsJson, "utf-8"));
    expect(raw.rootId).toBe(result.remoteThreadId);
    expect(raw.nodes[raw.rootId]).toBeDefined();

    /* inbox 里有消息 */
    const tree = ThreadsTree.load(superDir);
    expect(tree).toBeTruthy();
    const threadData = tree!.readThreadData(tree!.rootId);
    expect(threadData).toBeTruthy();
    expect(threadData!.inbox!.length).toBe(1);
    expect(threadData!.inbox![0]!.content).toContain("读 meta.md");
    expect(threadData!.inbox![0]!.from).toBe("bruce");
  });

  test("多次投递累积到同一 super 线程树（复用 rootId）", async () => {
    const r1 = await handleOnTalkToSuper({ fromObject: "bruce", message: "第一条", rootDir });
    const r2 = await handleOnTalkToSuper({ fromObject: "bruce", message: "第二条", rootDir });
    const r3 = await handleOnTalkToSuper({ fromObject: "bruce", message: "第三条", rootDir });

    /* 同一 rootId 被复用（不是每次创建新树） */
    expect(r1.remoteThreadId).toBe(r2.remoteThreadId);
    expect(r2.remoteThreadId).toBe(r3.remoteThreadId);

    const tree = ThreadsTree.load(join(stoneDir, "super"));
    expect(tree).toBeTruthy();
    const td = tree!.readThreadData(tree!.rootId);
    expect(td!.inbox!.length).toBe(3);
    expect(td!.inbox!.map((m: any) => m.content)).toEqual(["第一条", "第二条", "第三条"]);
  });

  test("不同对象的 super 互不干扰（落盘在各自的 stones/{name}/super/）", async () => {
    const irisDir = join(rootDir, "stones", "iris");
    mkdirSync(irisDir, { recursive: true });

    await handleOnTalkToSuper({ fromObject: "bruce", message: "bruce-msg", rootDir });
    await handleOnTalkToSuper({ fromObject: "iris", message: "iris-msg", rootDir });

    const bruceTree = ThreadsTree.load(join(stoneDir, "super"));
    const irisTree = ThreadsTree.load(join(irisDir, "super"));
    expect(bruceTree).toBeTruthy();
    expect(irisTree).toBeTruthy();
    expect(bruceTree!.rootId).not.toBe(irisTree!.rootId);

    expect(bruceTree!.readThreadData(bruceTree!.rootId)!.inbox![0]!.content).toBe("bruce-msg");
    expect(irisTree!.readThreadData(irisTree!.rootId)!.inbox![0]!.content).toBe("iris-msg");
  });

  test("rootDir 不存在 stones/{fromObject} 时自动兜底 mkdir（不报错）", async () => {
    /* 清理默认创建的目录重新测试 */
    rmSync(join(rootDir, "stones"), { recursive: true, force: true });

    const result = await handleOnTalkToSuper({
      fromObject: "newObject",
      message: "测试兜底",
      rootDir,
    });
    expect(result.reply).toBeNull();
    expect(existsSync(join(rootDir, "stones", "newObject", "super"))).toBe(true);
  });
});
