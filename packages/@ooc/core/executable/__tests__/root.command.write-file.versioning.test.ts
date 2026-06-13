/**
 * write_file → stone-versioning 路由。
 *
 * 验证 LLM 的 write_file 命令写 stones/<self>/... 路径时不再裸 writeFile，而是经
 * stone-versioning（git commit + self-scope ff-merge / cross-scope PR-Issue）：
 *   - self-scope：写 objects/<self>/self.md → commit + ff-merge 回 main；main 工作区可读到新内容
 *   - cross-scope：写别人的 objects/<other>/... → 不合并 main，开 PR-Issue
 *   - non-stone：写 pools/ → 直写，不进 git
 *   - stones-world：写 stones/main/ 根下非 objects/ 资源 → fail-loud，不静默直写
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests } from "@ooc/core/persistable";
import { writeFileExec as executeWriteFileMethod } from "@ooc/builtins/filesystem/executable/index.js";
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

/** 建一个干净 world：bootstrap repo + 给定 agent，每个 agent 一个 self.md。 */
async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-write-file-versioning-"));
  tempRoots.push(baseDir);
  for (const id of [...agents, "supervisor"]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    // Create package.json so classifyPackagesPath can identify this as an object package
    await writeFile(
      join(baseDir, "stones", id, "package.json"),
      JSON.stringify({
        name: `@ooc-obj/${id.replace(/\//g, "-")}`,
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: id, kind: "object", type: "agent" },
      }),
      "utf8",
    );
  }
  await ensureStoneRepo({ baseDir });
  // After migration, sync from stones/main/objects/ to packages/ for runtime visibility
  const { cp } = await import("node:fs/promises");
  for (const id of [...agents, "supervisor"]) {
    const source = join(baseDir, "stones", "main", "objects", ...id.split("/").flatMap((seg) => ["children", seg]).slice(1));
    const target = join(baseDir, "packages", ...id.split("/").flatMap((seg) => ["children", seg]).slice(1));
    try {
      await cp(source, target, { recursive: true, force: true });
    } catch { /* source might not exist for nested paths */ }
  }
  return baseDir;
}

/** 构造最小 MethodExecutionContext（无 manager；thread 只带 persistence + contextWindows）。 */
function ctxFor(
  baseDir: string,
  objectId: string,
  args: Record<string, unknown>,
): MethodExecutionContext {
  const thread = {
    persistence: { baseDir, objectId, sessionId: "s", threadId: "t" },
    contextWindows: [] as unknown[],
  };
  return { thread, args } as unknown as MethodExecutionContext;
}

function mainObjectsDir(baseDir: string): string {
  return join(baseDir, "stones", "main", "objects");
}

