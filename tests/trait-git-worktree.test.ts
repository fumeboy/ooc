/**
 * git/worktree trait 单元测试
 *
 * 测试 defaultWorktreePath 规范化 + 输入校验。
 * 不创建真实 worktree（会污染仓库），E2E 留给集成测试。
 */

import { describe, test, expect } from "bun:test";
import {
  defaultWorktreePath,
  worktreeAdd,
  worktreeRemove,
  worktreeList,
  llm_methods,
} from "../../library/traits/git/worktree/index";
import { resolve } from "path";

describe("git/worktree — defaultWorktreePath", () => {
  test("分支 'feat/login' → '.ooc/worktrees/feat-login'", () => {
    expect(defaultWorktreePath("feat/login")).toBe(".ooc/worktrees/feat-login");
  });
  test("分支 'a/b/c' → '.ooc/worktrees/a-b-c'", () => {
    expect(defaultWorktreePath("a/b/c")).toBe(".ooc/worktrees/a-b-c");
  });
  test("分支 'main' → '.ooc/worktrees/main'", () => {
    expect(defaultWorktreePath("main")).toBe(".ooc/worktrees/main");
  });
});

describe("git/worktree — 输入校验", () => {
  const ctx = { rootDir: "/nonexistent" } as any;
  test("worktreeAdd: branch 缺失应返回 error", async () => {
    const r = await worktreeAdd(ctx, { branch: "" });
    expect(r.ok).toBe(false);
  });
  test("worktreeRemove: path 缺失应返回 error", async () => {
    const r = await worktreeRemove(ctx, { path: "" });
    expect(r.ok).toBe(false);
  });
});

describe("git/worktree — llm_methods 契约", () => {
  test("应导出 worktree_add / worktree_remove / worktree_list", () => {
    expect(llm_methods.worktree_add).toBeDefined();
    expect(llm_methods.worktree_remove).toBeDefined();
    expect(llm_methods.worktree_list).toBeDefined();
  });
});

describe("git/worktree — worktreeList 在真实仓库上应至少返回主工作区", () => {
  const KERNEL_DIR = resolve(import.meta.dir, "..");
  test("解析 porcelain 输出得到非空列表", async () => {
    const r = await worktreeList({ rootDir: KERNEL_DIR } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.length).toBeGreaterThan(0);
    /* 主工作区的 path 应非空 */
    expect(r.data[0].path.length).toBeGreaterThan(0);
  });
});
