/**
 * SuperScheduler 单元测试
 *
 * 测试策略：注入 mock runner，验证调度器的"发现 + 派发 + 串行化 + 幂等 + 停机"语义。
 * engine 真实执行路径由 Phase 3 的 runSuperThread 覆盖，与 scheduler 解耦。
 *
 * 覆盖场景：
 * 1. 仅在 unread inbox 存在时触发 runner（无 unread 不调）
 * 2. 首次 tick 触发 runner 成功并调用一次
 * 3. 同一 stone 的 runner in-flight 期间新 tick 不重复派发（幂等）
 * 4. 多 stone 并发：不同 stone 的 runner 互不阻塞
 * 5. 同 stone 连续 tick：SerialQueue 保证顺序执行
 * 6. runner 抛错不污染后续 tick / 其他 stone
 * 7. stop() 等待 in-flight runner 完成后返回（graceful shutdown）
 * 8. 未注册 stone 的 tick 不派发
 *
 * @ref kernel/src/collaborable/super/super-scheduler.ts
 * @ref docs/工程管理/迭代/all/20260422_feature_super_scheduler.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SuperScheduler, type SuperRunner } from "../src/collaborable/super/super-scheduler.js";
import { handleOnTalkToSuper, getSuperThreadDir } from "../src/collaborable/super/super.js";

function makeTmpRoot(prefix = "super-scheduler-test"): string {
  const base = join(tmpdir(), `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(base, { recursive: true });
  return base;
}

/** 让 event loop 喘口气，给 SerialQueue / microtask 完成机会 */
async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 10));
}

