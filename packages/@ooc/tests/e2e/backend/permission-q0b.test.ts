/**
 * Q0b — permission 模型最小闭环 e2e (AgentOfExecutable + AgentOfObservable)。
 *
 * 本轮验证 Allow + Deny 两条路径完整, Ask 路径仅落 paused 占位
 * (approve/reject API 是 Q0c 的活)。
 *
 * 不走真 LLM: 直接调 think() 并 mock LlmClient 模拟 LLM 行为, 完整覆盖:
 *   A. Allow 默认 — command 未声明 permission → dispatchToolCall 正常触发
 *   B. Deny via ObjectMethod — registerExecutable 注册 permission="deny" 的 fake command
 *   C. Deny via policies.json — stones/<branch>/objects/<id>/config/policies.json
 *   D. PermissionDecider 注入 — setPermissionDecider 覆盖前两者
 *   E. Ask 占位 — policies.json "ask" → permission_ask event + thread.status="paused"
 *   F. 配置容错 — 空字符串 / 非法 JSON / 字段拼错 → fallback 不抛错
 *
 * 测试自身的 session 卫生:
 * - mkdtempSync 申请独立 tmp 目录, 测试结束 rm 自己
 * - 不启动 long-running 进程 (think() 是单轮纯函数)
 * - setPermissionDecider(null) 在 afterEach 清理
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import * as toolsModule from "@ooc/core/executable/tools";
import * as observableModule from "@ooc/core/observable";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";
import { deriveStoneFromThread, stoneDir } from "@ooc/core/persistable/common";
import * as contextModule from "@ooc/builtins/agent/thread/thinkable/context/index";
import type {
  LlmClient,
  LlmGenerateResult,
  LlmToolCall,
} from "@ooc/core/thinkable/llm/types";
import { think } from "@ooc/core/thinkable/thinkloop";
import { spyOn } from "bun:test";

// 触发 windows/ 各 type 的 side-effect 注册 (root commands 等)
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import type { ObjectMethod } from "@ooc/core/executable/contract.js";

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
  };
}

/**
 * 创建一份独立的 stone-style 持久化引用 (tmpRoot/stones/main/objects/<oid>/config/...)。
 * 测试用 — 不实际跑 worker, 只用来让 loadPoliciesJson 能找到 config 文件。
 */
/**
 * policies.json 的物理落点必须与 loadPoliciesJson 一致——后者走
 * `stoneDir(deriveStoneFromThread(persistence))`。canonical 布局后该路径
 * 是 flat `stones/<objectId>/config/policies.json`（非旧 `stones/main/objects/<id>/`），
 * 故直接用 stoneDir 推算，避免再次硬编码旧布局漂移。
 */
function policiesConfigDir(ref: ThreadPersistenceRef): string {
  return join(stoneDir(deriveStoneFromThread(ref)), "config");
}

function setupPersistence(tmpRoot: string, objectId: string): ThreadPersistenceRef {
  const baseDir = tmpRoot;
  const ref: ThreadPersistenceRef = {
    baseDir,
    sessionId: "test-session",
    objectId,
    threadId: "t_q0b",
  };
  // stones 目录结构 (loadPoliciesJson 走 deriveStoneFromThread + stoneDir → flat 布局)
  mkdirSync(policiesConfigDir(ref), { recursive: true });
  // flow 目录(thread.persistence 自身需要的形态; 不实际写文件)
  const threadDir = join(
    baseDir,
    "flows",
    "test-session",
    "objects",
    objectId,
    "threads",
    "t_q0b",
  );
  mkdirSync(threadDir, { recursive: true });
  return ref;
}

function writePoliciesJson(ref: ThreadPersistenceRef, raw: string): void {
  const path = join(policiesConfigDir(ref), "policies.json");
  writeFileSync(path, raw, "utf8");
}

// ─────────────────────────── fixture: fake commands ───────────────────────────

// 注册仅供测试用的 root-fallback object method: "_test_q0b_danger" (deny), "_test_q0b_safe" (无声明)。
// Wave 4：permission 经 lookupDeclaredPermission 的 `tryWindow("root")` 兜底解析 method 的
// ObjectMethod.permission（call 无 windowId 时走 root class）。root 锚点本身无 executable
// methods（仅 readable），故在此把 fake method 注册到 root.executable 上；register 会**合并**
// 模块字段、保留 root 的 readable。afterAll 用空 methods 数组还原，清掉测试方法保证隔离。
const dangerMethod: ObjectMethod = {
  name: "_test_q0b_danger",
  description: "test deny method",
  permission: () => "deny",
  exec: () => ({ message: "should-never-execute" }),
};
const safeMethod: ObjectMethod = {
  name: "_test_q0b_safe",
  description: "test allow method",
  // 缺省 permission → 默认 allow
  exec: () => ({ message: "executed-safe" }),
};
beforeAll(() => {
  builtinRegistry.register("root", { executable: { methods: [dangerMethod, safeMethod] } });
});

afterAll(() => {
  builtinRegistry.register("root", { executable: { methods: [] } });
});