describe("write_file stone-versioning routing", () => {
  // worktree 统一模型：业务 session（sessionId="s"）对**自己 stone 自治区**的写
  // 不再即时 commit→main，而是落该 session 的 worktree（方案 A：`flows/s/objects/<id>/`）；
  // main 不变，经 super flow create_pr_and_invite_reviewers 合入才永久。下面 self-scope 测试断言 worktree 重定向。
  test("self-scope（业务 session）: 写 stones/<self>/self.md → 落 worktree，main 不变", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/self.md",
      content: "agent_of_x v2 via write_file\n",
    });

    const out = await executeWriteFileMethod(ctx);
    // 成功 outcome（constructor object outcome）
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true && "window" in out && out.window) {
      expect(out.window.class).toBe("file");
      // window 指向 worktree 物理落点（方案 A：flows/s/objects/...）
      expect((out.window as unknown as { path: string }).path).toContain(
        join("flows", "s", "objects", "agent_of_x", "self.md"),
      );
    } else {
      throw new Error(`expected success constructor outcome, got ${JSON.stringify(out)}`);
    }

    // worktree 文件写入新内容
    const onWorktree = await readFile(
      join(baseDir, "flows", "s", "objects", "agent_of_x", "self.md"),
      "utf8",
    );
    expect(onWorktree).toBe("agent_of_x v2 via write_file\n");

    // canonical main 未变（仍 v1）
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v1\n");

    // 没有 write_file commit 进 main（worktree plain write，不走 git commit）
    const log = Bun.spawnSync(["git", "log", "-1", "--pretty=%s"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    const lastCommit = new TextDecoder().decode(log.stdout).trim();
    expect(lastCommit).not.toContain("write_file objects/agent_of_x/self.md");
  });

  test("self-scope（业务 session）: 写自治区新子文件（server/index.ts）→ 落 worktree，main 无该文件", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/server/index.ts",
      content: "export const methods = {};\n",
    });
    const out = await executeWriteFileMethod(ctx);
    expect(typeof out === "object" && out !== null && out !== undefined && out.ok === true).toBe(true);
    const onWorktree = await readFile(
      join(baseDir, "flows", "s", "objects", "agent_of_x", "server", "index.ts"),
      "utf8",
    );
    expect(onWorktree).toBe("export const methods = {};\n");
    // main 上没有该新文件（未合入）
    await expect(
      readFile(join(mainObjectsDir(baseDir), "agent_of_x", "server", "index.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("super flow: write_file 写 stone 自治区 → fail-loud（非业务 session，无 worktree 落点），main 不变", async () => {
    // 去 metaprog：stone 写的两个落点是「业务 session worktree」（LLM 试验，
    // 经 create_pr_and_invite_reviewers 合入）与「HTTP 控制面直写 main」（人类已决策）。super flow 既非业务 session
    // （sessionUsesWorktree("super")=false）也非 HTTP，其角色是 create_pr_and_invite_reviewers 合入闸门、不是 stone
    // 作者——故 super session 内 write_file 写 stone 自治区 fail-loud，不再裸 commit main。
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/self.md",
      content: "agent_of_x v2 via super write_file\n",
    });
    (ctx.thread as unknown as { persistence: { sessionId: string } }).persistence.sessionId = "super";

    const out = await executeWriteFileMethod(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === false) {
      expect(out.error).toContain("业务 session");
    } else {
      throw new Error(`expected failure outcome, got ${JSON.stringify(out)}`);
    }

    // main 未变（fail-loud，不裸写）
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v1\n");
  });

  test("cross-scope: 写别人 stone → 不合并 main，开 PR-Issue", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_y/self.md",
      content: "agent_of_y edited by x\n",
    });

    const out = await executeWriteFileMethod(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true && "window" in out && out.window) {
      expect(out.window.class).toBe("file");
    } else {
      throw new Error(`expected success constructor outcome, got ${JSON.stringify(out)}`);
    }

    // main 工作区**未**被改（cross-scope 不直接落 main）
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_y", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_y v1\n");
  });

  test("non-stone: 写 pools/ → 直写，不进 git", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "pools/agent_of_x/data/events.csv",
      content: "a,b\n1,2\n",
    });
    const out = await executeWriteFileMethod(ctx);
    // non-stone 新建：constructor outcome { ok: true, object }
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true && "window" in out && out.window) {
      expect(out.window.class).toBe("file");
    } else {
      throw new Error(`expected success constructor outcome, got ${JSON.stringify(out)}`);
    }

    // 文件落在 pools/agent_of_x/...（rewritePoolsPath 不再注入 objects/），不在 stones 树
    const written = await readFile(
      join(baseDir, "pools", "agent_of_x", "data", "events.csv"),
      "utf8",
    );
    expect(written).toBe("a,b\n1,2\n");
  });

  test("stones-world: 写 stones/main/ 根下非 objects/ 资源 → fail-loud，不静默直写", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      // 显式 main/ 前缀 → resolveSessionPath 不再注入 objects/，落在 stones/main/ 根。
      // 用 README.md（非 bootstrap 产物；.gitignore 现由 bootstrap 在 main 根落，不能复用）。
      path: "stones/main/README.md",
      content: "workspace doc\n",
    });
    const out = await executeWriteFileMethod(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === false) {
      expect(out.error).toContain("workspace-level");
    } else {
      throw new Error(`expected failure outcome, got ${JSON.stringify(out)}`);
    }

    // 没有静默直写：fail-loud 应当不创建该文件
    await expect(
      readFile(join(baseDir, "stones", "main", "README.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("nested child（业务 session）: 写自己 stones/<parent>/children/<child>/self.md → 落 worktree，main 不变", async () => {
    // 嵌套 world：parent 含 children/child
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-write-file-versioning-nested-"));
    tempRoots.push(baseDir);
    for (const id of ["parent", "supervisor"]) {
      await mkdir(join(baseDir, "stones", id), { recursive: true });
      await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
      await writeFile(
        join(baseDir, "stones", id, "package.json"),
        JSON.stringify({
          name: `@ooc-obj/${id}`,
          version: "0.1.0",
          private: true,
          type: "module",
          ooc: { objectId: id, kind: "object", type: "agent" },
        }),
        "utf8",
      );
    }
    await mkdir(join(baseDir, "stones", "parent", "children", "child"), { recursive: true });
    await writeFile(join(baseDir, "stones", "parent", "children", "child", "self.md"), "child v1\n");
    await writeFile(
      join(baseDir, "stones", "parent", "children", "child", "package.json"),
      JSON.stringify({
        name: "@ooc-obj/parent-child",
        version: "0.1.0",
        private: true,
        type: "module",
        ooc: { objectId: "parent/child", kind: "object", type: "agent" },
      }),
      "utf8",
    );
    await ensureStoneRepo({ baseDir });
    // Sync to packages/
    const { cp } = await import("node:fs/promises");
    await cp(
      join(baseDir, "stones", "main", "objects", "parent"),
      join(baseDir, "packages", "parent"),
      { recursive: true, force: true },
    );
    await cp(
      join(baseDir, "stones", "main", "objects", "supervisor"),
      join(baseDir, "packages", "supervisor"),
      { recursive: true, force: true },
    );

    // child 用完整 objectId "parent/child"；LLM 写路径用 "/" 编码 → resolveSessionPath
    // 注入 objects/ + nestedObjectPath 物理翻译。
    const ctx = ctxFor(baseDir, "parent/child", {
      path: "stones/parent/children/child/self.md",
      content: "child v2 via write_file\n",
    });
    const out = await executeWriteFileMethod(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true && "window" in out && out.window) {
      expect(out.window.class).toBe("file");
    } else {
      throw new Error(`expected success constructor outcome, got ${JSON.stringify(out)}`);
    }

    // worktree 落点（方案 A）：flows/s/objects/parent/children/child/self.md
    const onWorktree = await readFile(
      join(baseDir, "flows", "s", "objects", "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(onWorktree).toBe("child v2 via write_file\n");
    // main 不变
    const onMain = await readFile(
      join(mainObjectsDir(baseDir), "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(onMain).toBe("child v1\n");
  });

  test("fail-loud: 路径在 stones 自治区但 thread 缺 objectId → 不静默直写", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    // 先确保 agent_of_x 在 packages/ 下有 package.json，让 classifyStonesPath 识别为 stone-object
    const { mkdir: m, writeFile: w } = await import("node:fs/promises");
    await m(join(baseDir, "packages", "agent_of_x"), { recursive: true });
    await w(join(baseDir, "packages", "agent_of_x", "package.json"), JSON.stringify({
      name: "@ooc-obj/agent-of-x",
      version: "0.1.0",
      private: true,
      type: "module",
      ooc: { objectId: "agent_of_x", kind: "object", type: "agent" },
    }), "utf8");

    const thread = {
      persistence: { baseDir, sessionId: "s", threadId: "t" },
      contextWindows: [] as unknown[],
    };
    const ctx = {
      thread,
      args: { path: "stones/agent_of_x/self.md", content: "x\n" },
    } as unknown as MethodExecutionContext;

    const out = await executeWriteFileMethod(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === false) {
      expect(out.error).toContain("persistence.objectId");
    } else {
      throw new Error(`expected failure outcome, got ${JSON.stringify(out)}`);
    }

    // 自治区文件未被裸写
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v1\n");
  });

  // reflectable 回归：feat 分支绑定生效时写 pool 路径 = write-through
  // 立即生效、**不进本 PR**。此前静默直写无任何提示 → 随后 create_pr_and_invite_reviewers 发现 feat 分支
  // 无 stone 改动报 NO_CHANGES，LLM 困惑。断言：feat 绑定下写 pool 注入显式提示。
  test("feat 绑定下写 pools/ → 直写 + 注入 write-through 提示（不静默）", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const events: unknown[] = [];
    const thread = {
      persistence: {
        baseDir,
        objectId: "agent_of_x",
        sessionId: "super",
        threadId: "t",
        stonesBranch: "feat/agent-of-x-mem",
      },
      contextWindows: [] as unknown[],
      events,
    };
    const ctx = {
      thread,
      args: { path: "pools/agent_of_x/knowledge/memory/note.md", content: "记一笔\n" },
    } as unknown as MethodExecutionContext;

    const out = await executeWriteFileMethod(ctx);
    expect(typeof out).toBe("object");
    if (!(typeof out === "object" && out && out.ok === true)) {
      throw new Error(`expected success outcome, got ${JSON.stringify(out)}`);
    }

    // 文件确实落 pool（write-through 语义不变）
    const written = await readFile(
      join(baseDir, "pools", "agent_of_x", "knowledge", "memory", "note.md"),
      "utf8",
    );
    expect(written).toBe("记一笔\n");

    // 注入了 feat 绑定下 pool 写的显式提示（消除静默 + 提前点破 NO_CHANGES 困惑）
    const injected = events.find(
      (e): e is { kind: string; text: string } =>
        typeof e === "object" &&
        e !== null &&
        (e as { kind?: string }).kind === "inject" &&
        typeof (e as { text?: string }).text === "string",
    );
    expect(injected).toBeDefined();
    expect(injected!.text).toContain("write-through");
    expect(injected!.text).toContain("不进本 PR");
  });
});
