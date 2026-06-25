/**
 * PR auto-deliver smoke test —— 验证 deliverPrToReviewers 把 pr window 挂进 reviewer thread。
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@ooc/core/runtime/object-register.builtins";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { deliverPrToReviewers } from "@ooc/core/persistable/pr-deliver";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types";

const SID = "pr-deliver-test";
let baseDir: string;

describe("pr-deliver", () => {
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ooc-pr-test-"));
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
    releaseSessionRegistry(SID);
  });

  it("delivers pr window to reviewer's active threads", async () => {
    const reg = getSessionRegistry(SID);
    // create a reviewer thread (calleeObjectId = "reviewer1")
    const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
    const thread = (await ctor.exec(
      { sessionId: SID, worldDir: baseDir, dir: "", args: { calleeObjectId: "reviewer1" } },
      { calleeObjectId: "reviewer1", message: "review me" },
    )) as ThreadContext;
    reg.setObject({ id: thread.id, class: "_builtin/agent/thread", data: thread });

    const result = await deliverPrToReviewers({
      baseDir,
      prId: "fix-bug-x",
      branch: "feat/fix-bug-x",
      intent: "Fix bug X",
      diff: "diff --git a/file b/file\n+new line",
      reviewers: [{ sessionId: SID, objectId: "reviewer1" }],
    });

    expect(result.delivered.length).toBe(1);
    expect(result.delivered[0]!.reviewer).toBe("reviewer1");
    expect(result.delivered[0]!.threadId).toBe(thread.id);

    // thread.contextWindows should now include a pr window
    const prWin = thread.contextWindows.find((w) => w.class === "_builtin/agent/pr");
    expect(prWin).toBeDefined();
    expect(prWin?.title).toBe("PR fix-bug-x");

    // the pr object should be in session table
    const prInst = reg.getObject(prWin!.id);
    expect(prInst?.class).toBe("_builtin/agent/pr");
    expect((prInst?.data as { branch: string }).branch).toBe("feat/fix-bug-x");
  });
});
