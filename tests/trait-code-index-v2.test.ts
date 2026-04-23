/**
 * code_index v2 单元测试
 *
 * 覆盖：
 *   - tree-sitter AST 提取 signature/docstring 精度
 *   - callees 方向调用链
 *   - 增量 index_refresh（paths 传入只刷新这些文件）
 *   - semantic_search 真向量（cosine）
 *   - vectors.json 落盘
 *   - code-index-refresh build hook（OOC_CODE_INDEX_HOOK=1 路径）
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile as fsWriteFile, readFile as fsReadFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  symbol_lookup,
  list_symbols,
  call_hierarchy,
  semantic_search,
  index_refresh,
  __resetCache,
  type SymbolEntry,
} from "../traits/computable/code_index/index";
import {
  codeIndexRefreshHook,
  __clearHooks,
  registerBuildHook,
  runBuildHooks,
} from "../src/world/hooks";

let tempDir: string;
let ctx: any;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ooc-code-index-v2-"));
  ctx = { rootDir: tempDir };

  await mkdir(join(tempDir, "src"), { recursive: true });

  await fsWriteFile(
    join(tempDir, "src", "api.ts"),
    [
      "/**",
      " * 用户服务相关函数",
      " * 包含 fetchUser 和 UserService class",
      " */",
      "export const API_URL = 'https://example.com';",
      "",
      "export interface User {",
      "  id: string;",
      "  name: string;",
      "}",
      "",
      "/** 根据 id 查询用户 */",
      "export async function fetchUser(id: string): Promise<User> {",
      "  return { id, name: 'alice' };",
      "}",
      "",
      "/** 用户服务类 */",
      "export class UserService {",
      "  async get(id: string) {",
      "    const res = await fetchUser(id);",
      "    console.log(res);",
      "    return res;",
      "  }",
      "}",
    ].join("\n"),
  );

  await fsWriteFile(
    join(tempDir, "src", "math.ts"),
    [
      "/** 计算两数之和 */",
      "export function sumNumbers(a: number, b: number): number {",
      "  return a + b;",
      "}",
      "",
      "/** 计算数组均值 */",
      "export function averageNumbers(arr: number[]): number {",
      "  let s = 0;",
      "  for (const n of arr) s = sumNumbers(s, n);",
      "  return s / arr.length;",
      "}",
    ].join("\n"),
  );
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  __resetCache();
});

describe("v2: tree-sitter signature & docstring", () => {
  test("symbol_lookup 返回 signature 和 docstring（AST 路径）", async () => {
    const r = await symbol_lookup(ctx, "fetchUser");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fn = r.data.find((s: SymbolEntry) => s.kind === "function")!;
    expect(fn).toBeDefined();
    expect(fn.signature).toBeDefined();
    expect(fn.signature!.length).toBeGreaterThan(0);
    expect(fn.signature).toContain("fetchUser");
    expect(fn.docstring).toBeDefined();
    expect(fn.docstring).toContain("根据 id 查询用户");
  });

  test("endLine 字段存在", async () => {
    const r = await list_symbols(ctx, "src/api.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of r.data) {
      if (s.kind === "function" || s.kind === "class") {
        expect(s.endLine).toBeDefined();
        expect(s.endLine!).toBeGreaterThanOrEqual(s.line);
      }
    }
  });
});

describe("v2: callees AST 调用图", () => {
  test("UserService.get 内部调用 fetchUser", async () => {
    const r = await call_hierarchy(ctx, "UserService", "callees");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const callees = r.data.map((x) => x.content);
    expect(callees).toContain("fetchUser");
  });

  test("averageNumbers 调用 sumNumbers", async () => {
    const r = await call_hierarchy(ctx, "averageNumbers", "callees");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const callees = r.data.map((x) => x.content);
    expect(callees).toContain("sumNumbers");
  });

  test("callees 返回 content=被调用名", async () => {
    const r = await call_hierarchy(ctx, "averageNumbers", "callees");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data[0]!.file).toBe("src/math.ts");
  });
});

