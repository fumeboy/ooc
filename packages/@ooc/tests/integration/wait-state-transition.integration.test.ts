import { afterEach, beforeEach, describe, expect, test } from "bun:test";
// side-effect：装载全部 builtin class 进 builtinRegistry，否则会话窗 class
// `_builtin/agent/thread` 解析不到（createFlowObject 报 unregistered class）。
import "@ooc/core/runtime/register-builtins.js";
import { runScheduler } from "@ooc/core/thinkable/scheduler";
import { createFlowObject } from "@ooc/core/persistable";
import {
  bootstrapInboxFromPrompt,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import {
  threadWindowIdOf,
  ROOT_WINDOW_ID,
} from "@ooc/core/_shared/types/context-window.js";
import { materializeWindow } from "@ooc/core/runtime/session-object-table.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import type { TalkData } from "@ooc/builtins/agent/thread/types.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";

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
    // wait-requires-dependency: wait 必须指定 on=<合法 IO 来源 window>。
    // 给 thread 挂一个 creator talk_window（模拟 callee thread）作为合法 on 目标，
    // 让 LLM 可以 wait(on=<该 talk>) 而不被 reject。
    const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    // Wave4 会话窗：stored class = THREAD_CLASS_ID，target 落 inst.data；creator 窗身份编码在
    // id（threadWindowIdOf）里——不再存 isCreatorWindow flag，wait 按 isSelfThreadWindow(id) 识别。
    const creatorTalkId = threadWindowIdOf("root");
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
      contextWindows: [],
      creatorObjectId: "user",
      creatorThreadId: "root",
      persistence: { ...flow, threadId: "root" },
    };
    // creator 会话窗 = ref + object（target 落 data）入 session 对象表（materializeWindow 一处搞定）。
    root.contextWindows = [
      materializeWindow(root, {
        id: creatorTalkId,
        class: THREAD_CLASS_ID,
        data: { target: "user" },
        parentWindowId: ROOT_WINDOW_ID,
        title: "creator",
        status: "open",
        createdAt: Date.now(),
      }),
    ];

    await runScheduler(root, llm(), { maxTicks: 5 });

    expect(root.status).toBe("waiting");
    expect(root.inboxSnapshotAtWait).toBeDefined();
    expect(root.waitingOn).toBe(creatorTalkId);
  }, 90_000);
});
