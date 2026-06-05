import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  gitArchiveBranch,
  gitBranchCreate,
  gitBranchDelete,
  gitCheckout,
  gitCommit,
  gitCommitAll,
  gitCurrentBranch,
  gitDiffNames,
  gitDiffPatch,
  gitHead,
  gitInit,
  gitMergeBase,
  gitMergeFastForward,
  gitRebase,
  gitRevParse,
  gitStatus,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreePrune,
  gitWorktreeRemove,
  isValidBranchName,
  __testing,
} from "@ooc/core/programmable/git";

let tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

async function newRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ooc-stone-git-"));
  tempRoots.push(dir);
  const init = gitInit(dir, "main");
  expect(init.ok).toBe(true);
  return dir;
}

function commitAuthor(message: string) {
  return { authorName: "alice", authorEmail: "alice@ooc.local", message };
}

describe("isValidBranchName", () => {
  test("accepts standard refs", () => {
    expect(isValidBranchName("main")).toBe(true);
    expect(isValidBranchName("metaprog/agent_of_x/abc123")).toBe(true);
    expect(isValidBranchName("v1.2-rc")).toBe(true);
  });
  test("rejects path traversal", () => {
    expect(isValidBranchName("..")).toBe(false);
    expect(isValidBranchName("a/..")).toBe(false);
    expect(isValidBranchName("./x")).toBe(false);
  });
  test("rejects empty / over-long / illegal chars", () => {
    expect(isValidBranchName("")).toBe(false);
    expect(isValidBranchName("a".repeat(201))).toBe(false);
    expect(isValidBranchName("with space")).toBe(false);
    expect(isValidBranchName("foo:bar")).toBe(false);
    expect(isValidBranchName("foo.lock")).toBe(false);
    expect(isValidBranchName("foo/")).toBe(false);
  });
});

describe("gitInit / gitCurrentBranch / gitHead", () => {
  test("init -b main creates repo on main with unborn HEAD", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ooc-init-"));
    tempRoots.push(dir);
    expect(gitInit(dir).ok).toBe(true);
    const branch = gitCurrentBranch(dir);
    expect(branch.ok).toBe(true);
    if (branch.ok) expect(branch.value).toBe("main");
    const head = gitHead(dir);
    expect(head.ok).toBe(true);
    if (head.ok) expect(head.value).toBe(""); // unborn
  });

  test("rejects invalid branch name on init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ooc-init-bad-"));
    tempRoots.push(dir);
    const r = gitInit(dir, "bad..branch");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });
});

describe("gitCommit / gitCommitAll", () => {
  test("commit per-call author works without mutating global config", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "hello");
    const result = gitCommitAll(dir, commitAuthor("init"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(__testing.isValidSha(result.value)).toBe(true);

    // verify author from log
    const proc = Bun.spawnSync(["git", "log", "-1", "--pretty=format:%an <%ae>"], {
      cwd: dir,
      stdout: "pipe",
    });
    expect(new TextDecoder().decode(proc.stdout)).toBe("alice <alice@ooc.local>");
  });

  test("rejects empty author / message", async () => {
    const dir = await newRepo();
    expect(gitCommit(dir, { authorName: "", authorEmail: "x", message: "y" }).ok).toBe(false);
    expect(gitCommit(dir, { authorName: "x", authorEmail: "", message: "y" }).ok).toBe(false);
    expect(gitCommit(dir, { authorName: "x", authorEmail: "y", message: "" }).ok).toBe(false);
  });

  test("commit fails on empty index without allowEmpty", async () => {
    const dir = await newRepo();
    const r = gitCommit(dir, commitAuthor("nothing"));
    expect(r.ok).toBe(false);
  });

  test("allowEmpty produces commit even when index is empty", async () => {
    const dir = await newRepo();
    const r = gitCommit(dir, { ...commitAuthor("empty"), allowEmpty: true });
    expect(r.ok).toBe(true);
  });
});

describe("gitDiffNames", () => {
  test("lists branch-cumulative paths via three-dot notation", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "base.txt"), "v1");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    expect(gitBranchCreate(dir, "feature", "main").ok).toBe(true);
    expect(gitCheckout(dir, "feature").ok).toBe(true);
    await writeFile(join(dir, "added.txt"), "x");
    await writeFile(join(dir, "base.txt"), "v2");
    expect(gitCommitAll(dir, commitAuthor("c2")).ok).toBe(true);

    const r = gitDiffNames(dir, "main", "feature");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sort()).toEqual(["added.txt", "base.txt"]);
    }
  });
});

