/**
 * command.metaprog caller-guard + error-token 单测
 *
 * 不跑真 git；只校验 metaprog command 层的 caller-permission 校验与新的
 * `[metaprog:create_object:<CODE>]` 错误 token 形态。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureStoneRepo, __resetSerialQueueForTests } from "@ooc/core/persistable";
import { executeMetaprog } from "@ooc/builtins/root/executable/command.metaprog";
import type { MethodExecutionContext } from "@ooc/core/extendable/_shared/command-types";
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

describe("metaprog action=create_object caller-guard", () => {
  test("非 supervisor caller 调 create_object → FORBIDDEN token", async () => {
    const baseDir = await newWorld(["agent_of_x", "supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "agent_of_x",
        args: {
          action: "create_object",
          objectId: "hacker",
          selfMd: "# hacker\n",
          readableMd: "# hacker\n",
        },
      }),
    );
    expect(typeof r).toBe("string");
    expect(r).toContain("[metaprog:create_object:FORBIDDEN]");
    expect(r).toContain("agent_of_x");
  });

  test("supervisor caller + 缺 objectId → INVALID_INPUT token", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "supervisor",
        args: { action: "create_object", selfMd: "x", readableMd: "y" },
      }),
    );
    expect(r).toContain("[metaprog:create_object:INVALID_INPUT]");
  });

  test("supervisor caller + 空 selfMd → INVALID_INPUT token", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "supervisor",
        args: { action: "create_object", objectId: "weather", selfMd: "  ", readableMd: "x" },
      }),
    );
    expect(r).toContain("[metaprog:create_object:INVALID_INPUT]");
  });

  test("supervisor caller + knowledge 不是 string map → INVALID_INPUT token", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "supervisor",
        args: {
          action: "create_object",
          objectId: "weather",
          selfMd: "x",
          readableMd: "y",
          knowledge: { "usage.md": 42 },
        },
      }),
    );
    expect(r).toContain("[metaprog:create_object:INVALID_INPUT]");
  });

  test("supervisor caller + objectId=supervisor → INVALID_INPUT（bootstrap path only）", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "supervisor",
        args: { action: "create_object", objectId: "supervisor", selfMd: "x", readableMd: "y" },
      }),
    );
    expect(r).toContain("[metaprog:create_object:INVALID_INPUT]");
  });

  test("supervisor caller + 全部参数合法 → 成功（commit 落 main）", async () => {
    const baseDir = await newWorld(["supervisor"]);
    const r = await executeMetaprog(
      makeCtx({
        baseDir,
        callerId: "supervisor",
        args: {
          action: "create_object",
          objectId: "weather",
          selfMd: "# weather\n",
          readmeMd: "# weather\n",
          knowledge: { "usage.md": "Pass {city}.\n" },
          intent: "feat: introduce weather",
        },
      }),
    );
    const parsed = JSON.parse(r as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.objectId).toBe("weather");
    expect(typeof parsed.commitSha).toBe("string");
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
