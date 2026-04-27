/**
 * memory-entries.ts 单元测试
 *
 * 覆盖：
 * - parseMemoryMd（各种 heading 格式）
 * - migrateMemoryMdToEntries 幂等性
 * - readMemoryEntries / appendMemoryEntry / writeMemoryEntry
 * - queryMemoryEntries（query / tags / since / onlyPinned / TTL）
 * - mergeDuplicateEntries
 * - rebuildMemoryIndex
 * - generateEntryId 稳定性
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMemoryMd,
  parseDateStampOrNow,
  generateEntryId,
  migrateMemoryMdToEntries,
  readMemoryEntries,
  appendMemoryEntry,
  queryMemoryEntries,
  rebuildMemoryIndex,
  mergeDuplicateEntries,
  writeMemoryEntry,
  isMemoryEntry,
  type MemoryEntry,
} from "../src/persistence/memory-entries";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mem-entries-"));
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("generateEntryId", () => {
  test("同 key+content 生成相同 id", () => {
    const a = generateEntryId("k", "c", "2026-04-22T10:00:00Z");
    const b = generateEntryId("k", "c", "2026-04-22T10:00:00Z");
    expect(a).toBe(b);
  });
  test("不同 content 生成不同 id", () => {
    const a = generateEntryId("k", "c1", "2026-04-22T10:00:00Z");
    const b = generateEntryId("k", "c2", "2026-04-22T10:00:00Z");
    expect(a).not.toBe(b);
  });
  test("id 带 YYYYMMDD 前缀", () => {
    const id = generateEntryId("k", "c", "2026-04-22T10:00:00Z");
    expect(id.startsWith("me_20260422_")).toBe(true);
  });
});

describe("parseDateStampOrNow", () => {
  test("YYYY-MM-DD HH:MM 解析为 ISO", () => {
    const s = parseDateStampOrNow("2026-04-22 10:30");
    expect(s.startsWith("2026-04-22T10:30")).toBe(true);
  });
  test("YYYY-MM-DD 无时间部分，默认 00:00", () => {
    const s = parseDateStampOrNow("2026-04-22");
    expect(s.startsWith("2026-04-22T00:00")).toBe(true);
  });
  test("非法字符串回退当前时间", () => {
    const s = parseDateStampOrNow("not a date");
    expect(s.length).toBeGreaterThan(10); /* ISO 串 */
  });
  test("空字符串回退当前时间", () => {
    const s = parseDateStampOrNow("");
    expect(s.length).toBeGreaterThan(10);
  });
});

describe("parseMemoryMd", () => {
  test("解析标准 `## key（YYYY-MM-DD HH:MM）` 段落", () => {
    const md = [
      "# Memory",
      "",
      "## 经验 A（2026-04-22 10:00）",
      "",
      "aaa 内容",
      "bbb 行",
      "",
      "## 经验 B（2026-04-23 11:30）",
      "",
      "bbb 内容",
    ].join("\n");
    const sections = parseMemoryMd(md);
    expect(sections.length).toBe(2);
    expect(sections[0]!.key).toBe("经验 A");
    expect(sections[0]!.stamp).toBe("2026-04-22 10:00");
    expect(sections[0]!.content).toContain("aaa 内容");
    expect(sections[0]!.content).toContain("bbb 行");
    expect(sections[1]!.key).toBe("经验 B");
  });

  test("没时间戳的段落 stamp 为空", () => {
    const md = "## 经验 A\n\n内容";
    const sections = parseMemoryMd(md);
    expect(sections.length).toBe(1);
    expect(sections[0]!.key).toBe("经验 A");
    expect(sections[0]!.stamp).toBe("");
  });

  test("顶级 # 不被当作段落", () => {
    const md = "# Title\n\n纯文本段";
    const sections = parseMemoryMd(md);
    expect(sections.length).toBe(0);
  });

  test("空 body 段落被丢弃", () => {
    const md = "## 只有标题\n\n## 有内容\n\n文本";
    const sections = parseMemoryMd(md);
    expect(sections.length).toBe(1);
    expect(sections[0]!.key).toBe("有内容");
  });
});