describe("gitWorktree*", () => {
  test("add → list → remove lifecycle", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "x");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);

    const wtPath = join(dir, "wt-foo");
    expect(gitWorktreeAdd(dir, { path: wtPath, branch: "feature/foo", baseRef: "main" }).ok).toBe(true);

    const list = gitWorktreeList(dir);
    expect(list.ok).toBe(true);
    if (list.ok) {
      const branches = list.value.map((e) => e.branch).filter(Boolean);
      expect(branches).toContain("feature/foo");
      expect(branches).toContain("main");
    }

    expect(gitWorktreeRemove(dir, wtPath).ok).toBe(true);
    expect(gitWorktreePrune(dir).ok).toBe(true);

    const list2 = gitWorktreeList(dir);
    if (list2.ok) {
      const branches = list2.value.map((e) => e.branch).filter(Boolean);
      expect(branches).not.toContain("feature/foo");
    }
  });

  test("rejects unsafe path", async () => {
    const dir = await newRepo();
    const r = gitWorktreeAdd(dir, { path: "../escape", branch: "x", baseRef: "HEAD" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_INPUT");
  });

  test("WORKTREE_EXISTS when adding twice", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "x");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    const wtPath = join(dir, "wt-dup");
    expect(gitWorktreeAdd(dir, { path: wtPath, branch: "dup", baseRef: "main" }).ok).toBe(true);
    const second = gitWorktreeAdd(dir, { path: wtPath, branch: "dup", baseRef: "main" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("WORKTREE_EXISTS");
  });
});

describe("gitMergeFastForward", () => {
  test("fast-forwards when ahead", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "1");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    expect(gitBranchCreate(dir, "feat", "main").ok).toBe(true);
    expect(gitCheckout(dir, "feat").ok).toBe(true);
    await writeFile(join(dir, "b.txt"), "2");
    expect(gitCommitAll(dir, commitAuthor("c2")).ok).toBe(true);
    expect(gitCheckout(dir, "main").ok).toBe(true);
    const r = gitMergeFastForward(dir, "feat");
    expect(r.ok).toBe(true);
  });

  test("returns NON_FAST_FORWARD when divergent", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "1");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    expect(gitBranchCreate(dir, "feat", "main").ok).toBe(true);
    // diverge main
    await writeFile(join(dir, "main-only.txt"), "main");
    expect(gitCommitAll(dir, commitAuthor("main2")).ok).toBe(true);
    // commit on feat
    expect(gitCheckout(dir, "feat").ok).toBe(true);
    await writeFile(join(dir, "feat-only.txt"), "feat");
    expect(gitCommitAll(dir, commitAuthor("feat2")).ok).toBe(true);
    expect(gitCheckout(dir, "main").ok).toBe(true);

    const r = gitMergeFastForward(dir, "feat");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NON_FAST_FORWARD");
  });
});

describe("gitRebase", () => {
  test("REBASE_CONFLICT leaves clean working tree (rebase --abort)", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "v1");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    expect(gitBranchCreate(dir, "feat", "main").ok).toBe(true);
    // diverge both modify a.txt
    await writeFile(join(dir, "a.txt"), "main-edit");
    expect(gitCommitAll(dir, commitAuthor("main edit")).ok).toBe(true);
    expect(gitCheckout(dir, "feat").ok).toBe(true);
    await writeFile(join(dir, "a.txt"), "feat-edit");
    expect(gitCommitAll(dir, commitAuthor("feat edit")).ok).toBe(true);

    const r = gitRebase(dir, "main");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REBASE_CONFLICT");

    // working tree should NOT be in rebase state
    const status = gitStatus(dir);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value).not.toMatch(/UU /);
    }
  });
});

describe("gitArchiveBranch", () => {
  test("moves branch to refs/ooc/rejected/<name> and deletes original", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "x");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    expect(gitBranchCreate(dir, "doomed", "main").ok).toBe(true);

    const sha = gitRevParse(dir, "doomed");
    expect(sha.ok).toBe(true);
    if (!sha.ok) return;

    expect(gitArchiveBranch(dir, "doomed").ok).toBe(true);

    // original branch gone
    const branchSha = gitRevParse(dir, "doomed");
    expect(branchSha.ok).toBe(false);

    // archived ref present at same sha
    const archivedSha = gitRevParse(dir, "refs/ooc/rejected/doomed");
    expect(archivedSha.ok).toBe(true);
    if (archivedSha.ok) expect(archivedSha.value).toBe(sha.value);
  });
});

describe("gitMergeBase", () => {
  test("returns common ancestor sha", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a"), "1");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    const baseSha = gitHead(dir);
    expect(baseSha.ok).toBe(true);
    if (!baseSha.ok) return;
    expect(gitBranchCreate(dir, "f", "main").ok).toBe(true);
    expect(gitCheckout(dir, "f").ok).toBe(true);
    await writeFile(join(dir, "b"), "2");
    expect(gitCommitAll(dir, commitAuthor("c2")).ok).toBe(true);

    const mb = gitMergeBase(dir, "main", "f");
    expect(mb.ok).toBe(true);
    if (mb.ok) expect(mb.value).toBe(baseSha.value);
  });
});

describe("gitDiffPatch", () => {
  test("produces patch text containing diff hunks", async () => {
    const dir = await newRepo();
    await writeFile(join(dir, "a.txt"), "v1\n");
    expect(gitCommitAll(dir, commitAuthor("c1")).ok).toBe(true);
    expect(gitBranchCreate(dir, "f", "main").ok).toBe(true);
    expect(gitCheckout(dir, "f").ok).toBe(true);
    await writeFile(join(dir, "a.txt"), "v2\n");
    expect(gitCommitAll(dir, commitAuthor("c2")).ok).toBe(true);

    const r = gitDiffPatch(dir, "main", "f");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain("diff --git");
      expect(r.value).toContain("-v1");
      expect(r.value).toContain("+v2");
    }
  });
});
