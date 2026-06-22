/**
 * write_file → stone-versioning 路由（Wave 4 对象模型：写盘逻辑下沉到 file class 的 construct）。
 *
 * 验证 LLM 的 write_file（= file.construct 带 content 分支）写 stones/<self>/... 路径时不再裸
 * writeFile，而是经 worktree 版本化：
 *   - self-scope（业务 session）：写 objects/<self>/self.md → 落该 session worktree（方案 A
 *     `flows/s/objects/<id>/`）；main 不变，经 super flow create_pr_and_invite_reviewers 合入才永久。
 *   - cross-scope（业务 session 写别人 stone）：同样落该 session worktree；main 不变（cross-scope
 *     的 PR 治理由后续 create_pr_and_invite_reviewers 算 reviewers，不在 write_file 内）。
 *   - non-stone：写 pools/ → 直写，不进 git。
 *   - super flow 写 stone 自治区（非业务 session、无 feat 绑定）→ throw（绝不裸写 main）。
 *   - stones/main 根下非 objects/ 资源（workspace-level）→ throw，不静默直写。
 *   - thread 缺 persistence.objectId → throw，不静默直写。
 *   - feat 绑定下写 pools/ → 直写 + 注入 write-through 提示（不静默）。
 *
 * Wave 4 契约迁移：旧的独立 `writeFileExec(ctx) => { ok, window, error }` 退役 → file.construct
 * `exec(ctx, args) => Data{path}`（成功返回实际落点 path；失败 **throw**，不再 `{ ok:false }`）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests } from "@ooc/core/persistable";
import { construct as fileConstruct } from "@ooc/builtins/filesystem/file/executable/construct.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import type { Data as FileData } from "@ooc/builtins/filesystem/file/types.js";

let tempRoots: string[] = [];

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

/** 建一个干净 world：bootstrap repo + 给定 agent，每个 agent 一个 self.md + package.json。 */
async function newWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-write-file-versioning-"));
  tempRoots.push(baseDir);
  for (const id of [...agents, "supervisor"]) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
    // package.json 让 classifyPackagesPath 把它识别为 object package（stone 自治区）。
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
  return baseDir;
}

/** 驱动 write_file = file.construct（带 content 分支）；成功返回 Data{path}，失败 throw。 */
function writeFile_construct(
  baseDir: string,
  objectId: string | undefined,
  args: Record<string, unknown>,
  overrides: { sessionId?: string; stonesBranch?: string; events?: unknown[] } = {},
): Promise<FileData> {
  const persistence: Record<string, unknown> = {
    baseDir,
    sessionId: overrides.sessionId ?? "s",
    threadId: "t",
  };
  if (objectId !== undefined) persistence.objectId = objectId;
  if (overrides.stonesBranch) persistence.stonesBranch = overrides.stonesBranch;
  return fileConstruct.exec(
    { persistence, args } as unknown as ConstructorContext,
    args,
  ) as Promise<FileData>;
}

function mainObjectsDir(baseDir: string): string {
  return join(baseDir, "stones", "main", "objects");
}
function worktreeObjectsDir(baseDir: string, sid = "s"): string {
  return join(baseDir, "flows", sid, "objects");
}