describe("migrateMemoryMdToEntries", () => {
  test("无 memory.md → 返回 0/0/0", () => {
    const r = migrateMemoryMdToEntries(tmp, "alice");
    expect(r).toEqual({ created: 0, existing: 0, total: 0 });
  });

  test("首次迁移：所有段落被创建", () => {
    writeFileSync(
      join(tmp, "memory.md"),
      "# Alice Memory\n\n## A（2026-04-22 10:00）\n\naaa\n\n## B（2026-04-22 11:00）\n\nbbb",
    );
    const r = migrateMemoryMdToEntries(tmp, "alice");
    expect(r.total).toBe(2);
    expect(r.created).toBe(2);
    expect(r.existing).toBe(0);

    const entries = readMemoryEntries(tmp);
    expect(entries.length).toBe(2);
    expect(entries.map(e => e.key).sort()).toEqual(["A", "B"]);
    expect(entries.every(e => e.source.type === "migrate_from_md")).toBe(true);
    expect(entries.every(e => e.source.stoneName === "alice")).toBe(true);
  });

  test("重跑幂等：所有段落被识别为已存在", () => {
    writeFileSync(
      join(tmp, "memory.md"),
      "## A（2026-04-22 10:00）\n\naaa",
    );
    const first = migrateMemoryMdToEntries(tmp, "alice");
    expect(first.created).toBe(1);
    const second = migrateMemoryMdToEntries(tmp, "alice");
    expect(second.created).toBe(0);
    expect(second.existing).toBe(1);
    expect(readMemoryEntries(tmp).length).toBe(1);
  });

  test("不删除 memory.md（readonly snapshot）", () => {
    const mdPath = join(tmp, "memory.md");
    writeFileSync(mdPath, "## A（2026-04-22 10:00）\n\naaa");
    migrateMemoryMdToEntries(tmp, "alice");
    expect(existsSync(mdPath)).toBe(true);
  });
});

describe("appendMemoryEntry / readMemoryEntries", () => {
  test("append 新条目", () => {
    const e = appendMemoryEntry(tmp, "alice", { key: "经验", content: "内容" });
    expect(e.key).toBe("经验");
    expect(e.source.stoneName).toBe("alice");
    expect(readMemoryEntries(tmp).length).toBe(1);
  });

  test("append 同 key 同 content → 合并 updatedAt，content/createdAt 不变", () => {
    const first = appendMemoryEntry(tmp, "alice", { key: "k", content: "c" });
    const second = appendMemoryEntry(tmp, "alice", { key: "k", content: "c", tags: ["x"] });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.tags).toContain("x");
    expect(readMemoryEntries(tmp).length).toBe(1);
  });

  test("append 不同 content → 新 id", () => {
    const a = appendMemoryEntry(tmp, "alice", { key: "k", content: "c1" });
    const b = appendMemoryEntry(tmp, "alice", { key: "k", content: "c2" });
    expect(a.id).not.toBe(b.id);
    expect(readMemoryEntries(tmp).length).toBe(2);
  });
});

describe("queryMemoryEntries", () => {
  beforeEach(() => {
    appendMemoryEntry(tmp, "alice", {
      key: "调试 API",
      content: "curl 先测端口，然后看响应",
      tags: ["debugging", "api"],
      category: "workflow",
    });
    appendMemoryEntry(tmp, "alice", {
      key: "命名规范",
      content: "avoid abbreviations",
      tags: ["style"],
      category: "code",
    });
    appendMemoryEntry(tmp, "alice", {
      key: "过期 entry",
      content: "old",
      tags: ["expired"],
      ttlDays: 1,
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    });
  });

  test("无过滤返回非过期条目", () => {
    const r = queryMemoryEntries(tmp, {});
    /* "过期 entry" 默认被 TTL 过滤 */
    expect(r.length).toBe(2);
  });

  test("includeExpired=true 包含过期条目", () => {
    const r = queryMemoryEntries(tmp, { includeExpired: true });
    expect(r.length).toBe(3);
  });

  test("query 模糊匹配 content", () => {
    const r = queryMemoryEntries(tmp, { query: "curl" });
    expect(r.length).toBe(1);
    expect(r[0]!.key).toBe("调试 API");
  });

  test("query 模糊匹配 tag", () => {
    const r = queryMemoryEntries(tmp, { query: "debugging" });
    expect(r.length).toBe(1);
  });

  test("按 tag 过滤（任一命中）", () => {
    const r = queryMemoryEntries(tmp, { tags: ["style"] });
    expect(r.length).toBe(1);
    expect(r[0]!.key).toBe("命名规范");
  });

  test("按 since 过滤", () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const r = queryMemoryEntries(tmp, { since: future });
    expect(r.length).toBe(0);
  });

  test("limit 截断", () => {
    const r = queryMemoryEntries(tmp, { limit: 1 });
    expect(r.length).toBe(1);
  });

  test("onlyPinned=true 过滤非 pinned", () => {
    /* 手动 pin 一条 */
    const entries = readMemoryEntries(tmp);
    writeMemoryEntry(tmp, { ...entries[0]!, pinned: true });
    const r = queryMemoryEntries(tmp, { onlyPinned: true });
    expect(r.length).toBe(1);
    expect(r[0]!.pinned).toBe(true);
  });
});

