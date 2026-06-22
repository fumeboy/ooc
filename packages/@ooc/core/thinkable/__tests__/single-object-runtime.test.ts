import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
// 注册 builtin 窗类型（_builtin/agent + agent/plan…）—— scheduler 经 runtime.instantiate
// 造 plan 子对象、createFlowObject 解析 class 都需要它们在 registry 里。
import "@ooc/core/runtime/register-builtins.js";
import { createFlowObject } from "../../persistable";
import {
  llmInputFile,
  llmOutputFile,
  loopMetaFile,
} from "../../observable/debug-file";
import { readThread, threadFile } from "@ooc/builtins/agent/thread/persistable/thread-json";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import type { LlmClient, LlmGenerateResult, LlmToolCall } from "../llm/types";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import {
  getSessionObjectTable,
  materializeWindow,
} from "@ooc/core/runtime/session-object-table.js";
import { runScheduler } from "../scheduler";
import { clearObservableDebugState, disableDebug, enableDebug } from "../../observable";

function makeResult(text: string, toolCalls: LlmToolCall[] = []): LlmGenerateResult {
  return {
    provider: "openai",
    model: "test",
    outputItems: [
      ...(text ? [{ type: "message", role: "assistant", content: text } as const] : []),
      ...toolCalls.map((toolCall) => ({
        type: "function_call" as const,
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments
      }))
    ],
    text,
    toolCalls
  };
}

describe("single object runtime", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  test("runs thinkable, executable, observable, and persistable in one object", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-single-object-"));
    const flowRef = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "assistant"
    });
    const root: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      // agency 方法（plan/...）已从 root 迁到 `_builtin/agent` 类；exec 须经 agent 面窗调用。
      contextWindows: [],
      persistence: { ...flowRef, threadId: "root" }
    };
    // 窗=ref + object 入 session 对象表，materializeWindow 一处搞定。
    root.contextWindows = [
      materializeWindow(root, {
        id: "agent",
        class: "_builtin/agent",
        data: {},
        parentWindowId: "root",
        title: "agent",
        status: "open",
        createdAt: Date.now(),
        win: { transient: true, isMemberWindow: true },
      }),
    ];

    let callCount = 0;
    const llmClient: LlmClient = {
      async generate() {
        callCount += 1;
        if (callCount === 1) {
          // args 给齐 plan 时 open 立即提交 form；下一轮无需再 submit
          return makeResult("I will set the plan in one shot.", [
            {
              id: "tc1",
              name: "exec",
              arguments: {
                title: "open plan",
                window_id: "agent",
                method: "plan",
                description: "制定本对象执行计划",
                args: { plan: "完成单 object 最小闭环" }
              }
            }
          ]);
        }

        return makeResult("All done.", []);
      },
    };

    clearObservableDebugState();
    enableDebug();
    await runScheduler(root, llmClient, { maxTicks: 2 });
    disableDebug();

    const ref = root.persistence!;
    const input = JSON.parse(await readFile(llmInputFile(ref), "utf8"));
    const output = JSON.parse(await readFile(llmOutputFile(ref), "utf8"));
    const loopMeta = JSON.parse(await readFile(loopMetaFile(ref, 2), "utf8"));
    const savedThread = JSON.parse(await readFile(threadFile(ref), "utf8"));

    expect(input.threadId).toBe("root");
    // round 1 时 open 立即提交 form 执行 plan；round 2 没有任何工具调用，所以 outputItems 只有 message
    expect(loopMeta.loopIndex).toBe(2);
    expect(loopMeta.status).toBe("ok");
    // plan 升格为 plan_window；旧 thread.plan 字段已废弃。Wave4：实例 inst.class = 注册 class id
    // `_builtin/agent/plan`（instantiate 写入），业务字段（description）落 inst.data。
    const rootPlanWindow = (root.contextWindows as ContextWindow[]).find(
      (w) => w.class === "_builtin/agent/plan",
    );
    expect(rootPlanWindow?.class).toBe("_builtin/agent/plan");
    expect(
      rootPlanWindow
        ? (objectDataOf(rootPlanWindow, getSessionObjectTable(root)) as { description?: string } | undefined)?.description
        : undefined,
    ).toBe("完成单 object 最小闭环");
    // 退役 thread.json.contextWindows：plan 是独立 flow object，落 thread-context.json 的
    // _ref，权威字段在 plan 的 data.json。reload 经 readThread（thread-context.json → data.json
    // hydrate）才能拿到完整 plan window —— 直接 parse thread.json 不再含 contextWindows。
    expect(savedThread.contextWindows).toBeUndefined();
    const reloaded = await readThread(ref, "root");
    const savedPlanWindow = (reloaded?.contextWindows ?? []).find(
      (w) => w.class === "_builtin/agent/plan",
    );
    expect(
      savedPlanWindow && reloaded
        ? (objectDataOf(savedPlanWindow, getSessionObjectTable(reloaded)) as { description?: string } | undefined)?.description
        : undefined,
    ).toBe("完成单 object 最小闭环");
    expect(
      savedThread.events.some(
        (event: { category: string; kind: string }) =>
          event.category === "llm_interaction" && event.kind === "function_call"
      )
    ).toBe(true);
    void output;
  });
});
