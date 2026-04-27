/**
 * memory-gc.ts 单元测试
 *
 * 覆盖：
 * 1. evaluateGcDecision 对 pinned / fresh / expired 返回正确 reason
 * 2. runMemoryGc dry-run 默认不删文件
 * 3. runMemoryGc forceRealDelete=true 真删（+ embedding）
 * 4. audit log JSONL 追加（每决策一行 + 一条 summary）
 * 5. 默认 TTL=30 天对未设 ttlDays 的 entry 生效
 * 6. OOC_MEMORY_GC=1 env 等价于 forceRealDelete
 * 7. 空目录 → scanned=0，不写 log
 *
 * @ref kernel/src/persistence/memory-gc.ts
 * @ref docs/工程管理/迭代/all/20260422_feature_memory_curation_phase2.md — Phase 3
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendMemoryEntry,
  readMemoryEntries,
  writeMemoryEntry,
  type MemoryEntry,
} from "../src/persistence/memory-entries.js";
import {
  evaluateGcDecision,
  runMemoryGc,
  DEFAULT_TTL_DAYS,
} from "../src/persistence/memory-gc.js";
import { embeddingPath } from "../src/persistence/memory-embedding.js";

let tmp = "";
let selfDir = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mem-gc-"));
  selfDir = join(tmp, "stones", "bruce");
  mkdirSync(selfDir, { recursive: true });
  /* 测试不能被系统环境污染 */
  delete process.env.OOC_MEMORY_GC;
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  delete process.env.OOC_MEMORY_GC;
});

/** 构造一个带指定 createdAt 的 entry（绕过 appendMemoryEntry 的 now）*/
function makeEntry(opts: {
  id?: string;
  key: string;
  content: string;
  createdAt: string;
  pinned?: boolean;
  ttlDays?: number | null;
}): MemoryEntry {
  return {
    id: opts.id ?? `me_test_${Math.random().toString(36).slice(2, 10)}`,
    key: opts.key,
    content: opts.content,
    tags: [],
    category: "",
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
    pinned: opts.pinned ?? false,
    ttlDays: opts.ttlDays ?? null,
    source: { type: "test", stoneName: "bruce" },
  };
}

describe("evaluateGcDecision", () => {
  const now = new Date("2026-05-01T00:00:00Z").getTime();

  test("pinned → reason=pinned（无视 age）", () => {
    const e = makeEntry({
      key: "k",
      content: "c",
      createdAt: "2020-01-01T00:00:00Z", /* 远古 */
      pinned: true,
    });
    const d = evaluateGcDecision(e, now, 30);
    expect(d.reason).toBe("pinned");
    expect(d.pinned).toBe(true);
    expect(d.ttlDays).toBeNull();
  });

  test("ttlDays=7、age=3 天 → fresh", () => {
    const e = makeEntry({
      key: "k",
      content: "c",
      createdAt: "2026-04-28T00:00:00Z", /* 3 天前 */
      ttlDays: 7,
    });
    const d = evaluateGcDecision(e, now, 30);
    expect(d.reason).toBe("fresh");
    expect(d.ttlDays).toBe(7);
  });

  test("ttlDays=1、age=3 天 → expired", () => {
    const e = makeEntry({
      key: "k",
      content: "c",
      createdAt: "2026-04-28T00:00:00Z",
      ttlDays: 1,
    });
    const d = evaluateGcDecision(e, now, 30);
    expect(d.reason).toBe("expired");
  });

  test("ttlDays=null、age=10 天 → fresh（默认 30 天内）", () => {
    const e = makeEntry({
      key: "k",
      content: "c",
      createdAt: "2026-04-21T00:00:00Z", /* 10 天前 */
      ttlDays: null,
    });
    const d = evaluateGcDecision(e, now, 30);
    expect(d.reason).toBe("fresh");
    expect(d.ttlDays).toBe(30);
  });

  test("ttlDays=null、age=40 天 → expired（超过默认 30 天）", () => {
    const e = makeEntry({
      key: "k",
      content: "c",
      createdAt: "2026-03-20T00:00:00Z", /* ~42 天前 */
      ttlDays: null,
    });
    const d = evaluateGcDecision(e, now, 30);
    expect(d.reason).toBe("expired");
    expect(d.ttlDays).toBe(30);
  });
});