// ─────────────────────────── housekeeping ─────────────────────────────────────

afterEach(() => {
  mock.restore();
  observableModule.clearObservableDebugState();
  observableModule.setPermissionDecider(null);
});

// ─────────────────────────── A. Allow 默认 ────────────────────────────────────

describe("[q0b] permission — A. Allow 默认", () => {
  it("command 未声明 permission → dispatchToolCall 被调用", async () => {
    const thread = makeThread();
    const toolCall: LlmToolCall = {
      id: "call_allow_1",
      name: "exec",
      arguments: {
        title: "safe call",
        method: "_test_q0b_safe",
        args: {},
      },
    };

    spyOn(contextModule, "buildInputItems").mockResolvedValue({
      input: [{ type: "message", role: "system", content: "ctx" }],
    });
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
      JSON.stringify({ ok: true, tool: "exec" }),
    );

    const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
    await think(thread, llm);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    // 没有 permission event
    const permissionEvents = thread.events.filter((e) => e.category === "permission");
    expect(permissionEvents.length).toBe(0);
    // 有 function_call_output
    const outputs = thread.events.filter(
      (e) => e.category === "tool_runtime" && e.kind === "function_call_output",
    );
    expect(outputs.length).toBe(1);
  });
});

// ─────────────────────────── B. Deny via ObjectMethod ────────────────────

describe("[q0b] permission — B. Deny via ObjectMethod", () => {
  it("permission='deny' 的 fake command → 写 permission_denied + 合成 function_call_output + 不分派", async () => {
    const thread = makeThread();
    const toolCall: LlmToolCall = {
      id: "call_deny_1",
      name: "exec",
      arguments: {
        title: "danger call",
        method: "_test_q0b_danger",
        args: { payload: "rm -rf /" },
      },
    };

    spyOn(contextModule, "buildInputItems").mockResolvedValue({
      input: [{ type: "message", role: "system", content: "ctx" }],
    });
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
    const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
      JSON.stringify({ ok: true, tool: "exec" }),
    );

    const llm = makeLlmClient(makeGenerateResult("about to call danger", [toolCall]));
    await think(thread, llm);

    // dispatch 没有被调用
    expect(dispatchSpy).not.toHaveBeenCalled();

    // 有 permission_denied event
    const denyEvents = thread.events.filter(
      (e) => e.category === "permission" && e.kind === "permission_denied",
    );
    expect(denyEvents.length).toBe(1);
    const denyEvent = denyEvents[0];
    if (denyEvent.category === "permission" && denyEvent.kind === "permission_denied") {
      expect(denyEvent.toolCallId).toBe("call_deny_1");
      expect(denyEvent.method).toBe("_test_q0b_danger");
      expect(denyEvent.reason).toContain("ObjectMethod");
      expect(denyEvent.argsSummary).toContain("rm -rf");
    }

    // 有合成的 function_call_output (toolCallId 对应; output 含 "denied")
    const outputs = thread.events.filter(
      (e) =>
        e.category === "tool_runtime" &&
        e.kind === "function_call_output" &&
        e.callId === "call_deny_1",
    );
    expect(outputs.length).toBe(1);
    const out = outputs[0];
    if (out.category === "tool_runtime" && out.kind === "function_call_output") {
      expect(out.ok).toBe(false);
      expect(out.output).toContain("denied");
    }
  });
});

// ─────────────────────────── C. Deny via policies.json ────────────────────────

