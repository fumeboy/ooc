import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, STONES_BARE_REPO_DIR, STONES_MAIN_BRANCH } from "../stone-bootstrap";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newWorld(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-bootstrap-"));
  return tempRoot;
}

function gitOutput(cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    const err = new TextDecoder().decode(r.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${err}`);
  }
  return new TextDecoder().decode(r.stdout);
}

describe("ensureStoneRepo: bare init from empty world", () => {
  test("creates stones/.stones_repo (bare) + stones/main as linked worktree", async () => {
    const baseDir = await newWorld();

    const result = await ensureStoneRepo({ baseDir });

    expect(result.initialized).toBe(true);
    expect(result.migrated).toBe(false);
    expect(result.bootstrapCommit).toBeDefined();
    expect(result.layout).toBe("bare");

    // bare repo dir 存在
    expect(existsSync(join(baseDir, "stones", STONES_BARE_REPO_DIR))).toBe(true);
    // main worktree 存在，且 .git 是 *文件*（linked worktree 的标记）
    const mainGit = join(baseDir, "stones", STONES_MAIN_BRANCH, ".git");
    expect(existsSync(mainGit)).toBe(true);
    expect(lstatSync(mainGit).isFile()).toBe(true);

    // .git 文件内容指回 .stones_repo/worktrees/main
    const gitFile = await readFile(mainGit, "utf8");
    expect(gitFile).toMatch(/gitdir: .*\.stones_repo\/worktrees\/main/);

    // bare repo 是 bare
    const config = await readFile(join(baseDir, "stones", STONES_BARE_REPO_DIR, "config"), "utf8");
    expect(config).toContain("bare = true");

    // 当前 main worktree 在 main 分支
    const branch = gitOutput(join(baseDir, "stones", STONES_MAIN_BRANCH), ["symbolic-ref", "--short", "HEAD"]).trim();
    expect(branch).toBe(STONES_MAIN_BRANCH);

    // commit author = bootstrap
    const author = gitOutput(join(baseDir, "stones", STONES_MAIN_BRANCH), ["log", "-1", "--pretty=format:%an <%ae>"]);
    expect(author).toBe("bootstrap <bootstrap@ooc.local>");
  });

  test("worktree-add a sibling branch works (main is not special)", async () => {
    const baseDir = await newWorld();
    await ensureStoneRepo({ baseDir });

    const bareDir = join(baseDir, "stones", STONES_BARE_REPO_DIR);
    // 添加一个 metaprog 风格的 worktree
    const wt = Bun.spawnSync(
      ["git", "-C", bareDir, "worktree", "add", "../sibling", "-b", "sibling", "main"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(wt.exitCode).toBe(0);

    // sibling worktree 存在
    expect(existsSync(join(baseDir, "stones", "sibling", ".git"))).toBe(true);
    expect(lstatSync(join(baseDir, "stones", "sibling", ".git")).isFile()).toBe(true);

    // 列表里包含两个工作树（main + sibling）+ bare 自己
    const list = gitOutput(bareDir, ["worktree", "list", "--porcelain"]);
    expect(list).toContain("/main\n");
    expect(list).toContain("/sibling\n");
  });
});

describe("ensureStoneRepo: migration from flat layout (still bare-target)", () => {
  test("moves stones/agent_of_X/ → stones/main/agent_of_X/ then commits via bare", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "agent_of_thinkable"), { recursive: true });
    await writeFile(join(baseDir, "stones", "agent_of_thinkable", "self.md"), "I think.\n");
    await mkdir(join(baseDir, "stones", "supervisor"), { recursive: true });
    await writeFile(join(baseDir, "stones", "supervisor", "self.md"), "I supervise.\n");

    const result = await ensureStoneRepo({ baseDir });

    expect(result.migrated).toBe(true);
    expect(result.initialized).toBe(true);
    expect(result.layout).toBe("bare");

    expect(existsSync(join(baseDir, "stones", "main", "agent_of_thinkable", "self.md"))).toBe(true);
    expect(existsSync(join(baseDir, "stones", "main", "supervisor", "self.md"))).toBe(true);
    expect(existsSync(join(baseDir, "stones", "agent_of_thinkable"))).toBe(false);

    // 仓库根是 stones/main/，所以 git 跟踪的路径不带 main/ 前缀
    const tree = gitOutput(join(baseDir, "stones", "main"), ["ls-tree", "-r", "HEAD", "--name-only"]);
    expect(tree).toContain("agent_of_thinkable/self.md");
    expect(tree).toContain("supervisor/self.md");
    expect(tree).not.toContain("main/agent_of_thinkable");
  });
});

describe("ensureStoneRepo: idempotency", () => {
  test("second call after init does not produce a new commit", async () => {
    const baseDir = await newWorld();
    const first = await ensureStoneRepo({ baseDir });
    expect(first.initialized).toBe(true);

    const log1 = gitOutput(join(baseDir, "stones", "main"), ["log", "--oneline"]).trim().split("\n").length;

    const second = await ensureStoneRepo({ baseDir });
    expect(second.initialized).toBe(false);
    expect(second.migrated).toBe(false);
    expect(second.bootstrapCommit).toBeUndefined();
    expect(second.layout).toBe("bare");

    const log2 = gitOutput(join(baseDir, "stones", "main"), ["log", "--oneline"]).trim().split("\n").length;
    expect(log2).toBe(log1);
  });

  test("re-attaches main worktree if .stones_repo exists but main/ is gone", async () => {
    const baseDir = await newWorld();
    await ensureStoneRepo({ baseDir });
    // 模拟用户误删了 main 工作树（只删 dir，bare repo 还在）
    await rm(join(baseDir, "stones", "main"), { recursive: true, force: true });

    // 再次启动应当把 main worktree 补回来
    const result = await ensureStoneRepo({ baseDir });
    expect(result.layout).toBe("bare");
    expect(existsSync(join(baseDir, "stones", "main", ".git"))).toBe(true);
  });
});

describe("ensureStoneRepo: legacy embedded compatibility", () => {
  test("recognizes legacy stones/main/.git directory and skips bare init", async () => {
    const baseDir = await newWorld();
    await mkdir(join(baseDir, "stones", "main"), { recursive: true });
    Bun.spawnSync(["git", "init", "-b", "main"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
      stderr: "pipe",
    });
    await mkdir(join(baseDir, "stones", "main", "agent_of_x"), { recursive: true });
    await writeFile(join(baseDir, "stones", "main", "agent_of_x", "self.md"), "x\n");

    const result = await ensureStoneRepo({ baseDir });

    expect(result.layout).toBe("legacy-embedded");
    expect(result.bootstrapCommit).toBeDefined();
    // bare repo 不应被创建（legacy 路径不强制升级）
    expect(existsSync(join(baseDir, "stones", STONES_BARE_REPO_DIR))).toBe(false);
  });
});

describe("ensureStoneRepo: world dir scaffolding", () => {
  test("creates flows/ alongside stones/ — UI /api/tree?scope=flows depends on it", async () => {
    const baseDir = await newWorld();
    await ensureStoneRepo({ baseDir });
    expect(existsSync(join(baseDir, "flows"))).toBe(true);
  });
});