describe("SuperScheduler", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = makeTmpRoot();
    mkdirSync(join(rootDir, "stones", "bruce"), { recursive: true });
    mkdirSync(join(rootDir, "stones", "alice"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(rootDir)) rmSync(rootDir, { recursive: true, force: true });
  });

  test("无注册对象 → tickNow 不派发 runner", async () => {
    let calls = 0;
    const runner: SuperRunner = async () => { calls++; };
    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    await scheduler.tickNow();
    expect(calls).toBe(0);
  });

  test("注册但 super/threads.json 不存在 → 不派发", async () => {
    let calls = 0;
    const runner: SuperRunner = async () => { calls++; };
    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    expect(scheduler.registered()).toEqual(["bruce"]);
    await scheduler.tickNow();
    expect(calls).toBe(0);
  });

  test("super 存在但无 unread inbox → 不派发", async () => {
    /* 先投一条消息再 ack（让 inbox 无 unread）——此处简化：直接 talkToSuper
       一条，inbox 里是 unread，所以我们测的是"如果没 unread 就不跑"的场景。
       构造"没 unread"的 super：创建空线程树不写消息。 */
    const { ThreadsTree } = await import("../src/thinkable/thread-tree/tree.js");
    const superDir = getSuperThreadDir(rootDir, "bruce");
    mkdirSync(superDir, { recursive: true });
    await ThreadsTree.create(superDir, "bruce:super", "test");

    let calls = 0;
    const runner: SuperRunner = async () => { calls++; };
    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    await scheduler.tickNow();
    expect(calls).toBe(0);
  });

  test("有 unread inbox → tick 派发一次 runner", async () => {
    /* 触发一次 talk(super) 落盘 unread */
    await handleOnTalkToSuper({ fromObject: "bruce", message: "记下经验 X", rootDir });

    const stonesCalled: string[] = [];
    const runner: SuperRunner = async ({ stoneName }) => { stonesCalled.push(stoneName); };
    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    await scheduler.tickNow();
    expect(stonesCalled).toEqual(["bruce"]);
  });

  test("幂等：runner in-flight 期间新 tick 不重复派发", async () => {
    await handleOnTalkToSuper({ fromObject: "bruce", message: "m1", rootDir });

    let inFlight = 0;
    let maxInFlight = 0;
    let totalCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });

    const runner: SuperRunner = async () => {
      totalCalls++;
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await gate;
      inFlight--;
    };

    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);

    /* 启动两个并发 tick，runner 被 gate 卡住 */
    const t1 = scheduler.tickNow();
    const t2 = (async () => {
      await flush();
      await scheduler.tickNow();
    })();

    await flush();
    /* 此时 runner 被卡住，inFlight 应为 1（不会是 2 — 幂等生效） */
    expect(inFlight).toBe(1);

    release();
    await Promise.all([t1, t2]);

    /* 第二次 tick 时第一次还没完成，被跳过；所以只有 1 次调用 */
    expect(totalCalls).toBe(1);
    expect(maxInFlight).toBe(1);
  });

  test("多 stone 并发：runner 不互相阻塞（不同 key 并行）", async () => {
    await handleOnTalkToSuper({ fromObject: "bruce", message: "m1", rootDir });
    await handleOnTalkToSuper({ fromObject: "alice", message: "m2", rootDir });

    const started = new Set<string>();
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });

    const runner: SuperRunner = async ({ stoneName }) => {
      started.add(stoneName);
      if (started.size > maxInFlight) maxInFlight = started.size;
      await gate;
      started.delete(stoneName);
    };

    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    scheduler.register("alice", rootDir);

    /* tickNow 派发两个不同 stone 的 runner，应并发执行 */
    const done = scheduler.tickNow();
    await flush();
    expect(maxInFlight).toBe(2);

    release();
    await done;
  });

  test("同 stone 连续 tick → SerialQueue 保证顺序执行（幂等后新 tick 继续投递）", async () => {
    /* tick1 触发 runner1（正在跑），同时同 stone 的 tick2 会被幂等跳过。
       runner1 跑完后，再次投递 unread，tick3 会再次派发——验证 resume 行为。 */
    await handleOnTalkToSuper({ fromObject: "bruce", message: "m1", rootDir });

    const order: string[] = [];
    let callCount = 0;
    const runner: SuperRunner = async ({ stoneName }) => {
      callCount++;
      const myCall = callCount;
      order.push(`start-${stoneName}-${myCall}`);
      await flush();
      order.push(`end-${stoneName}-${myCall}`);
    };

    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    await scheduler.tickNow();
    expect(order).toEqual(["start-bruce-1", "end-bruce-1"]);
    expect(callCount).toBe(1);

    /* 第一轮 runner 没有消费 unread（mock 不消费）——当前实现下 tickNow 会再跑一次。
       这是预期行为：测试用 mock 不 ack inbox，所以每次 tick 都会派发。
       真实 runner (Phase 3) 会在 engine 里跑 mark，把 unread 改为 marked。 */
    await scheduler.tickNow();
    expect(callCount).toBe(2);
  });

  test("runner 抛错不污染后续 stone 或后续 tick", async () => {
    await handleOnTalkToSuper({ fromObject: "bruce", message: "m1", rootDir });
    await handleOnTalkToSuper({ fromObject: "alice", message: "m2", rootDir });

    const stonesCalled: string[] = [];
    const runner: SuperRunner = async ({ stoneName }) => {
      stonesCalled.push(stoneName);
      if (stoneName === "bruce") throw new Error("bruce runner boom");
    };

    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    scheduler.register("alice", rootDir);

    await scheduler.tickNow();
    expect(stonesCalled.sort()).toEqual(["alice", "bruce"]);

    /* 再 tick 一次，两者都应再次被派发（上次错误不影响） */
    stonesCalled.length = 0;
    await scheduler.tickNow();
    expect(stonesCalled.sort()).toEqual(["alice", "bruce"]);
  });

  test("stop() 等 in-flight runner 完成后才返回（graceful）", async () => {
    await handleOnTalkToSuper({ fromObject: "bruce", message: "m1", rootDir });

    let runnerResolved = false;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const runner: SuperRunner = async () => {
      await gate;
      runnerResolved = true;
    };

    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);

    /* 启动 tick（不 await）——runner 被 gate 卡住 */
    const tickP = scheduler.tickNow();
    await flush();

    /* 并发发起 stop——应等 gate 释放后 runner 完成，才返回 */
    const stopP = scheduler.stop();
    await flush();
    expect(runnerResolved).toBe(false);

    release();
    await Promise.all([tickP, stopP]);
    expect(runnerResolved).toBe(true);
  });

  test("start/stop 幂等（多次 start/stop 不崩）", async () => {
    const runner: SuperRunner = async () => { /* noop */ };
    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.start();
    scheduler.start();  /* 第二次 start 忽略（有 warn log） */
    await scheduler.stop();
    await scheduler.stop(); /* 第二次 stop 无副作用 */
    expect(scheduler.registered()).toEqual([]);
  });

  test("unregister 后 tick 不再派发该对象", async () => {
    await handleOnTalkToSuper({ fromObject: "bruce", message: "m1", rootDir });

    const stonesCalled: string[] = [];
    const runner: SuperRunner = async ({ stoneName }) => { stonesCalled.push(stoneName); };
    const scheduler = new SuperScheduler({ runner, tickIntervalMs: 60_000 });
    scheduler.register("bruce", rootDir);
    scheduler.unregister("bruce");
    expect(scheduler.registered()).toEqual([]);
    await scheduler.tickNow();
    expect(stonesCalled).toEqual([]);
  });
});