describe("write_file stone-versioning routing (file.construct)", () => {
  test("self-scope（业务 session）: 写 stones/<self>/self.md → 落 worktree，main 不变", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const data = await writeFile_construct(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/self.md",
      content: "agent_of_x v2 via write_file\n",
    });
    // Data.path 指向 worktree 物理落点（方案 A：flows/s/objects/...）
    expect(data.path).toBe(
      join(worktreeObjectsDir(baseDir), "agent_of_x", "self.md"),
    );

    // worktree 文件写入新内容
    expect(await readFile(data.path, "utf8")).toBe("agent_of_x v2 via write_file\n");

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
    const data = await writeFile_construct(baseDir, "agent_of_x", {
      path: "stones/agent_of_x/server/index.ts",
      content: "export const methods = {};\n",
    });
    expect(await readFile(data.path, "utf8")).toBe("export const methods = {};\n");
    expect(data.path).toBe(
      join(worktreeObjectsDir(baseDir), "agent_of_x", "server", "index.ts"),
    );
    // main 上没有该新文件（未合入）
    await expect(
      readFile(join(mainObjectsDir(baseDir), "agent_of_x", "server", "index.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("super flow: write_file 写 stone 自治区 → throw（非业务 session、无 feat 绑定），main 不变", async () => {
    // 去 metaprog：stone 写的合法落点是「业务 session worktree」（LLM 试验，经
    // create_pr_and_invite_reviewers 合入）与「HTTP 控制面直写 main」（人类已决策）。super flow 既非
    // 业务 session（sessionUsesWorktree("super")=false）也非 HTTP，其角色是 PR 合入闸门、不是 stone
    // 作者——故 super session 内 write_file 写 stone 自治区 throw，不再裸 commit main。
    const baseDir = await newWorld(["agent_of_x"]);
    await expect(
      writeFile_construct(
        baseDir,
        "agent_of_x",
        { path: "stones/agent_of_x/self.md", content: "agent_of_x v2 via super write_file\n" },
        { sessionId: "super" },
      ),
    ).rejects.toThrow(/业务 session/);

    // main 未变（throw，不裸写）
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v1\n");
  });

  test("cross-scope（业务 session）: 写别人 stone → 落本 session worktree，main 不变", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y"]);
    const data = await writeFile_construct(baseDir, "agent_of_x", {
      path: "stones/agent_of_y/self.md",
      content: "agent_of_y edited by x\n",
    });
    // 落点是 agent_of_x 的业务 session worktree（cross-scope 也走 worktree，不直接落 main）。
    expect(data.path).toBe(join(worktreeObjectsDir(baseDir), "agent_of_y", "self.md"));
    expect(await readFile(data.path, "utf8")).toBe("agent_of_y edited by x\n");
    // main 工作区**未**被改（cross-scope 不直接落 main）
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_y", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_y v1\n");
  });

  test("non-stone: 写 pools/ → 直写，不进 git", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const data = await writeFile_construct(baseDir, "agent_of_x", {
      path: "pools/agent_of_x/data/events.csv",
      content: "a,b\n1,2\n",
    });
    // 文件落在 pools/agent_of_x/...（rewritePoolsPath 不再注入 objects/），不在 stones 树
    expect(data.path).toBe(join(baseDir, "pools", "agent_of_x", "data", "events.csv"));
    expect(await readFile(data.path, "utf8")).toBe("a,b\n1,2\n");
  });

  test("stones-world: 写 stones/main/ 根下非 objects/ 资源 → throw，不静默直写", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    await expect(
      writeFile_construct(baseDir, "agent_of_x", {
        // 显式 main/ 前缀 → resolveSessionPath 不再注入 objects/，落在 stones/main/ 根。
        path: "stones/main/README.md",
        content: "workspace doc\n",
      }),
    ).rejects.toThrow(/workspace-level/);

    // 没有静默直写：throw 应当不创建该文件
    await expect(
      readFile(join(baseDir, "stones", "main", "README.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("nested child（业务 session）: 写 stones/<parent>/children/<child>/self.md → 落 worktree，main 不变", async () => {
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

    // child 用完整 objectId "parent/child"；LLM 写路径用 "/" 编码 → resolveSessionPath
    // 注入 objects/ + nestedObjectPath 物理翻译。
    const data = await writeFile_construct(baseDir, "parent/child", {
      path: "stones/parent/children/child/self.md",
      content: "child v2 via write_file\n",
    });
    // worktree 落点（方案 A）：flows/s/objects/parent/children/child/self.md
    expect(data.path).toBe(
      join(worktreeObjectsDir(baseDir), "parent", "children", "child", "self.md"),
    );
    expect(await readFile(data.path, "utf8")).toBe("child v2 via write_file\n");
    // main 不变
    const onMain = await readFile(
      join(mainObjectsDir(baseDir), "parent", "children", "child", "self.md"),
      "utf8",
    );
    expect(onMain).toBe("child v1\n");
  });

  test("throw: 路径在 stones 自治区但 thread 缺 objectId → 不静默直写", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    await expect(
      writeFile_construct(baseDir, undefined, {
        path: "stones/agent_of_x/self.md",
        content: "x\n",
      }),
    ).rejects.toThrow(/persistence\.objectId/);

    // 自治区文件未被裸写
    const onMain = await readFile(join(mainObjectsDir(baseDir), "agent_of_x", "self.md"), "utf8");
    expect(onMain).toBe("agent_of_x v1\n");
  });

  // reflectable 回归：feat 分支绑定生效时写 pool 路径 = write-through 立即生效、**不进本 PR**。
  // 此前静默直写无任何提示 → 随后 create_pr_and_invite_reviewers 发现 feat 分支无 stone 改动报
  // NO_CHANGES，LLM 困惑。断言：feat 绑定下写 pool 注入显式提示。
  test("feat 绑定下写 pools/ → 直写 + 注入 write-through 提示（不静默）", async () => {
    const baseDir = await newWorld(["agent_of_x"]);
    const events: unknown[] = [];
    const data = await writeFile_construct(
      baseDir,
      "agent_of_x",
      { path: "pools/agent_of_x/knowledge/memory/note.md", content: "记一笔\n" },
      { sessionId: "super", stonesBranch: "feat/agent-of-x-mem", events },
    );

    // 文件确实落 pool（write-through 语义不变）
    expect(data.path).toBe(
      join(baseDir, "pools", "agent_of_x", "knowledge", "memory", "note.md"),
    );
    expect(await readFile(data.path, "utf8")).toBe("记一笔\n");

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
