/**
 * Stones git versioning e2e —— 端到端跑一遍 stone 写 → 合入 main 的协议，覆盖 origin
 * doc AE1-AE8 的关键 happy path。
 *
 * 去固化 metaprog method（2026-06-09，docs/2026-06-09-remove-metaprog-unify-session-worktree-design.md）：
 * stone 写不走固化命令，而是——
 * - 业务 session 内 `write_file` 写**任何** stone（own + cross）→ 落 session worktree；
 * - super flow 内 `evolve_self` 把该业务 session 的 worktree 改动合入 main
 *   （self-scope ff-merge / cross-scope → PR-Issue）；
 * - 治理两动作（resolve PR-Issue / rollback stone）经控制面 HTTP 端点行使，底层走
 *   persistable 的 resolvePrIssue / rollback（保留不动）；本测试直接调这两个函数验证 git 协议。
 *
 * 不依赖真 LLM，直接调 method exec / persistable 函数（绕过 LLM 解析）；fixture 用 mkdtemp 的干净 world。
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetSerialQueueForTests,
  readPrIssueIndex,
  ensureStoneRepo,
  resolvePrIssue,
  rollback,
  SUPERVISOR_OBJECT_ID,
} from "@ooc/core/persistable";
import { executeWriteFileMethod } from "@ooc/builtins/root/executable/method.write-file";
import { executeEvolveSelf } from "@ooc/builtins/root/executable/method.evolve-self";
import { runRecoveryCheck } from "@ooc/core/app/server/bootstrap/recovery-check";
import type { MethodExecutionContext } from "@ooc/core/executable/windows/_shared/method-types";

let tempRoot: string | undefined;

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newWorld(agents: string[]): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-stones-git-e2e-"));
  // flat 布局 stones/<id>/ → ensureStoneRepo 建 .stones_repo bare + main worktree 并迁移。
  // session worktree 模型（去 metaprog 后唯一写路径）需要 bare repo 才能 `git worktree add`。
  for (const id of agents) {
    await mkdir(join(tempRoot, "stones", id), { recursive: true });
    await writeFile(join(tempRoot, "stones", id, "self.md"), `${id} v1\n`);
    // package.json 是 StoneRegistry 登记 stone 的前提（recovery-check 经 registry 枚举）
    await writeFile(
      join(tempRoot, "stones", id, "package.json"),
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
  await ensureStoneRepo({ baseDir: tempRoot });
  return tempRoot;
}

/** 业务 session ctx（write_file 落 session worktree）。 */
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

/** super flow ctx（evolve_self 合入 creatorSessionId 的 worktree）。 */
function superCtx(
  baseDir: string,
  objectId: string,
  creatorSessionId: string,
  args: Record<string, unknown>,
): MethodExecutionContext {
  return {
    thread: {
      persistence: { baseDir, objectId, sessionId: "super", threadId: "tS" },
      creatorSessionId,
      contextWindows: [],
      events: [],
    },
    args,
  } as unknown as MethodExecutionContext;
}

