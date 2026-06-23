/**
 * flows-worktree-migration —— 方案 A 真实-world 集成实测。
 *
 * 验证 session worktree 物理布局从 `stones/session-<sid>` 迁到 `flows/<sid>`、改 eager、
 * 运行时文件由 main 根 .gitignore 排除 的端到端正确性。单测 PASS≠真路由通——本测试
 * 走真实 bootstrap + ensureSessionWorktree + write_file(builtin) 链路，断言落点/排除/
 * 写路由（gate 5 的 a/b/c）。
 *
 * 地基不变量：`session-<sid>` worktree 是纯运行时派生物，**永不合入 main**
 * （旧 evolveSelfMerge session→main 合入已退役）。session 编辑停在 worktree；进 canonical
 * 走 reflectable feat-branch PR（见 stone-feat-branch.test）。本测试 (c) 后断言「main 不变」。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureStoneRepo,
  ensureSessionWorktree,
  createFlowSession,
  createFlowObject,
  sessionMetadataFile,
  __resetSerialQueueForTests,
} from "@ooc/core/persistable";
import { writeThread } from "@ooc/core/persistable/thread-container-io.js";
import { scanRunningThreads } from "@ooc/core/app/server/runtime/thread-query";
import { construct as fileConstruct } from "@ooc/builtins/filesystem/children/file/executable/construct.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";

let tempRoot: string | undefined;

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

/** bootstrap 一个临时 world（`_test_flowswt_<ts>` 前缀），落 agents 的 self.md 入 main。 */
async function bootstrapWorld(agents: string[]): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), `_test_flowswt_${Date.now()}_`));
  tempRoot = baseDir;
  for (const id of agents) {
    await mkdir(join(baseDir, "stones", id), { recursive: true });
    await writeFile(join(baseDir, "stones", id, "self.md"), `${id} v1\n`);
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
  // ensureStoneRepo：迁 flat→main、建 bare repo、写 main 根 .gitignore（方案 A）。
  await ensureStoneRepo({ baseDir });
  return baseDir;
}

/**
 * 业务 session 的 write_file 构造上下文（落 session worktree）。
 *
 * Wave4 后 write_file 的写盘/worktree 重定向逻辑下沉到 file 对象的 constructor
 * （`_builtin/filesystem/file`，construct.exec(ctx, args) => Data，失败 throw）。
 * 这里直调 construct 验证 worktree 落点路由——和旧 writeFileExec 等价行为。
 */
function bizCtx(
  baseDir: string,
  objectId: string,
  sessionId: string,
  args: Record<string, unknown>,
): ConstructorContext {
  return {
    ownerThread: {
      persistence: { baseDir, objectId, sessionId, threadId: "t" },
      contextWindows: [],
      events: [],
    },
    args,
  } as unknown as ConstructorContext;
}

function gitStatusPorcelain(repoDir: string): string {
  const r = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return new TextDecoder().decode(r.stdout ?? new Uint8Array());
}