describe("mergeDuplicateEntries", () => {
  test("同 key 的多条被合并为一条", () => {
    appendMemoryEntry(tmp, "alice", { key: "k", content: "c1", tags: ["a"] });
    appendMemoryEntry(tmp, "alice", { key: "k", content: "c2", tags: ["b"] });
    appendMemoryEntry(tmp, "alice", { key: "k", content: "c3", tags: ["c"], pinned: true });
    expect(readMemoryEntries(tmp).length).toBe(3);

    const stats = mergeDuplicateEntries(tmp);
    expect(stats.merged).toBe(2);
    expect(stats.kept).toBe(1);

    const left = readMemoryEntries(tmp);
    expect(left.length).toBe(1);
    expect(left[0]!.tags.sort()).toEqual(["a", "b", "c"]);
    expect(left[0]!.pinned).toBe(true); /* 任一 pinned → pinned */
    /* content 含所有原始行 */
    expect(left[0]!.content).toContain("c1");
    expect(left[0]!.content).toContain("c2");
    expect(left[0]!.content).toContain("c3");
  });

  test("单条 entry 不被合并", () => {
    appendMemoryEntry(tmp, "alice", { key: "k", content: "c" });
    const stats = mergeDuplicateEntries(tmp);
    expect(stats.merged).toBe(0);
    expect(stats.kept).toBe(1);
  });
});

describe("rebuildMemoryIndex", () => {
  test("生成 index.md 含 pinned / recent 区段", () => {
    appendMemoryEntry(tmp, "alice", { key: "pinned A", content: "a", pinned: true });
    appendMemoryEntry(tmp, "alice", { key: "recent B", content: "b", tags: ["x"] });
    const body = rebuildMemoryIndex(tmp, "alice");
    expect(body).toContain("# Memory Index — alice");
    expect(body).toContain("## Pinned");
    expect(body).toContain("## Recent");
    expect(body).toContain("pinned A");
    expect(body).toContain("recent B");
    expect(body).toContain("#x");
    /* 文件落盘 */
    const raw = readFileSync(join(tmp, "memory", "index.md"), "utf-8");
    expect(raw).toBe(body);
  });

  test("空 entries → 仍生成合法文件", () => {
    const body = rebuildMemoryIndex(tmp, "alice");
    expect(body).toContain("# Memory Index — alice");
    expect(body).toContain("共 0 条");
  });
});

describe("isMemoryEntry 类型守卫", () => {
  test("合法对象 true", () => {
    const e: MemoryEntry = {
      id: "me_x",
      key: "k",
      content: "c",
      tags: [],
      category: "",
      createdAt: "2026-04-22T10:00:00Z",
      updatedAt: "2026-04-22T10:00:00Z",
      pinned: false,
      ttlDays: null,
      source: { type: "t", stoneName: "a" },
    };
    expect(isMemoryEntry(e)).toBe(true);
  });
  test("缺字段 false", () => {
    expect(isMemoryEntry({ id: "x" })).toBe(false);
    expect(isMemoryEntry(null)).toBe(false);
    expect(isMemoryEntry(undefined)).toBe(false);
    expect(isMemoryEntry("string")).toBe(false);
  });
});
