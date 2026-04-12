/**
 * file_search trait 单元测试
 *
 * 测试 glob（文件名模式匹配）和 grep（文件内容搜索）两个方法。
 * 使用临时目录作为 fixture，测试完毕后清理。
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile as fsWriteFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { glob, grep } from "../traits/computable/file_search/index";

/** 临时测试目录 */
let tempDir: string;

/** 模拟上下文，rootDir 指向临时目录 */
let ctx: any;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ooc-file-search-test-"));
  ctx = { rootDir: tempDir };

  // 创建 fixture 文件结构
  // src/
  //   index.ts    — 包含 "export function main"
  //   utils.ts    — 包含 "export function helper" 和 "TODO: refactor"
  //   deep/
  //     nested.ts — 包含 "deep nested content"
  // lib/
  //   helper.js   — 包含 "module.exports = helper"
  // node_modules/
  //   pkg.ts      — 应被忽略
  // .git/
  //   config      — 应被忽略

  await mkdir(join(tempDir, "src", "deep"), { recursive: true });
  await mkdir(join(tempDir, "lib"), { recursive: true });
  await mkdir(join(tempDir, "node_modules"), { recursive: true });
  await mkdir(join(tempDir, ".git"), { recursive: true });

  await fsWriteFile(
    join(tempDir, "src", "index.ts"),
    'export function main() {\n  console.log("hello");\n}\n',
  );
  await fsWriteFile(
    join(tempDir, "src", "utils.ts"),
    'export function helper() {\n  // TODO: refactor this\n  return 42;\n}\n',
  );
  await fsWriteFile(
    join(tempDir, "src", "deep", "nested.ts"),
    'export const value = "deep nested content";\n',
  );
  await fsWriteFile(
    join(tempDir, "lib", "helper.js"),
    'module.exports = function helper() { return "js helper"; };\n',
  );
  await fsWriteFile(
    join(tempDir, "node_modules", "pkg.ts"),
    'export const pkg = "should be ignored";\n',
  );
  await fsWriteFile(
    join(tempDir, ".git", "config"),
    "[core]\n  bare = false\n",
  );
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── glob ───────────────────────────────────────────────

describe("glob", () => {
  test("匹配所有 .ts 文件", async () => {
    const result = await glob(ctx, "**/*.ts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 应包含 src 下的 ts 文件
    expect(result.data).toContain("src/index.ts");
    expect(result.data).toContain("src/utils.ts");
    expect(result.data).toContain("src/deep/nested.ts");
  });

  test("默认忽略 node_modules 和 .git", async () => {
    const result = await glob(ctx, "**/*.ts");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // node_modules 下的文件不应出现
    const hasNodeModules = result.data.some((p) =>
      p.includes("node_modules"),
    );
    expect(hasNodeModules).toBe(false);

    // .git 下的文件不应出现
    const hasGit = result.data.some((p) => p.includes(".git"));
    expect(hasGit).toBe(false);
  });

  test("limit 限制返回数量", async () => {
    const result = await glob(ctx, "**/*.ts", { limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.length).toBeLessThanOrEqual(2);
  });

  test("basePath 限定搜索目录", async () => {
    const result = await glob(ctx, "*.js", { basePath: "lib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toContain("helper.js");
    // 不应包含 src 下的文件
    const hasSrc = result.data.some((p) => p.includes("src"));
    expect(hasSrc).toBe(false);
  });

  test("无匹配返回空数组", async () => {
    const result = await glob(ctx, "**/*.xyz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual([]);
  });
});

// ─── grep ───────────────────────────────────────────────

describe("grep", () => {
  test("搜索文件内容", async () => {
    const result = await grep(ctx, "export function");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 应在 index.ts 和 utils.ts 中找到匹配
    const files = result.data.map((m) => m.file);
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/utils.ts");

    // 每条结果应有行号和内容
    for (const match of result.data) {
      expect(match.line).toBeGreaterThan(0);
      expect(match.content.length).toBeGreaterThan(0);
    }
  });

  test("glob 过滤文件类型", async () => {
    const result = await grep(ctx, "helper", { glob: "*.js" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 只应在 .js 文件中找到
    for (const match of result.data) {
      expect(match.file).toMatch(/\.js$/);
    }
    expect(result.data.length).toBeGreaterThan(0);
  });

  test("ignoreCase 忽略大小写", async () => {
    const result = await grep(ctx, "todo", { ignoreCase: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 应找到 "TODO: refactor" （大写 TODO 匹配小写 todo）
    expect(result.data.length).toBeGreaterThan(0);
    const contents = result.data.map((m) => m.content).join(" ");
    expect(contents.toLowerCase()).toContain("todo");
  });

  test("maxResults 限制结果数量", async () => {
    const result = await grep(ctx, "export", { maxResults: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.length).toBeLessThanOrEqual(1);
  });

  test("无匹配返回空数组", async () => {
    const result = await grep(ctx, "zzz_nonexistent_pattern_zzz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual([]);
  });

  test("路径为相对于 rootDir 的相对路径", async () => {
    const result = await grep(ctx, "deep nested content");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.length).toBe(1);
    // 路径应是相对路径，不包含临时目录前缀
    expect(result.data[0]!.file).toBe("src/deep/nested.ts");
    expect(result.data[0]!.file.startsWith("/")).toBe(false);
  });
});