describe("flows-worktree-migration（方案 A 真实-world 实测）", () => {
  test("a/b/c：worktree 落 flows/<sid> + gitignore 排除运行时 + 写 self 落 worktree（main 不变，session 永不合入）", async () => {
    const sid = "s1";
    const objectId = "agent_of_x";
    const baseDir = await bootstrapWorld([objectId]);

    // ---- (a) eager 建 worktree：flows/<sid> 是 worktree（有 .git）+ objects/ 含 main stone ----
    const ok = await ensureSessionWorktree(baseDir, sid);
    expect(ok).toBe(true);

    const wtRoot = join(baseDir, "flows", sid);
    // .git worktree link 文件存在 → 证明 flows/<sid> 是 git worktree，而非普通目录
    expect((await stat(join(wtRoot, ".git"))).isFile()).toBe(true);
    // objects/ 含 main checkout 出的 stone 文件
    const selfInWt = await readFile(join(wtRoot, "objects", objectId, "self.md"), "utf8");
    expect(selfInWt).toBe(`${objectId} v1\n`);

    // ---- (b) 写运行时数据后 git status 不列运行时文件（gitignore 黑名单生效）----
    // createFlowSession 写 .session.json（session 级运行时，幂等 mkdir 命中已建 worktree）
    await createFlowSession(baseDir, sid);
    expect((await stat(sessionMetadataFile(baseDir, sid))).isFile()).toBe(true);
    // 写一个 flow object 运行时目录（objectDir 续案 = flows/<sid>/objects/<objectId>）+ .flow.json
    await createFlowObject({ baseDir, sessionId: sid, objectId });
    // .flow.json 落 objects/<id>/ 下，与 stone identity 同目录
    expect((await stat(join(wtRoot, "objects", objectId, ".flow.json"))).isFile()).toBe(true);
    // 再写一个 threads/ 运行时文件（objects/<id>/threads/root/thread.json）
    await mkdir(join(wtRoot, "objects", objectId, "threads", "root"), { recursive: true });
    await writeFile(
      join(wtRoot, "objects", objectId, "threads", "root", "thread.json"),
      "{}\n",
      "utf8",
    );

    const statusBefore = gitStatusPorcelain(wtRoot);
    // 运行时产物全部 untracked-excluded：不出现在 porcelain 输出
    expect(statusBefore).not.toContain(".session.json");
    expect(statusBefore).not.toContain(".flow.json");
    expect(statusBefore).not.toContain("thread.json");
    expect(statusBefore).not.toContain(`objects/${objectId}/threads`);
    // 此刻还没改 stone 身份文件 → 工作树对 git 而言干净（黑名单吃掉所有运行时）
    expect(statusBefore.trim()).toBe("");

    // ---- (c) 在该 session write_file 改自己 self.md → 落 flows/<sid>/objects/<id>/self.md，main 不变 ----
    // construct.exec(ctx, args) 返回 Data{path}=实际写入落点（worktree 重定向后）；失败 throw。
    const out = (await fileConstruct.exec(
      bizCtx(baseDir, objectId, sid, {
        path: `stones/${objectId}/self.md`,
        content: `${objectId} v2 (session edit)\n`,
      }),
      { path: `stones/${objectId}/self.md`, content: `${objectId} v2 (session edit)\n` },
    )) as { path: string };
    // 写盘落点重定向到 worktree（不是裸 main 路径）
    expect(out.path).toContain(join("flows", sid));

    // worktree 内 self.md 是 v2
    const wtSelf = await readFile(join(wtRoot, "objects", objectId, "self.md"), "utf8");
    expect(wtSelf).toBe(`${objectId} v2 (session edit)\n`);
    // canonical main 仍 v1（未合入）
    const mainSelf = await readFile(
      join(baseDir, "stones", "main", "objects", objectId, "self.md"),
      "utf8",
    );
    expect(mainSelf).toBe(`${objectId} v1\n`);
    // git status 现在只列 objects/ 改动（运行时仍被排除）
    const statusAfter = gitStatusPorcelain(wtRoot);
    expect(statusAfter).toContain(`objects/${objectId}/self.md`);
    expect(statusAfter).not.toContain(".session.json");
    expect(statusAfter).not.toContain("thread.json");

    // ---- 地基不变量：session worktree 是纯运行时派生物，永不合入 main ----
    // 没有 session→main 合入路径；session 编辑停在 worktree（v2），canonical main 永远 v1，
    // 直到经独立 feat-branch PR 沉淀（stone-feat-branch.test 覆盖）才进 main。
    const mainSelfFinal = await readFile(
      join(baseDir, "stones", "main", "objects", objectId, "self.md"),
      "utf8",
    );
    expect(mainSelfFinal).toBe(`${objectId} v1\n`);
    // worktree 仍是活 worktree（.git link 在），运行时数据保留——session 仍可见可续
    expect((await stat(join(wtRoot, ".git"))).isFile()).toBe(true);
    expect(
      (await stat(join(wtRoot, "objects", objectId, "threads", "root", "thread.json"))).isFile(),
    ).toBe(true);
  });

  test("gate-5：运行时与 stone identity 同落 objects/<id>/ + listThreads 枚举 + gitignore 黑名单", async () => {
    const sid = "_test_g5";
    const objectId = "agent_of_x";
    const baseDir = await bootstrapWorld([objectId]);

    const ok = await ensureSessionWorktree(baseDir, sid);
    expect(ok).toBe(true);
    const wtRoot = join(baseDir, "flows", sid);

    await createFlowSession(baseDir, sid);
    await createFlowObject({ baseDir, sessionId: sid, objectId });

    // 写一个完整 thread（用 writeThread 走真实落盘路径），确保 listThreads 能枚举。
    await writeThread(
      {
        persistence: { baseDir, objectId, sessionId: sid, threadId: "root" },
        contextWindows: [],
        events: [],
        status: "running",
      } as never,
    );

    // ---- (a) 运行时数据落 flows/<sid>/objects/<id>/，不再在 flows/<sid>/<id>/ ----
    expect((await stat(join(wtRoot, "objects", objectId, ".flow.json"))).isFile()).toBe(true);
    expect(
      (await stat(join(wtRoot, "objects", objectId, "threads", "root", "thread.json"))).isFile(),
    ).toBe(true);
    // 旧扁平落点不存在
    await expect(stat(join(wtRoot, objectId, ".flow.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    // ---- (b) stone identity 也在 flows/<sid>/objects/<id>/self.md（同目录） ----
    const selfInWt = await readFile(join(wtRoot, "objects", objectId, "self.md"), "utf8");
    expect(selfInWt).toBe(`${objectId} v1\n`);

    // ---- (c) git status 不列任何运行时文件（gitignore 黑名单生效），stone 改动正常可见 ----
    const statusClean = gitStatusPorcelain(wtRoot);
    expect(statusClean).not.toContain(".flow.json");
    expect(statusClean).not.toContain("thread.json");
    expect(statusClean).not.toContain(".session.json");
    expect(statusClean.trim()).toBe("");
    // 改 stone 身份文件 → git status 列出该改动
    await writeFile(join(wtRoot, "objects", objectId, "self.md"), `${objectId} v2\n`, "utf8");
    const statusDirty = gitStatusPorcelain(wtRoot);
    expect(statusDirty).toContain(`objects/${objectId}/self.md`);

    // ---- (d) walkObjectDir（scanThreadsByStatus 同款 flows/<sid>/objects/ 入口）能枚举该 session 的 thread ----
    const running = await scanRunningThreads(baseDir, sid);
    const match = running.find((i) => i.objectId === objectId && i.threadId === "root");
    expect(match).toBeDefined();
  });
});
