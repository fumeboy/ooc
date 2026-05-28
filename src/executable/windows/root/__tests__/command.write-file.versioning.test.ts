/**
 * write_file → stone-versioning 路由（2026-05-28 方案1）。
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
import { ensureStoneRepo, __resetSerialQueueForTests } from "@src/persistable";
import { executeWriteFileCommand } from "../command.write-file";
import type { CommandExecutionContext } from "../../_shared/command-types";

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
  }
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

/** 构造最小 CommandExecutionContext（无 manager；thread 只带 persistence + contextWindows）。 */
function ctxFor(
  baseDir: string,
  objectId: string,
  args: Record<string, unknown>,
): CommandExecutionContext {
  const thread = {
    persistence: { baseDir, objectId, stonesBranch: "main", sessionId: "s", threadId: "t" },
    contextWindows: [] as unknown[],
  };
  return { thread, args } as unknown as CommandExecutionContext;
}

function mainObjectsDir(baseDir: string): string {
  return join(baseDir, "stones", "main", "objects");
}

describe("write_file stone-versioning routing", () => {
  test("self-scope: 写 stones/<self>/self.md → commit + ff-merge，main 可读到新内容", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/self.md",
      content: "agent_of_x v2 via write_file\n",
    });

    const out = await executeWriteFileCommand(ctx);
    // 成功 outcome（object），带合并提示
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true) {
      expect(out.result).toContain("合并回 main");
    } else {
      throw new Error(`expected success outcome, got ${JSON.stringify(out)}`);
    }

    // main 工作区已反映新内容（下一轮 loader 能读到）
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v2 via write_file\n");

    // git 有记录：最近一条 commit message 来自 write_file（即真的 commit 了，不是裸写）
    const log = Bun.spawnSync(["git", "log", "-1", "--pretty=%an%x09%s"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    const lastCommit = new TextDecoder().decode(log.stdout).trim();
    expect(lastCommit).toContain("agent_of_x");
    expect(lastCommit).toContain("write_file objects/agent_of_x/self.md");

    // file_window 已挂上
    expect((ctx.thread as { contextWindows: unknown[] }).contextWindows.length).toBe(1);
  });

  test("self-scope: 写自治区下的新子文件（server/index.ts）→ ff-merge 到 main", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/server/index.ts",
      content: "export const methods = {};\n",
    });
    const out = await executeWriteFileCommand(ctx);
    expect(typeof out === "object" && out !== null && out !== undefined && out.ok === true).toBe(true);
    const onMain = await readFile(
      join(mainObjectsDir(baseDir), "agent_of_x", "server", "index.ts"),
      "utf8",
    );
    expect(onMain).toBe("export const methods = {};\n");
  });

  test("cross-scope: 写别人 stone → 不合并 main，开 PR-Issue", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      path: "stones/agent_of_y/self.md",
      content: "agent_of_y edited by x\n",
    });

    const out = await executeWriteFileCommand(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true) {
      expect(out.result).toContain("PR-Issue");
    } else {
      throw new Error(`expected success outcome, got ${JSON.stringify(out)}`);
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
    const out = await executeWriteFileCommand(ctx);
    // 新建文件 → undefined（无 overwrite hint）
    expect(out).toBeUndefined();

    // 文件落在 pools/objects/agent_of_x/...（rewritePoolsPath），不在 stones 树
    const written = await readFile(
      join(baseDir, "pools", "objects", "agent_of_x", "data", "events.csv"),
      "utf8",
    );
    expect(written).toBe("a,b\n1,2\n");
  });

  test("stones-world: 写 stones/main/ 根下非 objects/ 资源 → fail-loud，不静默直写", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const ctx = ctxFor(baseDir, "agent_of_x", {
      // 显式 main/ 前缀 → resolveSessionPath 不再注入 objects/，落在 stones/main/ 根
      path: "stones/main/.gitignore",
      content: "node_modules\n",
    });
    const out = await executeWriteFileCommand(ctx);
    expect(typeof out).toBe("string");
    expect(out as string).toContain("world-level stone 资源");

    // 没有静默直写：fail-loud 应当不创建该文件
    await expect(
      readFile(join(baseDir, "stones", "main", ".gitignore"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("nested child: 写自己 stones/<parent>/children/<child>/self.md → self-scope ff-merge", async () => {
    // 嵌套 world：parent 含 children/child
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-write-file-versioning-nested-"));
    tempRoots.push(baseDir);
    for (const id of ["parent", "supervisor"]) {
      await mkdir(join(baseDir, "stones", id), { recursive: true });
      await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    }
    await mkdir(join(baseDir, "stones", "parent", "children", "child"), { recursive: true });
    await writeFile(join(baseDir, "stones", "parent", "children", "child", "self.md"), "child v1\n");
    await ensureStoneRepo({ baseDir });

    // child 用完整 objectId "parent/child"；LLM 写路径用 "/" 编码 → resolveSessionPath
    // 注入 objects/ + nestedObjectPath 物理翻译。
    const ctx = ctxFor(baseDir, "parent/child", {
      path: "stones/parent/children/child/self.md",
      content: "child v2 via write_file\n",
    });
    const out = await executeWriteFileCommand(ctx);
    expect(typeof out).toBe("object");
    if (typeof out === "object" && out && out.ok === true) {
      expect(out.result).toContain("合并回 main");
    } else {
      throw new Error(`expected success outcome, got ${JSON.stringify(out)}`);
    }

    const onMain = await readFile(
      join(mainObjectsDir(baseDir), "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(onMain).toBe("child v2 via write_file\n");
  });

  test("fail-loud: 路径在 stones 自治区但 thread 缺 objectId → 不静默直写", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const thread = {
      persistence: { baseDir, stonesBranch: "main", sessionId: "s", threadId: "t" },
      contextWindows: [] as unknown[],
    };
    const ctx = {
      thread,
      args: { path: "stones/agent_of_x/self.md", content: "x\n" },
    } as unknown as CommandExecutionContext;

    const out = await executeWriteFileCommand(ctx);
    expect(typeof out).toBe("string");
    expect(out as string).toContain("persistence.objectId");

    // 自治区文件未被裸写
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v1\n");
  });
});
