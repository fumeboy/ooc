/**
 * ReflectScheduler 单元测试
 *
 * 反思线程的执行调度——方案 B Phase 1 基础架构。
 *
 * 覆盖：
 * - 注册对象后可查询其 reflect 目录
 * - `triggerReflect(stoneName)` 检查 reflect 线程 inbox，有未读 → 调 runner
 * - 无未读时不调 runner
 * - 多对象独立调度（一个对象的反思不阻塞另一个）
 * - `scanAll` 扫描已注册对象，对每个依次 trigger
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_ReflectFlow方案B.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { talkToReflect } from "../src/thread/reflect.js";
import { ReflectScheduler } from "../src/thread/reflect-scheduler.js";

const TEST_DIR = join(import.meta.dir, ".tmp_reflect_scheduler_test");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("ReflectScheduler", () => {
  test("register 和 getRegistered 正确", () => {
    const scheduler = new ReflectScheduler(async () => {});
    scheduler.register("bruce", join(TEST_DIR, "bruce"));
    scheduler.register("iris", join(TEST_DIR, "iris"));

    const registered = scheduler.getRegistered();
    expect(registered.map(r => r.stoneName).sort()).toEqual(["bruce", "iris"]);
  });

  test("triggerReflect 在无未读消息时不调 runner", async () => {
    let runs = 0;
    const scheduler = new ReflectScheduler(async () => { runs++; });
    const stoneDir = join(TEST_DIR, "bruce");
    mkdirSync(stoneDir, { recursive: true });
    scheduler.register("bruce", stoneDir);

    await scheduler.triggerReflect("bruce");
    expect(runs).toBe(0);
  });

  test("triggerReflect 在有未读消息时调 runner 一次", async () => {
    let runs = 0;
    let capturedStone = "";
    const scheduler = new ReflectScheduler(async ({ stoneName }) => {
      runs++;
      capturedStone = stoneName;
    });
    const stoneDir = join(TEST_DIR, "bruce");
    mkdirSync(stoneDir, { recursive: true });
    scheduler.register("bruce", stoneDir);

    /* 投递一条未读 */
    await talkToReflect(stoneDir, "bruce", "第一条经验");
    await scheduler.triggerReflect("bruce");

    expect(runs).toBe(1);
    expect(capturedStone).toBe("bruce");
  });

  test("triggerReflect 未注册的对象抛错或被忽略", async () => {
    const scheduler = new ReflectScheduler(async () => {});
    /* 未注册 → 不应 throw（宽松语义），计数保持 0 */
    await scheduler.triggerReflect("not_registered");
    expect(scheduler.getRegistered().length).toBe(0);
  });

  test("scanAll 遍历所有注册对象并 trigger", async () => {
    const triggered: string[] = [];
    const scheduler = new ReflectScheduler(async ({ stoneName }) => {
      triggered.push(stoneName);
    });

    const bruceDir = join(TEST_DIR, "bruce");
    const irisDir = join(TEST_DIR, "iris");
    mkdirSync(bruceDir, { recursive: true });
    mkdirSync(irisDir, { recursive: true });
    scheduler.register("bruce", bruceDir);
    scheduler.register("iris", irisDir);

    /* 都投递 */
    await talkToReflect(bruceDir, "bruce", "msg-bruce");
    await talkToReflect(irisDir, "iris", "msg-iris");

    await scheduler.scanAll();

    expect(triggered.sort()).toEqual(["bruce", "iris"]);
  });

  test("runner 抛错时不影响 scheduler 继续调度其他对象", async () => {
    let okCount = 0;
    const scheduler = new ReflectScheduler(async ({ stoneName }) => {
      if (stoneName === "bad") throw new Error("runner failed");
      okCount++;
    });

    const goodDir = join(TEST_DIR, "good");
    const badDir = join(TEST_DIR, "bad");
    mkdirSync(goodDir, { recursive: true });
    mkdirSync(badDir, { recursive: true });
    scheduler.register("bad", badDir);
    scheduler.register("good", goodDir);
    await talkToReflect(badDir, "system", "bad msg");
    await talkToReflect(goodDir, "system", "good msg");

    await scheduler.scanAll();

    expect(okCount).toBe(1); /* good runner 成功执行 */
  });

  test("unregister 后不再调度该对象", async () => {
    let runs = 0;
    const scheduler = new ReflectScheduler(async () => { runs++; });
    const stoneDir = join(TEST_DIR, "bruce");
    mkdirSync(stoneDir, { recursive: true });
    scheduler.register("bruce", stoneDir);
    await talkToReflect(stoneDir, "bruce", "msg");

    scheduler.unregister("bruce");
    await scheduler.scanAll();

    expect(runs).toBe(0);
  });
});