describe("[q0b] permission — C. Deny via policies.json", () => {
  it("policies.json 设 deny → 即使 ObjectMethod 是 allow 也被拒", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0b-policies-deny-"));
    try {
      const ref = setupPersistence(tmpRoot, "obj_q0b_c");
      // _test_q0b_safe 是 allow 但 policies.json 覆盖为 deny
      writePoliciesJson(
        ref,
        JSON.stringify({ methods: { _test_q0b_safe: "deny" } }),
      );

      const thread = makeThread({ persistence: ref });
      const toolCall: LlmToolCall = {
        id: "call_deny_2",
        name: "exec",
        arguments: { title: "safe but denied", method: "_test_q0b_safe", args: {} },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
      await think(thread, llm);

      expect(dispatchSpy).not.toHaveBeenCalled();
      const denyEvents = thread.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_denied",
      );
      expect(denyEvents.length).toBe(1);
      const d = denyEvents[0];
      if (d.category === "permission" && d.kind === "permission_denied") {
        expect(d.reason).toContain("policies.json");
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────── D. PermissionDecider 注入 ────────────────────────

describe("[q0b] permission — D. PermissionDecider 注入 (escape hatch)", () => {
  it("setPermissionDecider 返回 deny → 覆盖 ObjectMethod 与 policies.json", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0b-decider-"));
    try {
      const ref = setupPersistence(tmpRoot, "obj_q0b_d");
      // policies 明确 allow, ObjectMethod 也是 allow (safe), 但 decider 强制 deny
      writePoliciesJson(
        ref,
        JSON.stringify({ methods: { _test_q0b_safe: "allow" } }),
      );

      observableModule.setPermissionDecider(() => ({
        decision: "deny",
        reason: "decider-override",
      }));

      const thread = makeThread({ persistence: ref });
      const toolCall: LlmToolCall = {
        id: "call_decider_1",
        name: "exec",
        arguments: { title: "decider blocks", method: "_test_q0b_safe", args: {} },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
      await think(thread, llm);

      expect(dispatchSpy).not.toHaveBeenCalled();
      const denyEvents = thread.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_denied",
      );
      expect(denyEvents.length).toBe(1);
      const d = denyEvents[0];
      if (d.category === "permission" && d.kind === "permission_denied") {
        expect(d.reason).toBe("decider-override");
      }
    } finally {
      // afterEach 会 setPermissionDecider(null), 但测试结束前也手动清一遍
      observableModule.setPermissionDecider(null);
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────── E. Ask 路径占位 ─────────────────────────────────

describe("[q0b] permission — E. Ask 路径占位", () => {
  it("policies.json 设 'ask' → 写 permission_ask + thread.status=paused + 不分派 (Q0b 占位)", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0b-ask-"));
    try {
      const ref = setupPersistence(tmpRoot, "obj_q0b_e");
      writePoliciesJson(
        ref,
        JSON.stringify({ methods: { _test_q0b_safe: "ask" } }),
      );

      const thread = makeThread({ persistence: ref });
      const toolCall: LlmToolCall = {
        id: "call_ask_1",
        name: "exec",
        arguments: { title: "ask first", method: "_test_q0b_safe", args: { foo: 1 } },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
      await think(thread, llm);

      // 1. 有 permission_ask event
      const askEvents = thread.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_ask",
      );
      expect(askEvents.length).toBe(1);
      const a = askEvents[0];
      if (a.category === "permission" && a.kind === "permission_ask") {
        expect(a.toolCallId).toBe("call_ask_1");
        expect(a.method).toBe("_test_q0b_safe");
        expect(a.argsSummary).toContain("foo");
      }

      // 2. thread.status === "paused"
      expect(thread.status).toBe("paused");

      // 3. dispatch 未被调用
      expect(dispatchSpy).not.toHaveBeenCalled();

      // 4. 没有 function_call_output (ask 是占位, 不合成 output)
      const outputs = thread.events.filter(
        (e) => e.category === "tool_runtime" && e.kind === "function_call_output",
      );
      expect(outputs.length).toBe(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────── F. 配置容错 ──────────────────────────────────────

describe("[q0b] permission — F. 配置容错", () => {
  it("空字符串 policies.json → fallback 到 ObjectMethod, 不抛错", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0b-empty-"));
    try {
      const ref = setupPersistence(tmpRoot, "obj_q0b_f1");
      writePoliciesJson(ref, "");

      const thread = makeThread({ persistence: ref });
      const toolCall: LlmToolCall = {
        id: "call_f1",
        name: "exec",
        arguments: { title: "x", method: "_test_q0b_safe", args: {} },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
      await think(thread, llm); // 不应抛错

      // safe command 没有 permission 声明 → allow → dispatch 被调
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const permEvents = thread.events.filter((e) => e.category === "permission");
      expect(permEvents.length).toBe(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("非法 JSON → fallback, 不抛错", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0b-badjson-"));
    try {
      const ref = setupPersistence(tmpRoot, "obj_q0b_f2");
      writePoliciesJson(ref, "{ this is not json");

      const thread = makeThread({ persistence: ref });
      const toolCall: LlmToolCall = {
        id: "call_f2",
        name: "exec",
        arguments: { title: "x", method: "_test_q0b_safe", args: {} },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
      await think(thread, llm);

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("字段拼错 (comamnds) → fallback 到 ObjectMethod, 不抛错", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-q0b-typo-"));
    try {
      const ref = setupPersistence(tmpRoot, "obj_q0b_f3");
      // 故意拼错 "commands" → "comamnds"; loadPoliciesJson 应返回 {}
      // 然后 _test_q0b_danger (ObjectMethod.permission="deny") 应仍生效
      writePoliciesJson(
        ref,
        JSON.stringify({ comamnds: { _test_q0b_danger: "allow" } }),
      );

      const thread = makeThread({ persistence: ref });
      const toolCall: LlmToolCall = {
        id: "call_f3",
        name: "exec",
        arguments: { title: "x", method: "_test_q0b_danger", args: {} },
      };

      spyOn(contextModule, "buildInputItems").mockResolvedValue({
        input: [{ type: "message", role: "system", content: "ctx" }],
      });
      spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
      const dispatchSpy = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue(
        JSON.stringify({ ok: true, tool: "exec" }),
      );

      const llm = makeLlmClient(makeGenerateResult("", [toolCall]));
      await think(thread, llm);

      // 字段拼错 → fallback → ObjectMethod.permission="deny" 生效
      expect(dispatchSpy).not.toHaveBeenCalled();
      const denyEvents = thread.events.filter(
        (e) => e.category === "permission" && e.kind === "permission_denied",
      );
      expect(denyEvents.length).toBe(1);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
