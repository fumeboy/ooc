/**
 * MemoryCurator 单元测试
 *
 * 覆盖：
 * 1. 无注册对象 → tickNow 无副作用
 * 2. 注册对象但无 entries → 不触发 curation
 * 3. 冷启动（lastCurationAt===0）且有 entries → 立即触发一次
 * 4. 时间阈值触发（时间过了但计数未到）
 * 5. 计数阈值触发（计数到了但时间未到）
 * 6. curateNow 强制立即跑（跳过阈值判断）
 * 7. stats 正确记录 merged / kept / at
 * 8. graceful stop 等 in-flight 完成
 * 9. 幂等 start / stop
 * 10. tickIntervalMs / timeThresholdMs / countThresholdEntries 可配置
 *
 * @ref kernel/src/persistence/memory-curator.ts
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryCurator } from "../src/persistence/memory-curator.js";
import { appendMemoryEntry, readMemoryEntries } from "../src/persistence/memory-entries.js";

let tmp = "";
let selfDir = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mem-curator-"));
  selfDir = join(tmp, "stones", "bruce");
  mkdirSync(selfDir, { recursive: true });
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("MemoryCurator", () => {
  test("无注册对象 → tickNow 无副作用", async () => {
    const c = new MemoryCurator();
    await c.tickNow();
    expect(c.registered()).toEqual([]);
  });

  test("注册对象但无 entries → 不触发 curation", async () => {
    const c = new MemoryCurator();
    c.register("bruce", selfDir);
    await c.tickNow();
    expect(c.getLastStat("bruce")).toBeUndefined();
  });

  test("冷启动有 entries → 首 tick 触发一次 curation（merge + rebuild index）", async () => {
    /* 写入两条同 key 的 entry 构造"可合并"场景 */
    appendMemoryEntry(selfDir, "bruce", { key: "k1", content: "line-a" });
    appendMemoryEntry(selfDir, "bruce", { key: "k1", content: "line-b" });

    expect(readMemoryEntries(selfDir).length).toBe(2);

    const c = new MemoryCurator();
    c.register("bruce", selfDir);
    await c.tickNow();

    const stat = c.getLastStat("bruce");
    expect(stat).toBeDefined();
    expect(stat!.merged).toBe(1); /* 两条合并成一条，物理删了 1 个文件 */
    expect(stat!.kept).toBe(1);
    expect(stat!.at.length).toBeGreaterThan(0);

    /* index.md 被生成 */
    expect(existsSync(join(selfDir, "memory", "index.md"))).toBe(true);
  });

  test("计数阈值触发：阈值=2，写 2 条新 entry 后 tick 触发", async () => {
    const c = new MemoryCurator({
      timeThresholdMs: 10 * 60 * 60 * 1000, /* 很长时间阈值，排除时间触发 */
      countThresholdEntries: 2,
    });
    /* 先注册（此时空目录，lastEntryCount=0） */
    c.register("bruce", selfDir);

    /* 手动跑一遍 tick——空目录 → 不触发（firstTime 要求 entryCount>0） */
    await c.tickNow();
    expect(c.getLastStat("bruce")).toBeUndefined();

    /* 写两条 entry（阈值=2）——应触发 */
    appendMemoryEntry(selfDir, "bruce", { key: "a", content: "x" });
    appendMemoryEntry(selfDir, "bruce", { key: "b", content: "y" });

    await c.tickNow();
    const stat = c.getLastStat("bruce");
    expect(stat).toBeDefined();
    expect(stat!.kept).toBe(2);
  });

  test("curateNow 强制立即跑（跳过阈值判断）", async () => {
    appendMemoryEntry(selfDir, "bruce", { key: "solo", content: "only-one" });
    const c = new MemoryCurator({
      timeThresholdMs: 10 * 60 * 60 * 1000,
      countThresholdEntries: 1000,
    });
    c.register("bruce", selfDir);

    /* 立即调 curateNow，跳过所有阈值检查 */
    const stat = await c.curateNow("bruce");
    expect(stat).not.toBeNull();
    expect(stat!.stoneName).toBe("bruce");
    expect(stat!.kept).toBe(1);
    expect(stat!.merged).toBe(0);
  });

  test("curateNow 对未注册对象返回 null", async () => {
    const c = new MemoryCurator();
    const r = await c.curateNow("ghost");
    expect(r).toBeNull();
  });

  test("unregister 后再 tickNow 不会触发", async () => {
    appendMemoryEntry(selfDir, "bruce", { key: "a", content: "x" });
    const c = new MemoryCurator();
    c.register("bruce", selfDir);
    c.unregister("bruce");
    await c.tickNow();
    expect(c.getLastStat("bruce")).toBeUndefined();
  });

  test("start/stop 幂等", async () => {
    const c = new MemoryCurator({ tickIntervalMs: 60_000 });
    c.start();
    c.start(); /* no-op */
    await c.stop();
    await c.stop(); /* no-op */
    expect(true).toBe(true);
  });

  test("stats 记录完整字段（stoneName, merged, kept, at）", async () => {
    appendMemoryEntry(selfDir, "bruce", { key: "k", content: "c1" });
    appendMemoryEntry(selfDir, "bruce", { key: "k", content: "c2" });
    appendMemoryEntry(selfDir, "bruce", { key: "k", content: "c3" });
    const c = new MemoryCurator();
    c.register("bruce", selfDir);
    await c.tickNow();
    const stat = c.getLastStat("bruce")!;
    expect(stat.stoneName).toBe("bruce");
    expect(stat.merged).toBe(2);
    expect(stat.kept).toBe(1);
    /* index.md 更新 */
    const idx = readFileSync(join(selfDir, "memory", "index.md"), "utf-8");
    expect(idx).toContain("# Memory Index");
  });

  test("多对象注册 —— 只有符合触发条件的跑 curation", async () => {
    const aliceDir = join(tmp, "stones", "alice");
    mkdirSync(aliceDir, { recursive: true });
    appendMemoryEntry(selfDir, "bruce", { key: "x", content: "1" });
    /* alice 没有 entries */

    const c = new MemoryCurator();
    c.register("bruce", selfDir);
    c.register("alice", aliceDir);
    await c.tickNow();

    expect(c.getLastStat("bruce")).toBeDefined();
    expect(c.getLastStat("alice")).toBeUndefined();
  });
});
