import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import { createFlowObject } from "../../src/persistable";
import {
  bootstrapInboxFromPrompt,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import {
  generateWindowId,
  ROOT_WINDOW_ID,
  type TalkWindow,
} from "../../src/executable/windows/types";
import type { ThreadContext } from "../../src/thinkable/context";

describe.skipIf(!hasLlmEnv)("integration: wait-state-transition", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent enters waiting state via wait tool with valid on target", async () => {
    // spec 2026-05-17 wait-requires-dependency: wait 必须指定 on=<合法 IO 来源 window>。
    // 给 thread 挂一个 creator talk_window（模拟 callee thread）作为合法 on 目标，
    // 让 LLM 可以 wait(on=<该 talk>) 而不被 reject。
    const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    const creatorTalkId = generateWindowId("talk");
    const creatorTalk: TalkWindow = {
      id: creatorTalkId,
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "creator",
      status: "open",
      createdAt: Date.now(),
      target: "user",
      conversationId: creatorTalkId,
      isCreatorWindow: true,
    };
    const { inbox, events } = bootstrapInboxFromPrompt(
      [
        `请直接调用 wait tool 等待 creator (creator talk_window id 为 "${creatorTalkId}")，`,
        `wait(on="${creatorTalkId}", reason="等待用户输入")。`,
        "不要做其它事，不要 open 任何 form，不要 end。",
      ].join("\n"),
    );
    const root: ThreadContext = {
      id: "root",
      status: "running",
      inbox,
      events,
      contextWindows: [creatorTalk],
      creatorObjectId: "user",
      creatorThreadId: "root",
      persistence: { ...flow, threadId: "root" },
    };

    await runScheduler(root, llm(), { maxTicks: 5 });

    expect(root.status).toBe("waiting");
    expect(root.inboxSnapshotAtWait).toBeDefined();
    expect(root.waitingOn).toBe(creatorTalkId);
  }, 90_000);
});