describe("e2e: AE1 self-scope ff merge（write_file → evolve_self）", () => {
  test("write_file own stone → evolve_self → main 推进且 worktree 销毁", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);

    // 1. 业务 session s1 内 write_file 改自己 self.md → 落 session worktree（main 不变）
    const w = await executeWriteFileMethod(
      bizCtx(baseDir, "agent_of_x", "s1", { path: "stones/agent_of_x/self.md", content: "v2\n" }),
    );
    expect(typeof w === "object" && w !== null && w.ok === true).toBe(true);
    expect(await readFile(join(baseDir, "stones", "main", "objects", "agent_of_x", "self.md"), "utf8")).toBe(
      "agent_of_x v1\n",
    );

    // 2. super flow evolve_self（creatorSessionId=s1）→ self-scope ff-merge 到 main
    const mergeRaw = await executeEvolveSelf(superCtx(baseDir, "agent_of_x", "s1", { message: "update self" }));
    const merged = JSON.parse(mergeRaw as string);
    expect(merged.ok).toBe(true);
    expect(merged.kind).toBe("merged");

    // 3. main 上 self.md 是 v2；session worktree 身份解除（.git link 删）、运行时目录保留（对话不随 evolve 丢失）
    expect(await readFile(join(baseDir, "stones", "main", "objects", "agent_of_x", "self.md"), "utf8")).toBe("v2\n");
    await expect(stat(join(baseDir, "flows", "s1", ".git"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("e2e: AE2/AE7 cross-scope → PR-Issue（write_file 别人 stone → evolve_self）", () => {
  test("业务 session 改了别人的 stone → evolve_self 整体走 PR-Issue", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y", "supervisor"]);

    // 业务 session s1：caller=agent_of_x 改自己 + agent_of_y（cross-object）→ 同一 worktree
    await executeWriteFileMethod(
      bizCtx(baseDir, "agent_of_x", "s1", { path: "stones/agent_of_x/self.md", content: "x edits self\n" }),
    );
    await executeWriteFileMethod(
      bizCtx(baseDir, "agent_of_x", "s1", { path: "stones/agent_of_y/self.md", content: "x edits y\n" }),
    );

    const merge = JSON.parse(
      (await executeEvolveSelf(superCtx(baseDir, "agent_of_x", "s1", { message: "cross" }))) as string,
    );
    expect(merge.ok).toBe(true);
    expect(merge.kind).toBe("pr-issue");
    expect(typeof merge.prIssueId).toBe("number");

    // PR-Issue 落在 super session
    const index = await readPrIssueIndex(baseDir);
    const prIssue = index.issues.find((i: { id: number }) => i.id === merge.prIssueId);
    expect(prIssue).toBeDefined();
    expect(prIssue?.title.startsWith("[PR]")).toBe(true);

    // main 上 agent_of_y/self.md 仍是 v1（cross-scope 不直接合入）
    const yMain = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(yMain).toBe("agent_of_y v1\n");
  });
});

describe("e2e: supervisor resolve merge / reject", () => {
  test("supervisor resolve(merge) → main 推进；resolve(reject) → branch archived, main 不变", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y", "supervisor"]);

    // 准备一个 cross-scope PR：业务 session s1 改 agent_of_y → evolve_self → PR-Issue
    await executeWriteFileMethod(
      bizCtx(baseDir, "agent_of_x", "s1", { path: "stones/agent_of_y/self.md", content: "approved\n" }),
    );
    const m1 = JSON.parse(
      (await executeEvolveSelf(superCtx(baseDir, "agent_of_x", "s1", { message: "ok" }))) as string,
    );
    expect(m1.kind).toBe("pr-issue");

    // supervisor resolve merge（控制面治理：底层 persistable resolvePrIssue）
    const r1 = await resolvePrIssue({ baseDir, issueId: m1.prIssueId, decision: "merge" });
    expect(r1.ok).toBe(true);
    expect(r1.ok && r1.kind).toBe("merged");

    // y/self.md 已合并
    const y = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(y).toBe("approved\n");

    // 准备第二个 cross-scope PR 走 reject（新业务 session s2）
    await executeWriteFileMethod(
      bizCtx(baseDir, "agent_of_x", "s2", { path: "stones/agent_of_y/self.md", content: "rejected change\n" }),
    );
    const m2 = JSON.parse(
      (await executeEvolveSelf(superCtx(baseDir, "agent_of_x", "s2", { message: "rej" }))) as string,
    );
    expect(m2.kind).toBe("pr-issue");

    const r2 = await resolvePrIssue({ baseDir, issueId: m2.prIssueId, decision: "reject" });
    expect(r2.ok).toBe(true);
    expect(r2.ok && r2.kind).toBe("rejected");

    // main 上 y/self.md 仍是 "approved"（未被 rejected 的 PR 改回去）
    const y2 = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(y2).toBe("approved\n");
  });
});

describe("e2e: AE4/AE8 supervisor rollback + Supervisor 例外", () => {
  test("supervisor rollback 恢复 broken stone；author 是 supervisor", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);

    // 回滚目标 = broken 改动之前的 HEAD（含 agent_of_x v1 的 objects/）。
    // ensureStoneRepo 的 seed 初始 commit 不含 objects/，不能作 target——取迁移后的 HEAD。
    const headLog = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    const target = new TextDecoder().decode(headLog.stdout).trim();

    // 让 agent_of_x 在业务 session 改自己并 evolve_self 合入一个新版本（broken-v2）
    await executeWriteFileMethod(
      bizCtx(baseDir, "agent_of_x", "s1", { path: "stones/agent_of_x/self.md", content: "broken-v2\n" }),
    );
    await executeEvolveSelf(superCtx(baseDir, "agent_of_x", "s1", { message: "broken" }));

    // supervisor rollback（控制面治理：底层 persistable rollback，supervisorAuthor=SUPERVISOR_OBJECT_ID）
    const r = await rollback({
      baseDir,
      objectId: "agent_of_x",
      targetCommit: target,
      supervisorAuthor: SUPERVISOR_OBJECT_ID,
    });
    expect(r.ok).toBe(true);

    // self.md 回到 v1
    const restored = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_x", "self.md"), "utf8");
    expect(restored).toBe("agent_of_x v1\n");

    // author = supervisor
    const author = Bun.spawnSync(["git", "log", "-1", "--pretty=format:%an"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    expect(new TextDecoder().decode(author.stdout)).toBe("supervisor");
  });

  test("persistable rollback 强制 supervisorAuthor === SUPERVISOR_OBJECT_ID（非 supervisor author → FORBIDDEN）", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    // 控制面 governance 端点固定传 SUPERVISOR_OBJECT_ID；此处直接以非 supervisor author 调
    // 底层函数验证最深防御线（R12 enforcement at persistable layer）。
    const r = await rollback({
      baseDir,
      objectId: "agent_of_x",
      targetCommit: "HEAD",
      supervisorAuthor: "agent_of_x",
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("FORBIDDEN");
  });

  test("resolve 不存在的 PR-Issue → NOT_FOUND", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    const r = await resolvePrIssue({ baseDir, issueId: 9999, decision: "merge" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("NOT_FOUND");
  });
});

describe("e2e: AE5 flows/ 不入 git", () => {
  test("写 flows/ 下文件，git status 不报告", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    await mkdir(join(baseDir, "flows", "session-1"), { recursive: true });
    await writeFile(join(baseDir, "flows", "session-1", "test.json"), "{}");

    // git status 在 stones/main/ 下应当干净（不知道 flows/）
    const status = Bun.spawnSync(["git", "status", "--porcelain"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    expect(new TextDecoder().decode(status.stdout)).toBe("");
  });
});

describe("e2e: U8 recovery-check 端到端", () => {
  test("broken stone 的 executable/index.ts → 启动期产 [recovery-needed] PR-Issue", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    // 故意写坏 agent_of_x 的 canonical executable/index.ts（recovery-check 经 registry 扫此处）
    await mkdir(join(baseDir, "stones", "main", "objects", "agent_of_x", "executable"), { recursive: true });
    await writeFile(
      join(baseDir, "stones", "main", "objects", "agent_of_x", "executable", "index.ts"),
      "this is &^&^ not valid &@!!\n",
    );

    const r = await runRecoveryCheck({ baseDir });
    expect(r.broken.length).toBe(1);
    expect(r.newIssues.length).toBe(1);

    const idx = await readPrIssueIndex(baseDir);
    expect(idx.issues.some((i: { title: string }) => i.title.startsWith("[recovery-needed] agent_of_x"))).toBe(true);
  });
});
