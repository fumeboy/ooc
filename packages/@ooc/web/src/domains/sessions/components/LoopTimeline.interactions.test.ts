/**
 * LoopTimeline interactions tests — R0d.
 *
 * Web 工程未安装 React Testing Library / 无 DOM env, 因此沿用 R0c 风格:
 * 把交互意图收敛到可单测的纯函数 (planBadgeClickAction / buildDecideBody / executeDecide),
 * 用 fetcher mock 注入断言 HTTP 调用形态。
 *
 * 覆盖 (R0d 验收):
 *  1. badge 跳转: 非 permission_ask 的关键 event 单击 → planBadgeClickAction → "scroll"
 *  2. approve 流程: planBadgeClickAction(permission_ask, pending) → "open-permission";
 *                   executeDecide({action:"approve"}) → fetcher 收到 POST + 正确 body
 *  3. reject 流程: executeDecide({action:"reject", reason:"test reject"}) → body 含 reason
 *  5. 错误路径: fetcher 抛错 → executeDecide rethrow (silent-swallow ban)
 *  6. anchor id: loopEventAnchorId 在 event.id / toolCallId / fallback 三档优先级正确
 *
 * 不覆盖 (受限于无 DOM):
 *  - LoopActionPopover 的 JSX 渲染输出 (DOM 包含哪些字符串)
 *  - forceExpand prop 把子组件 expanded 切到 true (这是 React state, 无 RTL 无法断言)
 *  - scrollIntoView 真实调用 (用 spy 模拟也需要 DOM); 改为断言 planBadgeClickAction 落 "scroll"
 *
 * 与 R0c 测试文件并存: 旧 16 用例不动, 本文件追加新场景。
 */

import { describe, expect, it } from "bun:test";
import {
  planBadgeClickAction,
  buildDecideBody,
  executeDecide,
  loopEventAnchorId,
} from "./LoopTimeline";
import type { LoopEvent } from "./LoopEventBadge";

describe("R0d-1: planBadgeClickAction — badge 单击意图分发", () => {
  it("Case 1a: context_compressed → 'scroll' (不弹层, 仅滚动 / 展开所在 loop)", () => {
    const evt: LoopEvent = {
      category: "context_change",
      kind: "context_compressed",
      reason: "user-compress",
      windowIds: ["w_1"],
    };
    const action = planBadgeClickAction(evt);
    expect(action.type).toBe("scroll");
    expect(action.event).toBe(evt);
  });

  it("Case 1b: tool_result ok=false → 'scroll'", () => {
    const evt: LoopEvent = {
      category: "tool_runtime",
      kind: "function_call_output",
      toolName: "exec",
      ok: false,
    };
    expect(planBadgeClickAction(evt).type).toBe("scroll");
  });

  it("Case 1c: permission_ask (已 approved / 已 rejected) → 'scroll' (不再弹决议层)", () => {
    const approved: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      decided: { action: "approve", at: Date.now() },
    };
    const rejected: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      decided: { action: "reject", at: Date.now(), reason: "x" },
    };
    expect(planBadgeClickAction(approved).type).toBe("scroll");
    expect(planBadgeClickAction(rejected).type).toBe("scroll");
  });

  it("Case 1d: permission_denied → 'scroll' (denied 不可决议)", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_denied",
      method: "exec",
      reason: "blocked",
    };
    expect(planBadgeClickAction(evt).type).toBe("scroll");
  });
});

describe("R0d-2: approve/reject 流程", () => {
  it("Case 2: pending permission_ask → 'open-permission'", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      toolCallId: "call_42",
      argsSummary: "rm -rf /",
    };
    const action = planBadgeClickAction(evt);
    expect(action.type).toBe("open-permission");
    expect(action.event).toBe(evt);
  });

  it("Case 2b: executeDecide({approve}) → fetcher 收到 POST + body 含 action=approve + eventId fallback", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetcher = async <T,>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { ok: true } as T;
    };
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      toolCallId: "call_42",
    };
    await executeDecide({
      fetcher: fetcher as never,
      sessionId: "sess_a",
      objectId: "obj_b",
      threadId: "root",
      event: evt,
      decision: { action: "approve" },
    });
    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe(
      "/api/runtime/flows/sess_a/obj_b/threads/root/permission",
    );
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(body.action).toBe("approve");
    // 无 explicit id → 回落到 toolCallId + "_ask"
    expect(body.eventId).toBe("call_42_ask");
    expect(body.reason).toBeUndefined();
  });

  it("Case 3: executeDecide({reject, reason='test reject'}) → body 含 reason 原文", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetcher = async <T,>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { ok: true } as T;
    };
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      id: "evt_abc",
      toolCallId: "call_99",
    };
    await executeDecide({
      fetcher: fetcher as never,
      sessionId: "s",
      objectId: "o",
      threadId: "t",
      event: evt,
      decision: { action: "reject", reason: "test reject" },
    });
    const body = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(body.action).toBe("reject");
    // explicit event.id 优先级最高 (不回落 toolCallId)
    expect(body.eventId).toBe("evt_abc");
    expect(body.reason).toBe("test reject");
  });

  it("空 reason 字段不进 body (避免 backend 把空字符串当真 reason)", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      toolCallId: "c1",
    };
    expect(buildDecideBody(evt, { action: "reject", reason: "" }).reason).toBeUndefined();
    expect(buildDecideBody(evt, { action: "reject" }).reason).toBeUndefined();
  });

  it("无 toolCallId 也无 explicit id → eventId 缺省, 让 backend 选最近一条 pending", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
    };
    const body = buildDecideBody(evt, { action: "approve" });
    expect(body.eventId).toBeUndefined();
    expect(body.action).toBe("approve");
  });
});

describe("R0d-5: 错误路径", () => {
  it("Case 5: fetcher 失败 → executeDecide rethrow (popover 负责显示)", async () => {
    const fetcher = async <T,>(_path: string, _init?: RequestInit): Promise<T> => {
      throw new Error("HTTP 400: invalid eventId");
    };
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "exec",
      toolCallId: "c1",
    };
    let caught: Error | undefined;
    try {
      await executeDecide({
        fetcher: fetcher as never,
        sessionId: "s",
        objectId: "o",
        threadId: "t",
        event: evt,
        decision: { action: "approve" },
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain("HTTP 400");
  });
});

describe("R0d-6: loopEventAnchorId 优先级", () => {
  it("event.id 存在 → 用 id 派生 anchor", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "x",
      id: "evt_xyz",
      toolCallId: "call_1",
    };
    expect(loopEventAnchorId(evt, 3, 0)).toBe("loop-event-evt_xyz");
  });

  it("缺 id 但有 toolCallId → 用 toolCallId 派生", () => {
    const evt: LoopEvent = {
      category: "permission",
      kind: "permission_ask",
      method: "x",
      toolCallId: "call_42",
    };
    expect(loopEventAnchorId(evt, 3, 0)).toBe("loop-event-call_42");
  });

  it("都没有 → 用 loop + idx 派生 (确保稳定 anchor)", () => {
    const evt: LoopEvent = {
      category: "context_change",
      kind: "context_compressed",
      reason: "idle-fold",
      windowIds: [],
    };
    expect(loopEventAnchorId(evt, 7, 2)).toBe("loop-event-loop7-2");
  });
});
