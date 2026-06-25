/**
 * feat-branch smoke test —— 验证 reflectable feat-branch worktree + commit + merge 跑通。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFeatBranchWorktree,
  commitFeatAndDiff,
  mergeFeatBranch,
  writeWorktreeFile,
  readWorktreeFile,
  slugFromIntent,
} from "@ooc/core/persistable/feat-branch";

let baseDir: string;

describe("reflectable feat-branch", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-feat-test-"));
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("slugFromIntent normalizes", () => {
    expect(slugFromIntent("Fix the bug: improve A&B!")).toBe("fix-the-bug-improve-a-b");
    expect(slugFromIntent("")).toMatch(/^feat-/);
  });

  it("create + edit + commit + diff produces a non-empty patch", async () => {
    const r = await createFeatBranchWorktree({
      baseDir,
      intent: "add hello world",
    });
    expect(r.ok).toBe(true);
    expect(r.branch).toBe("feat/add-hello-world");
    const s = await stat(r.worktreePath);
    expect(s.isDirectory()).toBe(true);

    // edit a file in the worktree
    await writeWorktreeFile(r.worktreePath, "objects/hello/self.md", "# hello\nA new object.");
    expect(await readWorktreeFile(r.worktreePath, "objects/hello/self.md")).toContain("# hello");

    const c = commitFeatAndDiff({
      baseDir,
      worktreePath: r.worktreePath,
      message: "add hello",
    });
    expect(c.ok).toBe(true);
    expect(c.diff).toContain("hello");
    expect(c.diff).toContain("A new object");
  });

  it("merge feat-branch into main + cleanup worktree", async () => {
    const r = await createFeatBranchWorktree({ baseDir, intent: "merge test" });
    expect(r.ok).toBe(true);
    await writeWorktreeFile(r.worktreePath, "objects/m/self.md", "merge target");
    commitFeatAndDiff({ baseDir, worktreePath: r.worktreePath, message: "m" });
    const m = mergeFeatBranch({
      baseDir,
      branch: r.branch,
      worktreePath: r.worktreePath,
    });
    expect(m.ok).toBe(true);
    // worktree removed
    await expect(stat(r.worktreePath)).rejects.toThrow();
  });
});
