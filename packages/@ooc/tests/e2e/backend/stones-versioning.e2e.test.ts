/**
 * Stones git versioning e2e —— 端到端跑 reflectable 沉淀（feat-branch PR）→ 治理合入/驳回/回滚的协议。
 *
 * 地基不变量：
 * `session-<sid>` worktree 是纯运行时派生物，**永不合入 main**——旧 session→main 合入语义
 * （write_file → super flow create_pr_and_invite_reviewers ff/PR 二元闸）已退役。沉淀进 canonical 走：
 * - super flow 内 `new_feat_branch(intent)` 开 feat 分支并绑定 thread → 普通 write_file 直接
 *   编辑 feat worktree 下文件 → `create_pr_and_invite_reviewers` finalize（commit + 开 PR + 清绑定），main 暂不变；
 * - 治理（resolve PR-Issue / rollback stone）经控制面 HTTP 端点，底层走 persistable 的
 *   resolvePrIssue / rollback（interim 合入通道，保留不动）；本测试直接调验证 git 协议。
 *
 * 不依赖真 LLM，直接调 method exec / persistable 函数；fixture 用 mkdtemp 的干净 world。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetSerialQueueForTests,
  readPrIssueIndex,
  readPrIssue,
  ensureStoneRepo,
  resolvePrIssue,
  rollback,
  SUPERVISOR_OBJECT_ID,
} from "@ooc/core/persistable";
import { executeCreatePrAndInviteReviewers } from "@ooc/core/reflectable/reflect-request/method.create-pr-and-invite-reviewers";
import { executeNewFeatBranch } from "@ooc/core/reflectable/reflect-request/method.new-feat-branch";
import { writeFileExec as executeWriteFileMethod } from "@ooc/builtins/filesystem/executable/index.js";
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
  for (const id of agents) {
    await mkdir(join(tempRoot, "stones", id), { recursive: true });
    await writeFile(join(tempRoot, "stones", id, "self.md"), `${id} v1\n`);
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

function mainSelf(baseDir: string, id: string): string {
  return join(baseDir, "stones", "main", "objects", id, "self.md");
}

/**
 * super(foo) 沉淀全流程 helper：new_feat_branch → write_file ×N（直接编辑 feat worktree）→
 * create_pr_and_invite_reviewers finalize。同一可变 thread 携 feat 绑定贯穿三步。返回 create_pr_and_invite_reviewers 的解析结果。
 */
async function sediment(opts: {
  baseDir: string;
  objectId: string;
  intent: string;
  edits: { path: string; content: string }[];
}): Promise<{ ok: boolean; kind?: string; issueId?: number; reviewers?: string[]; paths?: string[] }> {
  const thread = {
    persistence: { baseDir: opts.baseDir, objectId: opts.objectId, sessionId: "super", threadId: "tS" } as Record<string, unknown>,
    contextWindows: [] as unknown[],
    events: [] as unknown[],
  };
  const ctx = (args: Record<string, unknown>) =>
    ({ thread, args }) as unknown as MethodExecutionContext;

  await executeNewFeatBranch(ctx({ intent: opts.intent }));
  for (const e of opts.edits) {
    // edits 的 path 形如 objects/<id>/<file>；write_file 吃概念路径 stones/<id>/<file>。
    const rel = e.path.replace(/^objects\//, "");
    const w = await executeWriteFileMethod(ctx({ path: `stones/${rel}`, content: e.content }));
    if (typeof w === "object" && w !== null && (w as { ok?: boolean }).ok === false) {
      throw new Error(`write_file failed: ${(w as { error?: string }).error}`);
    }
  }
  return JSON.parse((await executeCreatePrAndInviteReviewers(ctx({}))) as string);
}

describe("e2e: self-scope 沉淀（create_pr_and_invite_reviewers → feat-branch PR → resolve merge）", () => {
  test("super(foo) 改自己 → 开 feat PR（reviewers={supervisor}）→ resolve merge → main 推进", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);

    const out = await sediment({
      baseDir,
      objectId: "agent_of_x",
      intent: "update self",
      edits: [{ path: "objects/agent_of_x/self.md", content: "v2\n" }],
    });
    expect(out.ok).toBe(true);
    expect(out.kind).toBe("pr-issue");
    expect(out.reviewers).toEqual(["supervisor"]);
    // main 暂不变（沉淀走 PR）
    expect(await readFile(mainSelf(baseDir, "agent_of_x"), "utf8")).toBe("agent_of_x v1\n");

    const resolved = await resolvePrIssue({ baseDir, issueId: out.issueId!, decision: "merge" });
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.kind).toBe("merged");
    expect(await readFile(mainSelf(baseDir, "agent_of_x"), "utf8")).toBe("v2\n");
  });
});

