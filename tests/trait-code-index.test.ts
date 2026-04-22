/**
 * code_index trait 单元测试
 *
 * 覆盖 symbol_lookup / find_references / list_symbols /
 * call_hierarchy / semantic_search / index_refresh。
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile as fsWriteFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  symbol_lookup,
  find_references,
  list_symbols,
  call_hierarchy,
  semantic_search,
  index_refresh,
  __resetCache,
} from "../traits/computable/code_index/index";

let tempDir: string;
let ctx: any;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ooc-code-index-test-"));
  ctx = { rootDir: tempDir };

  // Fixture：
  //   src/
  //     api.ts       — function fetchUser, class UserService, const API_URL, interface User
  //     consumer.ts  — 调用 fetchUser
  //     types.ts     — type UserId
  //   node_modules/
  //     pkg.ts       — 应被忽略

  await mkdir(join(tempDir, "src"), { recursive: true });
  await mkdir(join(tempDir, "node_modules"), { recursive: true });

  await fsWriteFile(
    join(tempDir, "src", "api.ts"),
    [
      "export const API_URL = 'https://example.com';",
      "",
      "export interface User {",
      "  id: string;",
      "  name: string;",
      "}",
      "",
      "export async function fetchUser(id: string): Promise<User> {",
      "  return { id, name: 'alice' };",
      "}",
      "",
      "export class UserService {",
      "  async get(id: string) {",
      "    return fetchUser(id);",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  await fsWriteFile(
    join(tempDir, "src", "consumer.ts"),
    [
      "import { fetchUser } from './api';",
      "",
      "export async function run() {",
      "  const u = await fetchUser('u1');",
      "  console.log(u.name);",
      "  return u;",
      "}",
      "",
    ].join("\n"),
  );

  await fsWriteFile(
    join(tempDir, "src", "types.ts"),
    ["export type UserId = string;", ""].join("\n"),
  );

  await fsWriteFile(
    join(tempDir, "node_modules", "pkg.ts"),
    "export function ignoredHelper() { return 1; }\n",
  );
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  __resetCache();
});

describe("symbol_lookup", () => {
  test("找到 function 定义", async () => {
    const r = await symbol_lookup(ctx, "fetchUser");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBeGreaterThan(0);
    const fn = r.data.find((s) => s.kind === "function");
    expect(fn).toBeDefined();
    expect(fn!.file).toBe("src/api.ts");
    expect(fn!.line).toBe(8);
  });

  test("找到 class 定义", async () => {
    const r = await symbol_lookup(ctx, "UserService");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cls = r.data.find((s) => s.kind === "class");
    expect(cls).toBeDefined();
    expect(cls!.file).toBe("src/api.ts");
  });

  test("找到 interface 定义", async () => {
    const r = await symbol_lookup(ctx, "User");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const iface = r.data.find((s) => s.kind === "interface");
    expect(iface).toBeDefined();
  });

  test("找到 type 定义", async () => {
    const r = await symbol_lookup(ctx, "UserId");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.data.find((s) => s.kind === "type");
    expect(t).toBeDefined();
    expect(t!.file).toBe("src/types.ts");
  });

  test("找到 const 定义", async () => {
    const r = await symbol_lookup(ctx, "API_URL");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.data.find((s) => s.kind === "const");
    expect(c).toBeDefined();
  });

  test("kind 过滤", async () => {
    const r = await symbol_lookup(ctx, "UserService", { kind: "function" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBe(0);
  });

  test("忽略 node_modules", async () => {
    const r = await symbol_lookup(ctx, "ignoredHelper");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBe(0);
  });

  test("未找到返回空数组", async () => {
    const r = await symbol_lookup(ctx, "zzzNotExistXxx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });
});

describe("find_references", () => {
  test("找到 fetchUser 的所有引用", async () => {
    const r = await find_references(ctx, "fetchUser");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const files = r.data.map((x) => x.file);
    expect(files).toContain("src/api.ts");
    expect(files).toContain("src/consumer.ts");
  });

  test("单词边界匹配：不匹配 fetchUserProfile", async () => {
    // 添加一个干扰符号
    await fsWriteFile(
      join(tempDir, "src", "decoy.ts"),
      "export function fetchUserProfile() { return 1; }\n",
    );
    __resetCache();
    const r = await find_references(ctx, "fetchUser");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // decoy.ts 里只有 fetchUserProfile，不含 \bfetchUser\b
    const hasDecoy = r.data.some((x) => x.file === "src/decoy.ts");
    expect(hasDecoy).toBe(false);
    // 清理
    await rm(join(tempDir, "src", "decoy.ts"));
  });
});

describe("list_symbols", () => {
  test("列出单文件符号", async () => {
    const r = await list_symbols(ctx, "src/api.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.data.map((s) => s.name);
    expect(names).toContain("fetchUser");
    expect(names).toContain("UserService");
    expect(names).toContain("User");
    expect(names).toContain("API_URL");
  });

  test("列出目录下所有符号", async () => {
    const r = await list_symbols(ctx, "src");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.data.map((s) => s.name);
    expect(names).toContain("fetchUser");
    expect(names).toContain("UserId");
  });

  test("kinds 过滤", async () => {
    const r = await list_symbols(ctx, "src/api.ts", { kinds: ["class"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of r.data) expect(s.kind).toBe("class");
  });
});

describe("call_hierarchy", () => {
  test("callers 返回引用（排除定义行）", async () => {
    const r = await call_hierarchy(ctx, "fetchUser", "callers");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // consumer.ts 里有调用
    const consumer = r.data.find((x) => x.file === "src/consumer.ts");
    expect(consumer).toBeDefined();
    // api.ts 的定义行（第 8 行）应被排除
    const defRef = r.data.find((x) => x.file === "src/api.ts" && x.line === 8);
    expect(defRef).toBeUndefined();
  });

  test("callees 未实现返回错误", async () => {
    const r = await call_hierarchy(ctx, "fetchUser", "callees");
    expect(r.ok).toBe(false);
  });
});

describe("semantic_search", () => {
  test("按 token 近似度排序：精确匹配优先", async () => {
    const r = await semantic_search(ctx, "user", 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBeGreaterThan(0);
    // 精确 token 匹配 "User" 应排在最前
    expect(r.data[0]!.name).toBe("User");
  });

  test("子串匹配返回候选", async () => {
    const r = await semantic_search(ctx, "fetchUser", 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.data.map((x) => x.name);
    // 精确 token "fetchuser" 只匹配同名符号
    expect(names).toContain("fetchUser");
  });
});

describe("index_refresh", () => {
  test("重建索引返回统计", async () => {
    const r = await index_refresh(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.fileCount).toBeGreaterThan(0);
    expect(r.data.symbolCount).toBeGreaterThan(0);
    expect(r.data.builtAt).toBeGreaterThan(0);
  });
});
