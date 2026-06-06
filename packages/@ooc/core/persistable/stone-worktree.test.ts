import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo, createStoneObject, writeSelf } from "@ooc/core/persistable";
import {
  resolveStoneIdentityDir,
  sessionStoneBranch,
  sessionUsesWorktree,
  ensureSessionWorktree,
} from "./stone-worktree";

describe("stone-worktree", () => {
  test("sessionUsesWorktree：business 走 worktree，super/无 session 走 main", () => {
    expect(sessionUsesWorktree(undefined)).toBe(false);
    expect(sessionUsesWorktree("super")).toBe(false);
    expect(sessionUsesWorktree("s1")).toBe(true);
  });

  test("resolveStoneIdentityDir：super/控制面 → main", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-wt-"));
    try {
      const superDir = await resolveStoneIdentityDir(
        { baseDir, sessionId: "super", objectId: "assistant" },
        "write",
      );
      expect(superDir).toContain(join("stones", "main", "objects", "assistant"));
      const noSession = await resolveStoneIdentityDir(
        { baseDir, objectId: "assistant" },
        "write",
      );
      expect(noSession).toContain(join("stones", "main", "objects", "assistant"));
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("business session write → lazy 建 worktree + 路由切到 session 分支（读写对称同一目录）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-wt-"));
    try {
      await ensureStoneRepo({ baseDir });
      await createStoneObject({ baseDir, objectId: "assistant", _stonesBranch: "main" });
      await writeSelf({ baseDir, objectId: "assistant", _stonesBranch: "main" }, "# Assistant\n");

      // business read 未建 worktree → 透传 main
      const readBefore = await resolveStoneIdentityDir(
        { baseDir, sessionId: "s1", objectId: "assistant" },
        "read",
      );
      expect(readBefore).toContain(join("stones", "main", "objects", "assistant"));

      // business write → lazy 建 session worktree（从 main HEAD checkout 完整副本）
      const wtDir = await resolveStoneIdentityDir(
        { baseDir, sessionId: "s1", objectId: "assistant" },
        "write",
      );
      expect(wtDir).toContain(join("stones", sessionStoneBranch("s1"), "objects", "assistant"));

      // worktree 分支目录已物理建出（从 main 完整 checkout）
      const wtRoot = join(baseDir, "stones", sessionStoneBranch("s1"));
      expect((await stat(wtRoot)).isDirectory()).toBe(true);

      // 建后 read 也走 worktree（读写对称同一目录）—— worktree 模型核心：单目录、无 shadow
      const readAfter = await resolveStoneIdentityDir(
        { baseDir, sessionId: "s1", objectId: "assistant" },
        "read",
      );
      expect(readAfter).toBe(wtDir);
      // 注：worktree 内 object 文件的完整性依赖 identity 已 git-commit 到 main 分支
      //（control-plane putSelf 经 versionedStoneWrite commit）——见 design doc §8 约束，集成测试覆盖。
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("ensureSessionWorktree 幂等（重复调用不报错）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-wt-"));
    try {
      await ensureStoneRepo({ baseDir });
      await createStoneObject({ baseDir, objectId: "assistant", _stonesBranch: "main" });
      await writeSelf({ baseDir, objectId: "assistant", _stonesBranch: "main" }, "# A\n");
      expect(await ensureSessionWorktree(baseDir, "s1")).toBe(true);
      expect(await ensureSessionWorktree(baseDir, "s1")).toBe(true); // 幂等
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