describe("e2e: cross-scope 沉淀（触及别人 → reviewers 含别人 + supervisor）", () => {
  test("super(x) 改自己 + agent_of_y → feat PR reviewers={agent_of_y, supervisor}，main 暂不变", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y", "supervisor"]);

    const out = await sediment({
      baseDir,
      objectId: "agent_of_x",
      intent: "cross into y",
      edits: [
        { path: "objects/agent_of_x/self.md", content: "x edits self\n" },
        { path: "objects/agent_of_y/self.md", content: "x edits y\n" },
      ],
    });
    expect(out.ok).toBe(true);
    expect(out.reviewers!.sort()).toEqual(["agent_of_y", "supervisor"]);

    // PR-Issue 落在 super session，记录 reviewers
    const index = await readPrIssueIndex(baseDir);
    const prIssue = index.issues.find((i: { id: number }) => i.id === out.issueId);
    expect(prIssue?.title.startsWith("[PR]")).toBe(true);
    expect((await readPrIssue(baseDir, out.issueId!))?.reviewers?.sort()).toEqual(["agent_of_y", "supervisor"]);

    // main 上 agent_of_y/self.md 仍是 v1（PR 未 resolve）
    expect(await readFile(mainSelf(baseDir, "agent_of_y"), "utf8")).toBe("agent_of_y v1\n");
  });
});

describe("e2e: supervisor resolve merge / reject (interim 合入通道)", () => {
  test("resolve(merge) → main 推进；resolve(reject) → branch archived, main 不变", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y", "supervisor"]);

    // feat PR #1 → merge
    const m1 = await sediment({
      baseDir,
      objectId: "agent_of_x",
      intent: "approve y change",
      edits: [{ path: "objects/agent_of_y/self.md", content: "approved\n" }],
    });
    const r1 = await resolvePrIssue({ baseDir, issueId: m1.issueId!, decision: "merge" });
    expect(r1.ok && r1.kind).toBe("merged");
    expect(await readFile(mainSelf(baseDir, "agent_of_y"), "utf8")).toBe("approved\n");

    // feat PR #2 → reject（不同 intent → 不同 feat 分支）
    const m2 = await sediment({
      baseDir,
      objectId: "agent_of_x",
      intent: "rejected y change",
      edits: [{ path: "objects/agent_of_y/self.md", content: "rejected change\n" }],
    });
    const r2 = await resolvePrIssue({ baseDir, issueId: m2.issueId!, decision: "reject" });
    expect(r2.ok && r2.kind).toBe("rejected");
    // main 仍是 approved（reject 不回改）
    expect(await readFile(mainSelf(baseDir, "agent_of_y"), "utf8")).toBe("approved\n");
  });
});

describe("e2e: supervisor rollback + supervisor-only 防御", () => {
  test("supervisor rollback 恢复 broken stone；author 是 supervisor", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    // 回滚目标 = broken 改动之前的 HEAD（含 agent_of_x v1）
    const headLog = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    const target = new TextDecoder().decode(headLog.stdout).trim();

    // 经 feat PR + merge 合入 broken-v2
    const m = await sediment({
      baseDir,
      objectId: "agent_of_x",
      intent: "broken change",
      edits: [{ path: "objects/agent_of_x/self.md", content: "broken-v2\n" }],
    });
    expect((await resolvePrIssue({ baseDir, issueId: m.issueId!, decision: "merge" })).ok).toBe(true);
    expect(await readFile(mainSelf(baseDir, "agent_of_x"), "utf8")).toBe("broken-v2\n");

    const r = await rollback({
      baseDir,
      objectId: "agent_of_x",
      targetCommit: target,
      supervisorAuthor: SUPERVISOR_OBJECT_ID,
    });
    expect(r.ok).toBe(true);
    expect(await readFile(mainSelf(baseDir, "agent_of_x"), "utf8")).toBe("agent_of_x v1\n");

    const author = Bun.spawnSync(["git", "log", "-1", "--pretty=format:%an"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    expect(new TextDecoder().decode(author.stdout)).toBe("supervisor");
  });

  test("persistable rollback 强制 supervisorAuthor === SUPERVISOR_OBJECT_ID（非 supervisor → FORBIDDEN）", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
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

describe("e2e: flows/ 不入 git", () => {
  test("写 flows/ 下文件，stones/main git status 不报告", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    await mkdir(join(baseDir, "flows", "session-1"), { recursive: true });
    await writeFile(join(baseDir, "flows", "session-1", "test.json"), "{}");
    const status = Bun.spawnSync(["git", "status", "--porcelain"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    expect(new TextDecoder().decode(status.stdout)).toBe("");
  });
});

describe("e2e: recovery-check 端到端", () => {
  test("broken stone 的 executable/index.ts → 启动期产 [recovery-needed] PR-Issue", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
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
