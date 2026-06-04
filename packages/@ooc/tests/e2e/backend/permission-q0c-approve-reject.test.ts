/**
 * Q0c — permission HITL approve/reject 闭环 e2e (AgentOfExecutable + AgentOfVisible)。
 *
 * Design: docs/2026-05-25-permission-model-design.md §原则F + Q0c
 * Meta:   meta/object.doc.ts:executable.children.permission.patches.approve_reject_path
 *
 * 本测试覆盖完整 Ask → approve / reject → resume 闭环:
 *   A. approve 路径 — HITL 批准 → thinkloop 重放 tool call → dispatcher 真正执行
 *   B. reject 路径  — HITL 拒绝 → 写 permission_denied + 合成 function_call_output
 *   C. 错误路径    — HTTP 400/404 / thread 不存在 / 没有待审批 ask / eventId 拼错
 *   D. 渲染一致性  — pending / approved / rejected 三态 system message 区分
 *
 * 测试卫生 (engineering.harness.doc.ts:patches.test_session_hygiene):
 *  - mkdtempSync 独立 tmp baseDir, afterEach 清理 (rm -rf)
 *  - 不起 worker (跑 `service.decidePermission(...)` + 直调 `think()`), 进程零残留
 *  - session id 用 `_test_executable_<timestamp>` 前缀
 *  - 不污染 .ooc-world (走自己 tmp baseDir)
 */

import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spyOn } from "bun:test";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import * as toolsModule from "@ooc/core/executable/tools";
import * as observableModule from "@ooc/core/observable";
import {
  writeThread,
  readThread,
  type ThreadPersistenceRef,
} from "@ooc/core/persistable";
import * as contextModule from "@ooc/core/thinkable/context";
import type {
  LlmClient,
  LlmGenerateResult,
  LlmToolCall,
} from "@ooc/core/thinkable/llm/types";
import { think } from "@ooc/core/thinkable/thinkloop";

import { createRuntimeService } from "@ooc/core/app/server/modules/runtime/service";
import { createJobManager } from "@ooc/core/app/server/runtime/job-manager";
import { createPauseStore } from "@ooc/core/app/server/runtime/pause-store";
import { AppServerError } from "@ooc/core/app/server/bootstrap/errors";

// 触发 windows 各 type 副作用注册
import "@ooc/core/executable/windows";
import { builtinRegistry } from "@ooc/core/executable/windows/_shared/registry";

// ─────────────────────────── helpers ──────────────────────────────────────────