describe("v2: 增量 index_refresh", () => {
  test("传 paths 增量刷新只重扫该文件", async () => {
    /* 先建立完整索引 */
    await symbol_lookup(ctx, "fetchUser");

    /* 新增一个文件 */
    await fsWriteFile(
      join(tempDir, "src", "new.ts"),
      "export function brandNewFn() { return 42; }\n",
    );

    /* 增量 */
    const refresh = await index_refresh(ctx, ["src/new.ts"]);
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect(refresh.data.incremental).toBe(true);
    expect(refresh.data.touched).toBe(1);

    /* 现在应该能查到 */
    const r = await symbol_lookup(ctx, "brandNewFn");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBe(1);
    expect(r.data[0]!.file).toBe("src/new.ts");
  });

  test("增量后删除文件再刷新，符号被移出索引", async () => {
    await fsWriteFile(
      join(tempDir, "src", "temp.ts"),
      "export function tempFn() {}\n",
    );
    await index_refresh(ctx, ["src/temp.ts"]);
    const r1 = await symbol_lookup(ctx, "tempFn");
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.data.length).toBe(1);

    await rm(join(tempDir, "src", "temp.ts"));
    await index_refresh(ctx, ["src/temp.ts"]);
    const r2 = await symbol_lookup(ctx, "tempFn");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data.length).toBe(0);
  });

  test("不传 paths 走全量重建", async () => {
    const r = await index_refresh(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.incremental).toBe(false);
    expect(r.data.touched).toBe(r.data.fileCount);
  });
});

describe("v2: 向量 semantic_search", () => {
  test("对文本查询返回按 cosine 相似度排序的结果", async () => {
    /* query 指向 fetchUser 的 docstring 关键词 */
    const r = await semantic_search(ctx, "根据 id 查询用户", 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBeGreaterThan(0);
    /* top1 应该是 fetchUser（它 docstring 命中） */
    const names = r.data.map((x) => x.name);
    expect(names[0]).toBe("fetchUser");
    /* score 是 number 且降序 */
    for (let i = 1; i < r.data.length; i++) {
      expect(r.data[i - 1]!.score).toBeGreaterThanOrEqual(r.data[i]!.score);
    }
  });

  test("精确名字查询命中对应符号", async () => {
    /* hash n-gram 分词把 sumNumbers 作为整 token 处理；
       用精确名或 docstring 关键词查询都应能命中。 */
    const r = await semantic_search(ctx, "sumNumbers 两数", 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.data.map((x) => x.name);
    expect(names).toContain("sumNumbers");
  });
});

describe("v2: vectors.json 落盘", () => {
  test("首次构建后 .ooc/code-index/vectors.json 存在", async () => {
    __resetCache();
    await index_refresh(ctx); /* 全量重建触发持久化 */
    const p = join(tempDir, ".ooc", "code-index", "vectors.json");
    const raw = await fsReadFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.dim).toBe(256);
    expect(typeof parsed.entries).toBe("object");
    const keys = Object.keys(parsed.entries);
    expect(keys.length).toBeGreaterThan(0);
    /* 向量维度正确 */
    for (const k of keys.slice(0, 3)) {
      expect(parsed.entries[k].length).toBe(256);
    }
  });
});

describe("v2: code-index-refresh build hook", () => {
  test("写入一个文件后 hook 触发，增量索引更新", async () => {
    __clearHooks();
    registerBuildHook(codeIndexRefreshHook);

    /* 准备一个还没被索引的新文件 */
    await fsWriteFile(
      join(tempDir, "src", "hooked.ts"),
      "export function hookedFn() { return 'hello'; }\n",
    );

    __resetCache(); /* 清空索引；hook 触发会走增量 */
    /* 先冷建立基础索引（不包含 hooked.ts 的变更前状态——此处 hooked.ts 已写好） */
    /* 既然 cache 被清，getSnapshot 会重扫，故 hooked.ts 已在索引里 */
    /* 为更严格测试 hook 的增量逻辑：先改文件内容，再调 hook */
    await symbol_lookup(ctx, "hookedFn"); /* 触发初次 build */
    await fsWriteFile(
      join(tempDir, "src", "hooked.ts"),
      "export function hookedFn() { return 'world'; }\nexport function extraFn() {}\n",
    );

    const fbs = await runBuildHooks(["src/hooked.ts"], { rootDir: tempDir });
    expect(fbs.length).toBeGreaterThan(0);
    /* hook 自身 success=true（即使失败也不阻塞） */
    expect(fbs.every((f) => f.success)).toBe(true);
    /* 索引更新：应能查到新加的 extraFn */
    const r = await symbol_lookup(ctx, "extraFn");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBe(1);
    expect(r.data[0]!.file).toBe("src/hooked.ts");

    __clearHooks();
  });
});
