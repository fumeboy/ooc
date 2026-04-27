/**
 * kernel/reflective/memory_api 和 super 新增 memory-curation 方法的单元测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llm_methods as memoryApiMethods } from "../traits/reflective/memory_api/index";
import { llm_methods as superMethods } from "../traits/reflective/super/index";
import {
  appendMemoryEntry,
  readMemoryEntries,
} from "../src/persistence/memory-entries";

type TestMethod = {
  fn: (ctx: unknown, args: Record<string, unknown>) => Promise<any>;
};

const memoryMethods = memoryApiMethods as Record<string, TestMethod>;
const supervisorMethods = superMethods as Record<string, TestMethod>;

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mem-api-"));
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("memory_api.query_memory", () => {
  test("空目录 → 返回 total=0 entries=[]", async () => {
    const r = await memoryMethods.query_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { total: number; entries: any[] };
    expect(d.total).toBe(0);
    expect(d.entries).toEqual([]);
  });

  test("有条目 → 返回 summary（含 contentPreview）", async () => {
    const longContent = "x".repeat(500);
    appendMemoryEntry(tmp, "alice", { key: "K", content: longContent, tags: ["t"] });
    const r = await memoryMethods.query_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { total: number; entries: any[] };
    expect(d.total).toBe(1);
    expect(d.entries[0]!.contentPreview.length).toBeLessThan(longContent.length);
    expect(d.entries[0]!.contentPreview.endsWith("…")).toBe(true);
    expect(d.entries[0]!.key).toBe("K");
    expect(d.entries[0]!.tags).toEqual(["t"]);
  });

  test("query 过滤生效", async () => {
    appendMemoryEntry(tmp, "alice", { key: "debug", content: "API 调试方法" });
    appendMemoryEntry(tmp, "alice", { key: "style", content: "命名规范" });
    const r = await memoryMethods.query_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { query: "API" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { total: number; entries: any[] };
    expect(d.total).toBe(1);
    expect(d.entries[0]!.key).toBe("debug");
  });
});

describe("memory_api.get_memory_entry", () => {
  test("不存在 id → error", async () => {
    const r = await memoryMethods.get_memory_entry!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: "me_nonexistent" },
    );
    expect(r.ok).toBe(false);
  });

  test("存在 id → 返回完整 entry", async () => {
    const e = appendMemoryEntry(tmp, "alice", { key: "k", content: "c" });
    const r = await memoryMethods.get_memory_entry!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: e.id },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { id: string; content: string };
    expect(d.id).toBe(e.id);
    expect(d.content).toBe("c");
  });
});

describe("super.migrate_memory_md", () => {
  test("老 memory.md → 结构化 entries + index.md", async () => {
    writeFileSync(
      join(tmp, "memory.md"),
      "## A（2026-04-22 10:00）\n\naaa\n\n## B（2026-04-22 11:00）\n\nbbb",
    );
    const r = await supervisorMethods.migrate_memory_md!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { total: number; created: number; existing: number };
    expect(d.created).toBe(2);
    expect(d.total).toBe(2);
    /* index.md 应生成 */
    expect(existsSync(join(tmp, "memory", "index.md"))).toBe(true);
    /* 老 memory.md 仍在 */
    expect(existsSync(join(tmp, "memory.md"))).toBe(true);
  });

  test("无 memory.md → total=0 不报错", async () => {
    const r = await supervisorMethods.migrate_memory_md!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      {},
    );
    expect(r.ok).toBe(true);
  });
});

describe("super.pin_memory / set_memory_ttl", () => {
  test("pin_memory 非法 id → error", async () => {
    const r = await supervisorMethods.pin_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: "nonexistent" },
    );
    expect(r.ok).toBe(false);
  });

  test("pin_memory 合法 id → pinned=true，index 反映", async () => {
    const e = appendMemoryEntry(tmp, "alice", { key: "k", content: "c" });
    const r = await supervisorMethods.pin_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: e.id },
    );
    expect(r.ok).toBe(true);
    const entries = readMemoryEntries(tmp);
    expect(entries[0]!.pinned).toBe(true);
    const indexBody = readFileSync(join(tmp, "memory", "index.md"), "utf-8");
    expect(indexBody).toContain("## Pinned");
  });

  test("pin_memory 取消固化", async () => {
    const e = appendMemoryEntry(tmp, "alice", { key: "k", content: "c" });
    await supervisorMethods.pin_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: e.id },
    );
    await supervisorMethods.pin_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: e.id, pinned: false },
    );
    const entries = readMemoryEntries(tmp);
    expect(entries[0]!.pinned).toBe(false);
  });

  test("set_memory_ttl", async () => {
    const e = appendMemoryEntry(tmp, "alice", { key: "k", content: "c" });
    const r = await supervisorMethods.set_memory_ttl!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { id: e.id, ttlDays: 7 },
    );
    expect(r.ok).toBe(true);
    const entries = readMemoryEntries(tmp);
    expect(entries[0]!.ttlDays).toBe(7);
  });
});

describe("super.merge_memory_duplicates", () => {
  test("同 key 多条 → 合并", async () => {
    appendMemoryEntry(tmp, "alice", { key: "k", content: "c1" });
    appendMemoryEntry(tmp, "alice", { key: "k", content: "c2" });
    const r = await supervisorMethods.merge_memory_duplicates!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data as { merged: number; kept: number };
    expect(d.merged).toBe(1);
    expect(d.kept).toBe(1);
  });
});

describe("super.persist_to_memory 写入结构化 entries", () => {
  test("调用 persist_to_memory 后，memory.md 和 entries/ 都被写入", async () => {
    const r = await supervisorMethods.persist_to_memory!.fn(
      { selfDir: tmp, stoneName: "alice" } as any,
      { key: "新经验", content: "新内容" },
    );
    expect(r.ok).toBe(true);
    /* 老路径：memory.md */
    const mdPath = join(tmp, "memory.md");
    expect(existsSync(mdPath)).toBe(true);
    const md = readFileSync(mdPath, "utf-8");
    expect(md).toContain("## 新经验");
    /* 新路径：entries */
    const entries = readMemoryEntries(tmp);
    expect(entries.length).toBe(1);
    expect(entries[0]!.key).toBe("新经验");
    /* index.md 已生成 */
    expect(existsSync(join(tmp, "memory", "index.md"))).toBe(true);
  });
});
