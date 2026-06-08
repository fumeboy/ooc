/**
 * method.metaprog caller-guard 单测（治理 action：resolve / rollback）
 *
 * 不跑真 git；只校验 metaprog method 层的 caller-permission 校验。
 * 去 metaprog（2026-06-09）后 metaprog 只剩治理 action；改自己/建别人的写经
 * write_file → session worktree → super flow，不再有 create_object 快捷 action。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests } from "@ooc/core/persistable";
import { executeMetaprog } from "@ooc/builtins/root/executable/method.metaprog";
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/method-types";
import type { ThreadContext } from "@ooc/core/thinkable/context";

let tempRoot: string | undefined;

beforeEach(() => __resetSerialQueueForTests());

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newWorld(agents: string[]): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-metaprog-cmd-"));
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
}): MethodExecutionContext {
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
    },
  } as unknown as ThreadContext;
  return {
    thread,
    args: opts.args,
    manager: undefined,
  } as MethodExecutionContext;
}

describe("metaprog 去 metaprog 后只剩治理 action", () => {
  test("已删的 create_object action → 未知 action（写改自己/建别人改走 write_file）", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "supervisor",
        args: { action: "create_object", objectId: "weather", selfMd: "x", readableMd: "y" },
      }),
    );
    expect(typeof r).toBe("string");
    expect(r).toContain("未知 action 'create_object'");
  });

  test("已删的 open_worktree action → 未知 action", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({ baseDir, callerId: "supervisor", args: { action: "open_worktree" } }),
    );
    expect(r).toContain("未知 action 'open_worktree'");
  });
});

describe("metaprog action=rollback caller-guard", () => {
  test("非 supervisor caller 调 rollback → 拒绝", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: { action: "rollback", objectId: "agent_of_x", targetCommit: "HEAD" },
      }),
    );
    expect(typeof r).toBe("string");
    expect(r).toContain("rollback 仅 supervisor 可调");
  });
});

describe("metaprog action=resolve caller-guard", () => {
  test("非 supervisor caller 调 resolve → 拒绝", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: { action: "resolve", issueId: 1, decision: "merge" },
      }),
    );
    expect(typeof r).toBe("string");
    expect(r).toContain("resolve 仅 supervisor 可调");
  });
});
