import { describe, expect, it } from "bun:test";
import { formatThread } from "./formatter";
import type { ThreadContext } from "./model";

/** 构造一个 minimal thread context with the given events，便于测试 formatter。 */
function makeThread(events: unknown[]): ThreadContext {
  return {
    id: "root",
    status: "running",
    inbox: [],
    contextWindows: [],
    events: events as never,
  } as ThreadContext;
}

const callOpen = (callId: string, opts: { method?: string; title?: string }) => ({
  category: "llm_interaction",
  kind: "function_call",
  callId,
  toolName: "open",
  arguments: { method: opts.method ?? "talk", title: opts.title ?? "open card" },
});

const callOpenOutput = (callId: string, windowId: string, ok: boolean = true) => ({
  category: "tool_runtime",
  kind: "function_call_output",
  callId,
  toolName: "open",
  ok,
  output: JSON.stringify({ ok, window_id: windowId }),
});

const callRefine = (callId: string, parentWindowId: string, formArgs?: Record<string, unknown>) => ({
  category: "llm_interaction",
  kind: "function_call",
  callId,
  toolName: "refine",
  arguments: { parent_window_id: parentWindowId, form_args: formArgs ?? { msg: "x" } },
});

const callRefineOutput = (callId: string, ok: boolean = true) => ({
  category: "tool_runtime",
  kind: "function_call_output",
  callId,
  toolName: "refine",
  ok,
  output: JSON.stringify({ ok }),
});

const callSubmit = (callId: string, parentWindowId: string) => ({
  category: "llm_interaction",
  kind: "function_call",
  callId,
  toolName: "submit",
  arguments: { parent_window_id: parentWindowId },
});

const callSubmitOutput = (callId: string, ok: boolean = true) => ({
  category: "tool_runtime",
  kind: "function_call_output",
  callId,
  toolName: "submit",
  ok,
  output: JSON.stringify({ ok }),
});

const callClose = (callId: string, windowId: string) => ({
  category: "llm_interaction",
  kind: "function_call",
  callId,
  toolName: "close",
  arguments: { window_id: windowId },
});

const callCloseOutput = (callId: string, ok: boolean = true) => ({
  category: "tool_runtime",
  kind: "function_call_output",
  callId,
  toolName: "close",
  ok,
  output: JSON.stringify({ ok }),
});