describe("runMemoryGc", () => {
  test("dry-run 默认不删文件但写 audit log", () => {
    const e = makeEntry({
      key: "old",
      content: "long gone",
      createdAt: "2020-01-01T00:00:00Z",
      ttlDays: 1,
    });
    writeMemoryEntry(selfDir, e);

    const summary = runMemoryGc(selfDir, "bruce");
    expect(summary.scanned).toBe(1);
    expect(summary.expired).toBe(1);
    expect(summary.deleted).toBe(0); /* dry-run */
    expect(summary.dryRun).toBe(true);

    /* 文件仍在 */
    expect(readMemoryEntries(selfDir).length).toBe(1);

    /* audit log 存在且有内容 */
    const logPath = join(selfDir, "memory", "gc.log");
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, "utf-8");
    expect(log).toContain("\"type\":\"decision\"");
    expect(log).toContain("\"type\":\"summary\"");
    expect(log).toContain("\"dryRun\":true");
  });

  test("forceRealDelete=true 物理删除 entry + embedding", () => {
    const created = appendMemoryEntry(selfDir, "bruce", {
      key: "old",
      content: "long gone",
      ttlDays: 1,
      createdAt: "2020-01-01T00:00:00Z",
    });
    /* embedding 是 appendMemoryEntry 顺带生成的 */
    expect(existsSync(embeddingPath(selfDir, created.id))).toBe(true);

    const summary = runMemoryGc(selfDir, "bruce", { forceRealDelete: true });
    expect(summary.deleted).toBe(1);
    expect(summary.dryRun).toBe(false);
    expect(readMemoryEntries(selfDir).length).toBe(0);
    expect(existsSync(embeddingPath(selfDir, created.id))).toBe(false);
  });

  test("OOC_MEMORY_GC=1 env 等价于 forceRealDelete", () => {
    appendMemoryEntry(selfDir, "bruce", {
      key: "old",
      content: "long gone",
      ttlDays: 1,
      createdAt: "2020-01-01T00:00:00Z",
    });
    process.env.OOC_MEMORY_GC = "1";
    const summary = runMemoryGc(selfDir, "bruce");
    expect(summary.dryRun).toBe(false);
    expect(summary.deleted).toBe(1);
  });

  test("pinned entry 跳过不删（即使显式 forceRealDelete）", () => {
    const pin = makeEntry({
      key: "important",
      content: "keep forever",
      createdAt: "2020-01-01T00:00:00Z",
      pinned: true,
    });
    writeMemoryEntry(selfDir, pin);

    const summary = runMemoryGc(selfDir, "bruce", { forceRealDelete: true });
    expect(summary.expired).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(readMemoryEntries(selfDir).length).toBe(1);
  });

  test("空目录 → scanned=0，无报错", () => {
    const summary = runMemoryGc(selfDir, "bruce");
    expect(summary.scanned).toBe(0);
    expect(summary.expired).toBe(0);
    expect(summary.deleted).toBe(0);
  });

  test("decision 顺序 + reason 在 summary 里可查", () => {
    writeMemoryEntry(selfDir, makeEntry({
      id: "me_a",
      key: "a",
      content: "expired",
      createdAt: "2020-01-01T00:00:00Z",
      ttlDays: 1,
    }));
    writeMemoryEntry(selfDir, makeEntry({
      id: "me_b",
      key: "b",
      content: "pinned",
      createdAt: "2020-01-01T00:00:00Z",
      pinned: true,
    }));
    writeMemoryEntry(selfDir, makeEntry({
      id: "me_c",
      key: "c",
      content: "fresh",
      createdAt: new Date().toISOString(),
      ttlDays: 30,
    }));

    const summary = runMemoryGc(selfDir, "bruce");
    expect(summary.decisions.length).toBe(3);
    const byId = Object.fromEntries(summary.decisions.map(d => [d.id, d]));
    expect(byId["me_a"]!.reason).toBe("expired");
    expect(byId["me_b"]!.reason).toBe("pinned");
    expect(byId["me_c"]!.reason).toBe("fresh");
  });

  test("DEFAULT_TTL_DAYS = 30", () => {
    expect(DEFAULT_TTL_DAYS).toBe(30);
  });
});
