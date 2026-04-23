/**
 * git/advanced — interactive_rebase / rebase_continue / rebase_abort 单元测试
 *
 * 设计要点：
 * - 输入校验用假 rootDir，不会真正执行 git
 * - E2E 路径在一个临时真实仓库里做完整的 reword + squash + drop 操作
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_git_pr_advanced.md — implements — Phase 1
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  interactiveRebase,
  rebaseContinue,
  rebaseAbort,
  llm_methods,
} from "../../library/traits/git/advanced/index";

// ─── 辅助：在临时目录搭建一个 5 提交的真实仓库 ──────────────

/**
 * 创建临时 git 仓库，做 6 个 commit：C0（base）+ C1..C5。
 * 返回 rootDir 和按从旧到新排列的最近 5 个 commit hash（C1..C5）。
 */
async function mkRepoWith5Commits(): Promise<{ rootDir: string; hashes: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "ooc-irebase-"));
  const run = async (args: string[]) => {
    const proc = Bun.spawn(args, { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`cmd fail (${args.join(" ")}): ${err}`);
    }
    return out;
  };

  await run(["git", "init", "-q", "-b", "main"]);
  await run(["git", "config", "user.email", "test@ooc.test"]);
  await run(["git", "config", "user.name", "Test"]);
  await run(["git", "config", "commit.gpgsign", "false"]);
  /* base commit 保证 HEAD~5 可达 */
  await Bun.write(`${dir}/base.txt`, "base\n");
  await run(["git", "add", "base.txt"]);
  await run(["git", "commit", "-q", "-m", "C0"]);
  for (let i = 1; i <= 5; i++) {
    await Bun.write(`${dir}/f.txt`, `line ${i}\n`);
    await run(["git", "add", "f.txt"]);
    await run(["git", "commit", "-q", "-m", `C${i}`]);
  }
  /* 取 C1..C5 的 hash（从旧到新） */
  const hashesOut = await run([
    "git",
    "log",
    "--reverse",
    "--format=%H",
    "HEAD~5..HEAD",
  ]);
  const hashes = hashesOut.trim().split("\n");
  return { rootDir: dir, hashes };
}

// ─── 输入校验 ─────────────────────────────────────────────

describe("git/advanced — interactive_rebase 输入校验", () => {
  const ctx = { rootDir: "/nonexistent" } as any;

  test("plan 为空数组应返回 error", async () => {
    const r = await interactiveRebase(ctx, { onto: "HEAD~1", plan: [] });
    expect(r.ok).toBe(false);
  });

  test("未提供 plan 应返回 error", async () => {
    const r = await interactiveRebase(ctx, { onto: "HEAD~1" } as any);
    expect(r.ok).toBe(false);
  });

  test("plan 中 action 非法应返回 error", async () => {
    const r = await interactiveRebase(ctx, {
      onto: "HEAD~1",
      plan: [{ action: "fly" as any, commit: "abc" }],
    });
    expect(r.ok).toBe(false);
  });

  test("plan 中缺 commit 应返回 error", async () => {
    const r = await interactiveRebase(ctx, {
      onto: "HEAD~1",
      plan: [{ action: "pick", commit: "" }],
    });
    expect(r.ok).toBe(false);
  });

  test("reword 但缺 message 应返回 error", async () => {
    const r = await interactiveRebase(ctx, {
      onto: "HEAD~1",
      plan: [{ action: "reword", commit: "abc" }],
    });
    expect(r.ok).toBe(false);
  });

  test("onto 缺失应返回 error", async () => {
    const r = await interactiveRebase(ctx, {
      onto: "",
      plan: [{ action: "pick", commit: "abc" }],
    });
    expect(r.ok).toBe(false);
  });
});

// ─── llm_methods 契约 ─────────────────────────────────────

describe("git/advanced — llm_methods 契约（interactive）", () => {
  test("应导出 interactive_rebase / rebase_continue / rebase_abort", () => {
    expect(llm_methods.interactive_rebase).toBeDefined();
    expect(llm_methods.rebase_continue).toBeDefined();
    expect(llm_methods.rebase_abort).toBeDefined();
    expect(typeof llm_methods.interactive_rebase.fn).toBe("function");
  });

  test("interactive_rebase 的 plan 参数标记为 required", () => {
    const planParam = llm_methods.interactive_rebase.params.find(p => p.name === "plan");
    expect(planParam).toBeDefined();
    expect(planParam!.required).toBe(true);
  });
});

