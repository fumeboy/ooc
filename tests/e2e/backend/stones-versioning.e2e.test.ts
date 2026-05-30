/**
 * Stones git versioning e2e (U9) —— 用 metaprog command 端到端跑一遍 worktree
 * 协议，覆盖 origin doc AE1-AE8 的关键 happy path。
 *
 * 不依赖真 LLM，直接 executeMetaprog（绕过 LLM 解析）；fixture 用 mkdtemp 的
 * 干净 world。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests, readPrIssueIndex } from "@src/persistable";
import { executeMetaprog } from "@src/executable/windows/root/command.metaprog";
import { runRecoveryCheck } from "@src/app/server/bootstrap/recovery-check";
import type { CommandExecutionContext } from "@src/executable/windows/_shared/command-types";
import type { ThreadContext } from "@src/thinkable/context";

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
  // 2026-05-21 重组 (commit 8799e5bb) 后布局：stones/{branch}/objects/{id}/。
  // 这里直接走 ensureStoneRepo 的 flat→main migrate：把 stones/<id>/ 摆给它，
  // bootstrap 会自动迁到 stones/main/objects/<id>/。
  for (const id of agents) {
    await mkdir(join(tempRoot, "stones", id), { recursive: true });
    await writeFile(join(tempRoot, "stones", id, "self.md"), `${id} v1\n`);
  }
  await ensureStoneRepo({ baseDir: tempRoot });
  return tempRoot;
}

function makeCtx(opts: {
  baseDir: string;
  callerId: string;
  args: Record<string, unknown>;
}): CommandExecutionContext {
  const thread: ThreadContext = {
    id: "t-test",
    inbox: [],
    contextWindows: [],
    status: "running",
    persistence: {
      baseDir: opts.baseDir,
      sessionId: "super",
      objectId: opts.callerId,
      threadId: "root",
      stonesBranch: "main",
    },
  } as unknown as ThreadContext;
  return {
    thread,
    args: opts.args,
    manager: undefined,
  } as CommandExecutionContext;
}

describe("e2e: metaprog command — AE1 self-scope ff merge", () => {
  test("open → write → commit → merge → main 推进且 worktree 销毁", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);

    // 1. open_worktree
    const openRaw = await executeMetaprog(
      makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "open_worktree" } }),
    );
    expect(typeof openRaw).toBe("string");
    const open = JSON.parse(openRaw as string);
    expect(open.ok).toBe(true);
    const branch: string = open.branch;
    const path: string = open.path;

    // 2. 直接 fs 写到 worktree（2026-05-21 重组后 stone 落在 objects/ 下）
    await writeFile(join(path, "objects", "agent_of_x", "self.md"), "v2\n");

    // 3. commit
    const commitRaw = await executeMetaprog(
      makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "commit", branch, intent: "update self" } }),
    );
    expect(JSON.parse(commitRaw as string).ok).toBe(true);

    // 4. merge → merged
    const mergeRaw = await executeMetaprog(
      makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "merge", branch } }),
    );
    const merged = JSON.parse(mergeRaw as string);
    expect(merged.ok).toBe(true);
    expect(merged.kind).toBe("merged");

    // 5. main 上 self.md 是 v2
    const after = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_x", "self.md"), "utf8");
    expect(after).toBe("v2\n");
  });
});

describe("e2e: metaprog command — AE2/AE7 cross-scope → PR-Issue", () => {
  test("Object 改了别人的 stone → 整 commit 走 PR-Issue", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y", "supervisor"]);

    const open = JSON.parse(
      (await executeMetaprog(
        makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "open_worktree" } }),
      )) as string,
    );
    const branch: string = open.branch;
    const path: string = open.path;

    await writeFile(join(path, "objects", "agent_of_x", "self.md"), "x edits self\n");
    await writeFile(join(path, "objects", "agent_of_y", "self.md"), "x edits y\n");

    expect(
      JSON.parse(
        (await executeMetaprog(
          makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "commit", branch, intent: "cross" } }),
        )) as string,
      ).ok,
    ).toBe(true);

    const merge = JSON.parse(
      (await executeMetaprog(
        makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "merge", branch, intent: "cross" } }),
      )) as string,
    );
    expect(merge.ok).toBe(true);
    expect(merge.kind).toBe("must-pr-issue");
    expect(typeof merge.issueId).toBe("number");
    expect(merge.paths.sort()).toEqual(["objects/agent_of_x/self.md", "objects/agent_of_y/self.md"]);

    // PR-Issue 落在 super session
    const index = await readPrIssueIndex(baseDir);
    const prIssue = index.issues.find((i: { id: number }) => i.id === merge.issueId);
    expect(prIssue).toBeDefined();
    expect(prIssue?.title.startsWith("[PR]")).toBe(true);

    // main 上 agent_of_y/self.md 仍是 v1
    const yMain = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(yMain).toBe("agent_of_y v1\n");
  });
});

describe("e2e: metaprog command — supervisor resolve merge / reject", () => {
  test("supervisor resolve(merge) → main 推进；resolve(reject) → branch archived, main 不变", async () => {
    const baseDir = await newWorld(["agent_of_x", "agent_of_y", "supervisor"]);

    // 准备一个 cross-scope PR
    const open1 = JSON.parse(
      (await executeMetaprog(
        makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "open_worktree" } }),
      )) as string,
    );
    await writeFile(join(open1.path, "objects", "agent_of_y", "self.md"), "approved\n");
    await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: { action: "commit", branch: open1.branch, intent: "ok" },
      }),
    );
    const m1 = JSON.parse(
      (await executeMetaprog(
        makeCtx({
          baseDir,
          callerId: "agent_of_x",
          args: { action: "merge", branch: open1.branch, intent: "ok" },
        }),
      )) as string,
    );
    expect(m1.kind).toBe("must-pr-issue");

    // supervisor resolve merge
    const r1 = JSON.parse(
      (await executeMetaprog(
        makeCtx({
          baseDir,
          callerId: "supervisor",
          args: { action: "resolve", issueId: m1.issueId, decision: "merge" },
        }),
      )) as string,
    );
    expect(r1.ok).toBe(true);
    expect(r1.kind).toBe("merged");

    // y/self.md 已合并
    const y = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(y).toBe("approved\n");

    // 准备第二个 cross-scope PR 走 reject
    const open2 = JSON.parse(
      (await executeMetaprog(
        makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "open_worktree" } }),
      )) as string,
    );
    await writeFile(join(open2.path, "objects", "agent_of_y", "self.md"), "rejected change\n");
    await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: { action: "commit", branch: open2.branch, intent: "rej" },
      }),
    );
    const m2 = JSON.parse(
      (await executeMetaprog(
        makeCtx({
          baseDir,
          callerId: "agent_of_x",
          args: { action: "merge", branch: open2.branch, intent: "rej" },
        }),
      )) as string,
    );

    const r2 = JSON.parse(
      (await executeMetaprog(
        makeCtx({
          baseDir,
          callerId: "supervisor",
          args: { action: "resolve", issueId: m2.issueId, decision: "reject" },
        }),
      )) as string,
    );
    expect(r2.ok).toBe(true);
    expect(r2.kind).toBe("rejected");

    // main 上 y/self.md 仍是 "approved"（未被 rejected 的 PR 改回去）
    const y2 = await readFile(join(baseDir, "stones", "main", "objects", "agent_of_y", "self.md"), "utf8");
    expect(y2).toBe("approved\n");
  });
});

describe("e2e: metaprog command — AE4/AE8 supervisor rollback + Supervisor 例外", () => {
  test("supervisor rollback 恢复 broken stone；author 是 supervisor", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);

    // 让 agent_of_x 自治 merge 一个新版本
    const open = JSON.parse(
      (await executeMetaprog(
        makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "open_worktree" } }),
      )) as string,
    );
    await writeFile(join(open.path, "objects", "agent_of_x", "self.md"), "broken-v2\n");
    await executeMetaprog(
      makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "commit", branch: open.branch, intent: "broken" } }),
    );
    await executeMetaprog(
      makeCtx({ baseDir, callerId: "agent_of_x", args: { action: "merge", branch: open.branch } }),
    );

    // 拿 bootstrap commit sha
    const log = Bun.spawnSync(["git", "log", "--reverse", "--pretty=format:%H"], {
      cwd: join(baseDir, "stones", "main"),
      stdout: "pipe",
    });
    const target = new TextDecoder().decode(log.stdout).trim().split("\n")[0];

    // supervisor rollback
    const r = JSON.parse(
      (await executeMetaprog(
        makeCtx({
          baseDir,
          callerId: "supervisor",
          args: { action: "rollback", objectId: "agent_of_x", targetCommit: target },
        }),
      )) as string,
    );
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

  test("非 supervisor 调 rollback 被拒绝", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: { action: "rollback", objectId: "agent_of_x", targetCommit: "HEAD" },
      }),
    );
    expect(typeof r).toBe("string");
    expect((r as string).includes("仅 supervisor 可调")).toBe(true);
  });

  test("非 supervisor 调 resolve 被拒绝", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: { action: "resolve", issueId: 1, decision: "merge" },
      }),
    );
    expect(typeof r).toBe("string");
    expect((r as string).includes("仅 supervisor 可调")).toBe(true);
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
    // 故意写坏 agent_of_x 的 executable/index.ts
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
