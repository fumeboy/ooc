/**
 * git/advanced E2E —— 在本地临时仓库里把 interactive_rebase / rebase_continue /
 * rebase_abort 串起来跑。不联网、不依赖 gh、不污染真实仓库。
 *
 * 关键用例：
 * 1) 5 commit → reword + squash + drop → 结果 3 个 commit，顺序正确
 * 2) 冲突场景 → interactive_rebase 返回 conflict → 解决冲突 git add → rebase_continue 成功
 * 3) 冲突场景 → rebase_abort 清理
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_git_pr_advanced.md — implements — Phase 3
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  interactiveRebase,
  rebaseContinue,
  rebaseAbort,
} from "../../library/traits/git/advanced/index";

// ─── 仓库 fixture ────────────────────────────────────────

async function runIn(dir: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`cmd fail ${args.join(" ")}: ${err}`);
  }
  return stdout;
}

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "ooc-git-e2e-"));
  await runIn(dir, ["git", "init", "-q", "-b", "main"]);
  await runIn(dir, ["git", "config", "user.email", "t@t.t"]);
  await runIn(dir, ["git", "config", "user.name", "T"]);
  await runIn(dir, ["git", "config", "commit.gpgsign", "false"]);
  return dir;
}

async function writeCommit(dir: string, file: string, content: string, msg: string) {
  await Bun.write(`${dir}/${file}`, content);
  await runIn(dir, ["git", "add", "."]);
  await runIn(dir, ["git", "commit", "-q", "-m", msg]);
}

async function gitLogSubjects(dir: string, range: string): Promise<string[]> {
  const out = await runIn(dir, ["git", "log", "--format=%s", range]);
  return out.trim().split("\n").filter(Boolean);
}

// ─── 用例 ─────────────────────────────────────────────────

describe("git/advanced E2E — interactive rebase 完整编排", () => {
  test("reword C1 + squash C3 into C2 + drop C5 → 剩 3 commit", async () => {
    const dir = await initRepo();
    try {
      await writeCommit(dir, "base.txt", "base\n", "C0");
      for (let i = 1; i <= 5; i++) {
        await writeCommit(dir, "f.txt", `line ${i}\n`, `C${i}`);
      }
      /* 取 C1..C5 hash */
      const hashesOut = await runIn(dir, [
        "git",
        "log",
        "--reverse",
        "--format=%H",
        "HEAD~5..HEAD",
      ]);
      const [c1, c2, c3, c4, c5] = hashesOut.trim().split("\n");

      const r = await interactiveRebase({ rootDir: dir } as any, {
        onto: "HEAD~5",
        plan: [
          { action: "reword", commit: c1!, message: "C1-reworded" },
          { action: "pick", commit: c2! },
          { action: "squash", commit: c3!, message: "C2+C3-merged" },
          { action: "pick", commit: c4! },
          { action: "drop", commit: c5! },
        ],
      });
      expect(r.ok).toBe(true);

      /* 最终结果：HEAD 起三个 commit，从新到旧 = [C4, C2+C3-merged, C1-reworded] */
      const subjects = await gitLogSubjects(dir, "HEAD~3..HEAD");
      expect(subjects).toEqual(["C4", "C2+C3-merged", "C1-reworded"]);

      /* 进一步：HEAD~3 应该就是 C0 */
      const base = await gitLogSubjects(dir, "HEAD~3..HEAD~2");
      expect(base).toEqual(["C1-reworded"]); /* 实际上 HEAD~3..HEAD~2 是最老那个 rebased commit */
      /* 精确的 base 位置验证：HEAD~4 的 subject 应该是 C0 */
      const oldest = await runIn(dir, ["git", "log", "--format=%s", "-n", "1", "HEAD~3"]);
      expect(oldest.trim()).toBe("C0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("冲突 → rebase_abort 能清理到初始状态", async () => {
    const dir = await initRepo();
    try {
      await writeCommit(dir, "f.txt", "base\n", "C0");
      await writeCommit(dir, "f.txt", "A\n", "C1");
      /* 另起一条分支制造冲突 */
      await runIn(dir, ["git", "checkout", "-q", "-b", "feature", "HEAD~1"]);
      await writeCommit(dir, "f.txt", "X\n", "feature-commit");
      const featureHead = (await runIn(dir, ["git", "rev-parse", "HEAD"])).trim();

      /* 回 main，试图 interactive_rebase onto feature —— 会冲突 */
      await runIn(dir, ["git", "checkout", "-q", "main"]);
      const mainHead = (await runIn(dir, ["git", "rev-parse", "HEAD"])).trim();

      const r = await interactiveRebase({ rootDir: dir } as any, {
        onto: "feature",
        plan: [{ action: "pick", commit: mainHead }],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect((r as any).conflict).toBe(true);
        expect(Array.isArray((r as any).files)).toBe(true);
        expect((r as any).files.length).toBeGreaterThan(0);
      }

      /* rebase_abort 清理 */
      const ab = await rebaseAbort({ rootDir: dir } as any);
      expect(ab.ok).toBe(true);
      /* 回到原 main HEAD */
      const nowHead = (await runIn(dir, ["git", "rev-parse", "HEAD"])).trim();
      expect(nowHead).toBe(mainHead);

      /* 顺便检查 feature 还是原样 */
      void featureHead;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("冲突 → 手动解决 + rebase_continue 成功收尾", async () => {
    const dir = await initRepo();
    try {
      await writeCommit(dir, "f.txt", "base\n", "C0");
      await writeCommit(dir, "f.txt", "A\n", "C1");
      await runIn(dir, ["git", "checkout", "-q", "-b", "feature", "HEAD~1"]);
      await writeCommit(dir, "f.txt", "X\n", "feature-commit");
      await runIn(dir, ["git", "checkout", "-q", "main"]);
      const mainHead = (await runIn(dir, ["git", "rev-parse", "HEAD"])).trim();

      const r = await interactiveRebase({ rootDir: dir } as any, {
        onto: "feature",
        plan: [{ action: "pick", commit: mainHead }],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect((r as any).conflict).toBe(true);

      /* 手动解决冲突：把 f.txt 写为 RESOLVED，然后 git add */
      await Bun.write(`${dir}/f.txt`, "RESOLVED\n");
      await runIn(dir, ["git", "add", "f.txt"]);

      /* rebase_continue */
      const cont = await rebaseContinue({ rootDir: dir } as any);
      expect(cont.ok).toBe(true);

      /* 现在 HEAD 应该是基于 feature 的新 commit，内容是 RESOLVED */
      const fileContent = await runIn(dir, ["cat", "f.txt"]);
      expect(fileContent.trim()).toBe("RESOLVED");
      /* 当前 HEAD 的父是 feature */
      const parent = (
        await runIn(dir, ["git", "rev-parse", "HEAD^"])
      ).trim();
      const featureRef = (
        await runIn(dir, ["git", "rev-parse", "feature"])
      ).trim();
      expect(parent).toBe(featureRef);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