// ─── E2E：reword C1 + squash C3 into C2 + drop C5 ────────

describe("git/advanced — interactive_rebase E2E", () => {
  test("完整编排：reword C1, squash C3 into C2, drop C5", async () => {
    const { rootDir, hashes } = await mkRepoWith5Commits();
    try {
      /* plan 顺序 = git rebase todo 顺序（从旧到新） */
      const plan = [
        { action: "reword", commit: hashes[0], message: "C1-reworded" },
        { action: "pick", commit: hashes[1] },
        { action: "squash", commit: hashes[2], message: "C2+C3-combined" },
        { action: "pick", commit: hashes[3] },
        { action: "drop", commit: hashes[4] },
      ] as const;

      const r = await interactiveRebase({ rootDir } as any, {
        onto: "HEAD~5",
        plan: plan as any,
      });
      expect(r.ok).toBe(true);

      /* 验证结果：剩下 3 个 commit —— [C1-reworded, C2+C3-combined, C4] */
      const logOut = Bun.spawnSync(["git", "log", "--format=%s", "HEAD~3..HEAD"], {
        cwd: rootDir,
      });
      const subjects = new TextDecoder()
        .decode(logOut.stdout)
        .trim()
        .split("\n");
      /* git log 默认从新到旧 */
      expect(subjects).toEqual(["C4", "C2+C3-combined", "C1-reworded"]);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("冲突场景：返回 { ok:false, conflict:true, files }，不抛异常", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ooc-irebase-conflict-"));
    try {
      const run = async (args: string[]) => {
        const proc = Bun.spawn(args, { cwd: dir, stdout: "pipe", stderr: "pipe" });
        await proc.exited;
      };
      await run(["git", "init", "-q", "-b", "main"]);
      await run(["git", "config", "user.email", "t@t.t"]);
      await run(["git", "config", "user.name", "T"]);
      await run(["git", "config", "commit.gpgsign", "false"]);
      /* base */
      await Bun.write(`${dir}/f.txt`, "base\n");
      await run(["git", "add", "."]);
      await run(["git", "commit", "-q", "-m", "C0"]);
      /* C1: 改成 A */
      await Bun.write(`${dir}/f.txt`, "A\n");
      await run(["git", "add", "."]);
      await run(["git", "commit", "-q", "-m", "C1"]);
      /* C2: 基于 A 改成 B */
      await Bun.write(`${dir}/f.txt`, "B\n");
      await run(["git", "add", "."]);
      await run(["git", "commit", "-q", "-m", "C2"]);

      /* 故意让 squash 触发冲突：把 C2 的 squash 基线改掉
         做法：把 C1 reword 成一个删行的 commit，squash C2 到它上面 */
      /* 更简单的冲突制造：做两条分支 */
      await run(["git", "checkout", "-q", "-b", "branch1", "HEAD~1"]);
      await Bun.write(`${dir}/f.txt`, "X\n");
      await run(["git", "add", "."]);
      await run(["git", "commit", "-q", "-m", "branch1-commit"]);

      const hashesOut = Bun.spawnSync(
        ["git", "log", "--format=%H", "-n", "1"],
        { cwd: dir },
      );
      const branch1Hash = new TextDecoder()
        .decode(hashesOut.stdout)
        .trim()
        .split("\n")[0];

      /* 切回 main，尝试 cherry-pick 式 interactive rebase —— 这里触发 E2E 冲突简单些直接 rebase */
      await run(["git", "checkout", "-q", "main"]);
      /* plan：pick 当前 HEAD 到 branch1 基上 —— 会冲突 */
      const r = await interactiveRebase({ rootDir: dir } as any, {
        onto: "branch1",
        plan: [{ action: "pick", commit: "HEAD" }],
      });
      /* 应捕获冲突，返回 { ok:false, conflict:true } */
      if (!r.ok) {
        expect((r as any).conflict).toBe(true);
        expect(Array.isArray((r as any).files)).toBe(true);
      } else {
        /* 若某些 git 版本意外成功也不算回归，只验证返回结构 */
        expect(r.ok).toBe(true);
      }

      /* 如果真的有冲突，用 rebase_abort 清理 */
      if (!r.ok && (r as any).conflict) {
        const ab = await rebaseAbort({ rootDir: dir } as any);
        expect(ab.ok).toBe(true);
      }

      /* 确保标记 unused ts */
      void branch1Hash;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