function makeGenerateResult(text: string, toolCalls: LlmToolCall[]): LlmGenerateResult {
  return {
    provider: "openai",
    model: "gpt-test",
    outputItems: [
      ...(text ? [{ type: "message" as const, role: "assistant" as const, content: text }] : []),
      ...toolCalls.map((tc) => ({
        type: "function_call" as const,
        call_id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
    ],
    text,
    toolCalls,
  };
}

function makeLlmClient(result: LlmGenerateResult): LlmClient {
  return {
    async generate() {
      return result;
    },
    async *stream() {
      yield { type: "start", provider: result.provider, model: result.model };
      yield { type: "done", text: result.text, toolCalls: result.toolCalls };
    },
  };
}

function setupPersistence(tmpRoot: string, sessionId: string, objectId: string, threadId: string): ThreadPersistenceRef {
  const stoneConfigDir = join(tmpRoot, "stones", "main", "objects", objectId, "config");
  mkdirSync(stoneConfigDir, { recursive: true });
  const threadDir = join(
    tmpRoot,
    "flows",
    sessionId,
    "objects",
    objectId,
    "threads",
    threadId,
  );
  mkdirSync(threadDir, { recursive: true });
  return { baseDir: tmpRoot, sessionId, objectId, threadId };
}

function writePoliciesJson(ref: ThreadPersistenceRef, raw: string): void {
  const path = join(
    ref.baseDir,
    "stones",
    "main",
    "objects",
    ref.objectId,
    "config",
    "policies.json",
  );
  writeFileSync(path, raw, "utf8");
}

function makeRuntimeService() {
  return createRuntimeService({
    pauseStore: createPauseStore(),
    jobManager: createJobManager(),
  });
}

/** 提取 q0c 测试用 sessionId 前缀, 同一时间戳避免冲突。 */
function ts(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────── fixture: fake commands ───────────────────────────

beforeAll(() => {
  builtinRegistry.registerObjectType("root", {
    methods: {
      _test_q0c_safe: {
        paths: ["_test_q0c_safe"],
        intent: () => [],
        exec: () => ({ ok: true, result: "executed-q0c-safe" }),
      },
    },
  });
});

afterEach(() => {
  mock.restore();
  observableModule.clearObservableDebugState();
  observableModule.setPermissionDecider(null);
});

// ─────────────────────────── A. approve 路径 ──────────────────────────────────

describe("[q0c] permission HITL — A. approve 闭环", () => {
  it("policies ask → paused → service.decidePermission(approve) → think() 重放 → dispatcher 被调", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-approve-"));
    try {
      const ref = setupPersistence(tmpRoot, sessionId, "obj_q0c_a", "t_q0c_a");
      writePoliciesJson(
        ref,
        JSON.stringify({ commands: { _test_q0c_safe: "ask" } }),
      );

      // 1) 构造 paused thread (跑一次 think 让它进入 ask + paused 状态)
      const thread = makeThread({
        persistence: ref,
        id: ref.threadId,
      });
      const toolCall: LlmToolCall = {
        id: "call_q0c_a",
        name: "exec",
        arguments: {
          title: "ask-then-approve",
          command: "_test_q0c_safe",
          args: { foo: "bar" },
        },
      };

      // 模拟 buildInputItems 不走真 stone (我们只在乎 dispatch / events)
      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec", result: "approved-dispatched" }),
      );

      const llmAsk = makeLlmClient(makeGenerateResult("about to call safe", [toolCall]));
      await think(thread, llmAsk);

      // 入 paused, 有 ask event 含 pendingCall
      expect(thread.status).toBe("paused");
      const askEvents = thread.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_ask",
      );
      expect(askEvents.length).toBe(1);
      const askEvent = askEvents[0];
      if (askEvent.category === "permission" && askEvent.kind === "permission_ask") {
        expect(askEvent.decided).toBeUndefined();
        expect(askEvent.pendingCall).toBeDefined();
        expect(askEvent.pendingCall?.toolCallId).toBe("call_q0c_a");
      }
      // dispatch 还没被调
      expect(dispatchSpy).not.toHaveBeenCalled();

      // 把 paused thread 写盘 (service.decidePermission 走 readThread / writeThread 路径)
      await writeThread(thread);
      const persisted = await readThread(ref, ref.threadId);
      expect(persisted?.status).toBe("paused");

      // 2) 调 service.decidePermission(approve)
      const service = makeRuntimeService();
      const resp = await service.decidePermission({
        ref,
        action: "approve",
      });
      expect(resp.ok).toBe(true);
      expect(resp.threadId).toBe(ref.threadId);
      expect(resp.newStatus).toBe("running");

      // 3) 重新 readThread 检查 decided 字段 + status
      const afterDecide = await readThread(ref, ref.threadId);
      expect(afterDecide).toBeDefined();
      expect(afterDecide!.status).toBe("running");
      const askEv2 = afterDecide!.events.find(
        (e) => e.category === "permission" && e.kind === "permission_ask",
      );
      if (askEv2 && askEv2.category === "permission" && askEv2.kind === "permission_ask") {
        expect(askEv2.decided?.action).toBe("approve");
        expect(typeof askEv2.decided?.at).toBe("number");
      } else {
        throw new Error("approved ask event not found");
      }

      // 4) 跑一次 think — processDecidedPermissionAsks 应重放 tool call
      // (mock 新一次 LLM 结果, 没有新 tool call; 重放发生在 think 入口处)
      const llmIdle = makeLlmClient(makeGenerateResult("ok approved", []));
      await think(afterDecide!, llmIdle);

      // dispatcher 被调一次
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      // 没有重复 ask event 写入
      const askEventsAfter = afterDecide!.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_ask",
      );
      expect(askEventsAfter.length).toBe(1);
      // 有 function_call_output (来自重放)
      const outputs = afterDecide!.events.filter(
        (e) =>
          e.category === "tool_runtime" &&
          e.kind === "function_call_output" &&
          e.callId === "call_q0c_a",
      );
      expect(outputs.length).toBe(1);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────── B. reject 路径 ──────────────────────────────────

describe("[q0c] permission HITL — B. reject 闭环", () => {
  it("paused → service.decidePermission(reject) → think() 写 denied + function_call_output", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-reject-"));
    try {
      const ref = setupPersistence(tmpRoot, sessionId, "obj_q0c_b", "t_q0c_b");
      writePoliciesJson(
        ref,
        JSON.stringify({ commands: { _test_q0c_safe: "ask" } }),
      );

      const thread = makeThread({
        persistence: ref,
        id: ref.threadId,
      });
      const toolCall: LlmToolCall = {
        id: "call_q0c_b",
        name: "exec",
        arguments: {
          title: "ask-then-reject",
          command: "_test_q0c_safe",
          args: { dangerous: true },
        },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llmAsk = makeLlmClient(makeGenerateResult("about to call", [toolCall]));
      await think(thread, llmAsk);
      expect(thread.status).toBe("paused");
      await writeThread(thread);

      const service = makeRuntimeService();
      const resp = await service.decidePermission({
        ref,
        action: "reject",
        reason: "user not sure",
      });
      expect(resp.newStatus).toBe("running");

      const afterDecide = await readThread(ref, ref.threadId);
      expect(afterDecide!.status).toBe("running");
      const askEv = afterDecide!.events.find(
        (e) => e.category === "permission" && e.kind === "permission_ask",
      );
      if (askEv && askEv.category === "permission" && askEv.kind === "permission_ask") {
        expect(askEv.decided?.action).toBe("reject");
        expect(askEv.decided?.reason).toBe("user not sure");
      } else {
        throw new Error("rejected ask event not found");
      }

      // 跑 think — 应写 permission_denied + function_call_output, 不调 dispatcher
      const llmIdle = makeLlmClient(makeGenerateResult("noted", []));
      await think(afterDecide!, llmIdle);

      expect(dispatchSpy).not.toHaveBeenCalled();

      const deniedEvents = afterDecide!.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_denied",
      );
      expect(deniedEvents.length).toBe(1);
      const denied = deniedEvents[0];
      if (denied.category === "permission" && denied.kind === "permission_denied") {
        expect(denied.reason).toContain("user-rejected");
        expect(denied.reason).toContain("user not sure");
      }

      const outputs = afterDecide!.events.filter(
        (e) =>
          e.category === "tool_runtime" &&
          e.kind === "function_call_output" &&
          e.callId === "call_q0c_b",
      );
      expect(outputs.length).toBe(1);
      const out = outputs[0];
      if (out.category === "tool_runtime" && out.kind === "function_call_output") {
        expect(out.ok).toBe(false);
        expect(out.output).toContain("denied");
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────── C. 错误路径 ─────────────────────────────────────

describe("[q0c] permission HITL — C. 错误路径", () => {
  it("thread 不存在 → NOT_FOUND", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-err1-"));
    try {
      const ref: ThreadPersistenceRef = {
        baseDir: tmpRoot,
        sessionId,
        objectId: "nope",
        threadId: "nope",
      };
      const service = makeRuntimeService();
      let threw: AppServerError | undefined;
      try {
        await service.decidePermission({ ref, action: "approve" });
      } catch (e) {
        threw = e as AppServerError;
      }
      expect(threw).toBeInstanceOf(AppServerError);
      expect(threw!.code).toBe("NOT_FOUND");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("thread 不在 paused 状态 → THREAD_NOT_PAUSED", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-err2-"));
    try {
      const ref = setupPersistence(tmpRoot, sessionId, "obj_q0c_c2", "t_c2");
      const thread = makeThread({
        persistence: ref,
        id: ref.threadId,
        status: "running",
      });
      await writeThread(thread);

      const service = makeRuntimeService();
      let threw: AppServerError | undefined;
      try {
        await service.decidePermission({ ref, action: "approve" });
      } catch (e) {
        threw = e as AppServerError;
      }
      expect(threw).toBeInstanceOf(AppServerError);
      expect(threw!.code).toBe("THREAD_NOT_PAUSED");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("没有待审批 permission_ask → INVALID_INPUT", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-err3-"));
    try {
      const ref = setupPersistence(tmpRoot, sessionId, "obj_q0c_c3", "t_c3");
      // paused 但 events 里没有 ask
      const thread = makeThread({
        persistence: ref,
        id: ref.threadId,
        status: "paused",
      });
      await writeThread(thread);

      const service = makeRuntimeService();
      let threw: AppServerError | undefined;
      try {
        await service.decidePermission({ ref, action: "approve" });
      } catch (e) {
        threw = e as AppServerError;
      }
      expect(threw).toBeInstanceOf(AppServerError);
      expect(threw!.code).toBe("INVALID_INPUT");
      expect(threw!.message).toContain("no pending");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("eventId 不存在 → NOT_FOUND", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-err4-"));
    try {
      const ref = setupPersistence(tmpRoot, sessionId, "obj_q0c_c4", "t_c4");
      const thread = makeThread({
        persistence: ref,
        id: ref.threadId,
        status: "paused",
        events: [
          {
            category: "permission",
            kind: "permission_ask",
            toolCallId: "tc_x",
            command: "_test_q0c_safe",
            id: "ask_real",
          },
        ],
      });
      await writeThread(thread);

      const service = makeRuntimeService();
      let threw: AppServerError | undefined;
      try {
        await service.decidePermission({ ref, action: "approve", eventId: "nope_id" });
      } catch (e) {
        threw = e as AppServerError;
      }
      expect(threw).toBeInstanceOf(AppServerError);
      expect(threw!.code).toBe("NOT_FOUND");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("eventId 对应的 event 已 decided → CONFLICT", async () => {
    const sessionId = `_test_executable_${ts()}`;
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0c-err5-"));
    try {
      const ref = setupPersistence(tmpRoot, sessionId, "obj_q0c_c5", "t_c5");
      const thread = makeThread({
        persistence: ref,
        id: ref.threadId,
        status: "paused",
        events: [
          {
            category: "permission",
            kind: "permission_ask",
            toolCallId: "tc_y",
            command: "_test_q0c_safe",
            id: "already_decided",
            decided: { action: "approve", at: 1, reason: "" },
          },
        ],
      });
      await writeThread(thread);

      const service = makeRuntimeService();
      let threw: AppServerError | undefined;
      try {
        await service.decidePermission({ ref, action: "reject", eventId: "already_decided" });
      } catch (e) {
        threw = e as AppServerError;
      }
      expect(threw).toBeInstanceOf(AppServerError);
      expect(threw!.code).toBe("CONFLICT");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────── D. 渲染一致性 ─────────────────────────────────

describe("[q0c] permission HITL — D. 渲染区分 pending / approved / rejected", () => {
  it("processEventToItems 渲染三态 system message", async () => {
    const thread = makeThread({
      events: [
        // pending
        {
          category: "permission",
          kind: "permission_ask",
          toolCallId: "tc_pending",
          command: "cmd_a",
          id: "ev_pending",
        },
        // approved
        {
          category: "permission",
          kind: "permission_ask",
          toolCallId: "tc_appr",
          command: "cmd_b",
          id: "ev_appr",
          decided: { action: "approve", at: 12345 },
        },
        // rejected
        {
          category: "permission",
          kind: "permission_ask",
          toolCallId: "tc_rej",
          command: "cmd_c",
          id: "ev_rej",
          decided: { action: "reject", at: 67890, reason: "no thanks" },
        },
      ],
    });

    // 用 contextModule.buildInputItems 跑渲染 (skipCreatorWindow path 不走 stone)
    // 这里不走 mock — 测试 contextModule 自身的 processEventToItems 输出
    const { input } = await contextModule.buildInputItems(thread);
    // 找 system messages
    const sysMsgs = input
      .filter((it) => it.type === "message" && it.role === "system")
      .map((it) => (it as Extract<typeof it, { type: "message" }>).content);

    const pendingLine = sysMsgs.find((c) => c.includes("tc_pending"));
    expect(pendingLine).toBeDefined();
    expect(pendingLine!).toContain("awaiting human approval");

    const apprLine = sysMsgs.find((c) => c.includes("tc_appr"));
    expect(apprLine).toBeDefined();
    expect(apprLine!).toContain("approved at 12345");

    const rejLine = sysMsgs.find((c) => c.includes("tc_rej"));
    expect(rejLine).toBeDefined();
    expect(rejLine!).toContain("rejected at 67890");
    expect(rejLine!).toContain("no thanks");
  });
});

// 防漏: 卫生 sanity — 确认本测试没在 .ooc-world 留痕
afterEach(() => {
  // 简单 sanity: 不让 .ooc-world/flows/_test_executable_* 累积
  const dir = ".ooc-world/flows";
  if (existsSync(dir)) {
    // 不强制清; 只保证我们的测试没用 .ooc-world (都走 mkdtempSync)
    // — 这里只是占位提示
  }
});
