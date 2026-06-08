/**
 * flows-worktree-migration —— 方案 A 真实-world 集成实测
 * （docs/2026-06-09-remove-metaprog-unify-session-worktree-design.md §1bis）。
 *
 * 验证 session worktree 物理布局从 `stones/session-<sid>` 迁到 `flows/<sid>`、改 eager、
 * 运行时文件由 main 根 .gitignore 排除 的端到端正确性。单测 PASS≠真路由通——本测试
 * 走真实 bootstrap + ensureSessionWorktree + write_file(builtin) + evolveSelfMerge 链路，
 * 断言落点/排除/合入四件事（gate 5 的 a/b/c/d）。
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
import { evolveSelfMerge } from "@ooc/core/programmable/evolve-self";
import { executeWriteFileMethod } from "@ooc/builtins/root/executable/method.write-file";
import type { MethodExecutionContext } from "@ooc/core/executable/windows/_shared/method-types";

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

/** 业务 session 的 write_file ctx（落 session worktree）。 */
function bizCtx(
  baseDir: string,
  objectId: string,
  sessionId: string,
  args: Record<string, unknown>,
): MethodExecutionContext {
  return {
    thread: {
      persistence: { baseDir, objectId, sessionId, threadId: "t" },
      contextWindows: [],
      events: [],
    },
    args,
  } as unknown as MethodExecutionContext;
}

/** super flow 的 evolve_self 经 evolveSelfMerge（creatorSessionId = 业务 session）。 */
function gitStatusPorcelain(repoDir: string): string {
  const r = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return new TextDecoder().decode(r.stdout ?? new Uint8Array());
}

describe("flows-worktree-migration（方案 A 真实-world 实测）", () => {
  test("a/b/c/d：worktree 落 flows/<sid> + gitignore 排除运行时 + 写 self 落 worktree + evolve 合入", async () => {
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

    // ---- (b) 写运行时数据后 git status 不列运行时文件（gitignore 生效），只可能列 objects/ ----
    // createFlowSession 写 .session.json（运行时，幂等 mkdir 命中已建 worktree）
    await createFlowSession(baseDir, sid);
    expect((await stat(sessionMetadataFile(baseDir, sid))).isFile()).toBe(true);
    // 写一个 flow object 运行时目录（objectDir = flows/<sid>/<objectId>，无 objects/ 前缀）+ .flow.json
    await createFlowObject({ baseDir, sessionId: sid, objectId });
    // 再写一个 threads/ 运行时文件
    await mkdir(join(wtRoot, objectId, "threads", "root"), { recursive: true });
    await writeFile(join(wtRoot, objectId, "threads", "root", "thread.json"), "{}\n", "utf8");

    const statusBefore = gitStatusPorcelain(wtRoot);
    // 运行时产物全部 untracked-excluded：不出现在 porcelain 输出
    expect(statusBefore).not.toContain(".session.json");
    expect(statusBefore).not.toContain(".flow.json");
    expect(statusBefore).not.toContain("thread.json");
    expect(statusBefore).not.toContain(`${objectId}/threads`);
    // 此刻还没写 objects/ → 工作树对 git 而言干净
    expect(statusBefore.trim()).toBe("");

    // ---- (c) 在该 session write_file 改自己 self.md → 落 flows/<sid>/objects/<id>/self.md，main 不变 ----
    const out = await executeWriteFileMethod(
      bizCtx(baseDir, objectId, sid, {
        path: `stones/${objectId}/self.md`,
        content: `${objectId} v2 (session edit)\n`,
      }),
    );
    expect(typeof out === "object" && out !== null && (out as { ok?: boolean }).ok === true).toBe(true);

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

    // ---- (d) super flow evolve_self 合入：self-scope ff-merge → main 推进到 v2，worktree GC ----
    const merge = await evolveSelfMerge({
      baseDir,
      objectId,
      creatorSessionId: sid,
      message: "evolve: session self edit",
    });
    expect(merge.ok).toBe(true);
    if (merge.ok) {
      expect(merge.kind).toBe("merged");
      expect(merge.merged).toBe(true);
      expect(merge.files).toEqual([`${objectId}/self.md`]);
    }
    // main 已推进到 v2
    const mainSelfAfter = await readFile(
      join(baseDir, "stones", "main", "objects", objectId, "self.md"),
      "utf8",
    );
    expect(mainSelfAfter).toBe(`${objectId} v2 (session edit)\n`);
    // worktree 身份已解除（.git link 删除），但目录与运行时数据保留——session 对话历史不随 evolve 丢失
    expect((await stat(wtRoot)).isDirectory()).toBe(true);
    await expect(stat(join(wtRoot, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    // 运行时数据（thread.json）仍在
    expect((await stat(join(wtRoot, objectId, "threads", "root", "thread.json"))).isFile()).toBe(true);
  });
});
