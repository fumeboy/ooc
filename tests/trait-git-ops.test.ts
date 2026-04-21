/**
 * git_ops trait 单元测试
 *
 * 只测试只读操作（status/diff/log），避免修改仓库状态。
 * 使用项目自身作为测试 git 仓库。
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import {
  gitStatus,
  gitLog,
  gitDiff,
} from "../../library/traits/git/ops/index";

/**
 * 模拟上下文，rootDir 指向 kernel/ 目录（它是一个独立的 git 仓库 / submodule）。
 *
 * 用相对于测试文件的路径解析，避免对 process.cwd() 的依赖——
 * `bun test` 在 kernel/ 下运行时 cwd 是 kernel/，拼 "kernel" 会得到错误路径 kernel/kernel。
 * 使用 resolve(import.meta.dir, "..") 得到 kernel/ 目录本身，稳定可复现。
 */
const KERNEL_DIR = resolve(import.meta.dir, "..");
const mockCtx = { rootDir: KERNEL_DIR } as any;

// ─── gitStatus ────────────────────────────────────────────

describe("gitStatus", () => {
  test("返回工作区状态，包含分支和文件列表", async () => {
    const result = await gitStatus(mockCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(typeof result.data.branch).toBe("string");
    expect(result.data.branch.length).toBeGreaterThan(0);
    expect(typeof result.data.ahead).toBe("number");
    expect(typeof result.data.behind).toBe("number");
    expect(Array.isArray(result.data.staged)).toBe(true);
    expect(Array.isArray(result.data.unstaged)).toBe(true);
    expect(Array.isArray(result.data.untracked)).toBe(true);
  });
});

// ─── gitLog ───────────────────────────────────────────────

describe("gitLog", () => {
  test("返回提交历史，结构正确", async () => {
    const result = await gitLog(mockCtx, { limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.length).toBeLessThanOrEqual(3);

    const entry = result.data[0];
    expect(entry).toHaveProperty("hash");
    expect(entry).toHaveProperty("message");
    expect(entry).toHaveProperty("author");
    expect(entry).toHaveProperty("date");
    expect(entry.hash.length).toBeGreaterThan(0);
    expect(entry.message.length).toBeGreaterThan(0);
  });

  test("默认返回最多 10 条", async () => {
    const result = await gitLog(mockCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.length).toBeLessThanOrEqual(10);
  });
});

// ─── gitDiff ──────────────────────────────────────────────

describe("gitDiff", () => {
  test("返回字符串（可能为空）", async () => {
    const result = await gitDiff(mockCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(typeof result.data).toBe("string");
  });

  test("staged 模式也返回字符串", async () => {
    const result = await gitDiff(mockCtx, { staged: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(typeof result.data).toBe("string");
  });
});