describe("formatThread: groupConsecutiveToolLines", () => {
  it("merges open + refine + submit + close on same window into a single tool line with followUps", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", { title: "发送确认清单" }),
        callOpenOutput("c1", "win_X"),
        callRefine("c2", "win_X"),
        callRefineOutput("c2"),
        callSubmit("c3", "win_X"),
        callSubmitOutput("c3"),
        callClose("c4", "win_X"),
        callCloseOutput("c4"),
      ]),
    );
    // 4 tools 折叠为 1 个主 line
    expect(lines.length).toBe(1);
    const head = lines[0];
    expect(head.kind).toBe("tool");
    if (head.kind !== "tool") return;
    expect(head.toolName).toBe("open");
    expect(head.followUps?.map((f) => f.toolName)).toEqual(["refine", "submit", "close"]);
    expect(head.followUps?.every((f) => f.ok)).toBe(true);
  });

  it("does NOT merge across messages", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", {}),
        callOpenOutput("c1", "win_X"),
        callRefine("c2", "win_X"),
        callRefineOutput("c2"),
        // 中间夹一条 LLM text → 切断分组
        { category: "llm_interaction", kind: "text", text: "thinking..." },
        callSubmit("c3", "win_X"),
        callSubmitOutput("c3"),
      ]),
    );
    // open + 1 followUp(refine) → 1 行；message → 1 行；submit 单独 → 1 行
    expect(lines.length).toBe(3);
    expect(lines[0].kind).toBe("tool");
    if (lines[0].kind === "tool") {
      expect(lines[0].toolName).toBe("open");
      expect(lines[0].followUps?.map((f) => f.toolName)).toEqual(["refine"]);
    }
    expect(lines[1].kind).toBe("message");
    expect(lines[2].kind).toBe("tool");
    if (lines[2].kind === "tool") {
      expect(lines[2].toolName).toBe("submit");
      expect(lines[2].followUps).toBeUndefined();
    }
  });

  it("does NOT merge tools targeting different windows", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", {}),
        callOpenOutput("c1", "win_A"),
        callRefine("c2", "win_B"), // 别的 window
        callRefineOutput("c2"),
      ]),
    );
    expect(lines.length).toBe(2);
    if (lines[0].kind === "tool") expect(lines[0].followUps).toBeUndefined();
  });

  it("two separate open chains stay separate", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", { title: "first" }),
        callOpenOutput("c1", "win_A"),
        callSubmit("c2", "win_A"),
        callSubmitOutput("c2"),
        callOpen("c3", { title: "second" }),
        callOpenOutput("c3", "win_B"),
        callClose("c4", "win_B"),
        callCloseOutput("c4"),
      ]),
    );
    expect(lines.length).toBe(2);
    if (lines[0].kind === "tool") {
      expect(lines[0].followUps?.map((f) => f.toolName)).toEqual(["submit"]);
    }
    if (lines[1].kind === "tool") {
      expect(lines[1].followUps?.map((f) => f.toolName)).toEqual(["close"]);
    }
  });

  it("open without follow-ups stays as bare tool line (no empty followUps array)", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", {}),
        callOpenOutput("c1", "win_A"),
      ]),
    );
    expect(lines.length).toBe(1);
    if (lines[0].kind === "tool") {
      expect(lines[0].toolName).toBe("open");
      expect(lines[0].followUps).toBeUndefined();
    }
  });

  it("non-mergeable tools (e.g. wait) break the chain", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", {}),
        callOpenOutput("c1", "win_A"),
        callRefine("c2", "win_A"),
        callRefineOutput("c2"),
        // wait 不在 mergeable 集合里
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "c3",
          toolName: "wait",
          arguments: { window_id: "win_A" },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "c3",
          toolName: "wait",
          ok: true,
          output: JSON.stringify({ ok: true }),
        },
        callSubmit("c4", "win_A"),
        callSubmitOutput("c4"),
      ]),
    );
    // open + refine 一组；wait 独立；submit 独立
    expect(lines.length).toBe(3);
    if (lines[0].kind === "tool") expect(lines[0].followUps?.map((f) => f.toolName)).toEqual(["refine"]);
    expect(lines[1].kind).toBe("tool");
    if (lines[1].kind === "tool") expect(lines[1].toolName).toBe("wait");
    if (lines[2].kind === "tool") expect(lines[2].toolName).toBe("submit");
  });

  it("preserves followUp ok / pending flags", () => {
    const lines = formatThread(
      makeThread([
        callOpen("c1", {}),
        callOpenOutput("c1", "win_A"),
        callRefine("c2", "win_A"),
        callRefineOutput("c2", false), // 失败
        callSubmit("c3", "win_A"),
        // 缺 submit output → pending
      ]),
    );
    expect(lines.length).toBe(1);
    if (lines[0].kind !== "tool") throw new Error("expected tool kind");
    const fs = lines[0].followUps;
    expect(fs?.length).toBe(2);
    expect(fs?.[0].ok).toBe(false);
    expect(fs?.[1].pending).toBe(true);
  });

  it("real-world shape: form_id field on open output + refine/submit args.form_id", () => {
    // 真实 OOC 后端用 form_id 作为 form-window 标识符（不是 window_id /
    // parent_window_id）。回归 2026-05-21：deriveTargetWindowId 应当先看
    // form_id，再 fallback window_id / parent_window_id。
    const lines = formatThread(
      makeThread([
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "c1",
          toolName: "open",
          arguments: { title: "汇总查询结果", method: "program" },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "c1",
          toolName: "open",
          ok: true,
          // 真实后端 output —— 含 form_id 字段
          output: JSON.stringify({
            ok: true,
            tool: "open",
            message: "Form f_xyz 已创建（program）。",
            form_id: "f_xyz",
            auto_submitted: false,
          }),
        },
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "c2",
          toolName: "refine",
          arguments: { title: "填写汇总脚本", form_id: "f_xyz", args: { code: "..." } },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "c2",
          toolName: "refine",
          ok: true,
          output: JSON.stringify({ ok: true }),
        },
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "c3",
          toolName: "submit",
          arguments: { title: "提交汇总脚本", form_id: "f_xyz" },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "c3",
          toolName: "submit",
          ok: true,
          output: JSON.stringify({ ok: true }),
        },
      ]),
    );
    expect(lines.length).toBe(1);
    if (lines[0].kind !== "tool") throw new Error("expected tool kind");
    expect(lines[0].toolName).toBe("open");
    expect(lines[0].followUps?.map((f) => f.toolName)).toEqual(["refine", "submit"]);
  });
});
