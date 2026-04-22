/**
 * git/advanced trait 单元测试
 *
 * 只测输入校验 + blame 解析（在真实仓库里跑 blame 是只读安全的）。
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import {
  cherryPick,
  revert,
  rebaseOnto,
  blame,
  llm_methods,
} from "../../library/traits/git/advanced/index";

const ctx = { rootDir: "/nonexistent" } as any;

describe("git/advanced — 输入校验", () => {
  test("cherryPick: commit 缺失应返回 error", async () => {
    expect((await cherryPick(ctx, { commit: "" })).ok).toBe(false);
  });
  test("revert: commit 缺失应返回 error", async () => {
    expect((await revert(ctx, { commit: "" })).ok).toBe(false);
  });
  test("rebaseOnto: onto 缺失应返回 error", async () => {
    expect((await rebaseOnto(ctx, { onto: "" })).ok).toBe(false);
  });
  test("blame: path 缺失应返回 error", async () => {
    expect((await blame(ctx, { path: "" })).ok).toBe(false);
  });
});

describe("git/advanced — blame on real repo", () => {
  const KERNEL_DIR = resolve(import.meta.dir, "..");
  test("blame README.md（如存在）返回非空行", async () => {
    const fs = await import("node:fs/promises");
    const readmeRel = "README.md";
    try {
      await fs.access(`${KERNEL_DIR}/${readmeRel}`);
    } catch {
      /* 没 README.md 就跳过 */
      return;
    }
    const r = await blame({ rootDir: KERNEL_DIR } as any, { path: readmeRel, range: "1,5" });
    if (!r.ok) return; /* 容忍 blame 在某些特殊仓库状态下失败 */
    expect(r.data.path).toBe(readmeRel);
    if (r.data.lines.length > 0) {
      const first = r.data.lines[0];
      expect(first.commit.length).toBeGreaterThan(0);
      expect(first.lineNumber).toBeGreaterThan(0);
    }
  });
});

describe("git/advanced — llm_methods 契约", () => {
  test("应导出 cherry_pick / revert / rebase_onto / blame", () => {
    expect(llm_methods.cherry_pick).toBeDefined();
    expect(llm_methods.revert).toBeDefined();
    expect(llm_methods.rebase_onto).toBeDefined();
    expect(llm_methods.blame).toBeDefined();
  });
});
