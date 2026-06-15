/**
 * 单元 + 集成测试：terminal_process 的 exec history viewport 协议。
 *
 * 覆盖：
 * - render 默认 tail=10：history ≤ 10 全展开；> 10 截到末 10 + earlier_omitted
 * - set_history_window 命令：history_tail / history_start+history_end 切换、互斥、fail-loud
 * - render 时 <history_viewport> 元节点属性正确性
 * - last_output 始终是完整 history 的最后一条（不受 viewport 影响）
 * - exec 命令仍正常 append 到完整 history（不受 viewport 影响）
 * - terminal.run 创建时填默认 historyViewport
 */
import { describe, expect, it } from "bun:test";

import "@ooc/builtins/terminal/terminal_process"; // 触发 registerWindowClass side-effect import

import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import {
  ROOT_WINDOW_ID,
  type ProcessExecRecord,
  type TerminalProcessWindow,
} from "@ooc/core/_shared/types/context-window.js";
import { serializeXml } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  makeHistoryViewport,
} from "@ooc/builtins/_shared/executable/process-history-viewport.js";
import { runExec as executeTerminalRun } from "@ooc/builtins/terminal/executable/index.js";
import { executeTerminalProcessExec } from "@ooc/builtins/terminal/terminal_process";
import { makeThread } from "../../../__tests__/make-thread.js";

const NOW = 1_700_000_000_000;
const { setViewport, hasAnyField } = makeHistoryViewport("terminal_process.set_history_window");

function makeHistory(n: number): ProcessExecRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    execId: `exec_${i}`,
    language: "shell" as const,
    code: `echo ${i}`,
    output: `output ${i}`,
    ok: true,
    startedAt: NOW + i,
  }));
}

function makeProcessWindow(opts: {
  id?: string;
  history: ProcessExecRecord[];
  historyViewport?: TerminalProcessWindow["historyViewport"];
}): TerminalProcessWindow {
  return {
    id: opts.id ?? "w_proc_1",
    class: "terminal_process",
    parentWindowId: ROOT_WINDOW_ID,
    title: "proc test",
    status: "open",
    createdAt: NOW,
    history: opts.history,
    state: opts.historyViewport ? { historyViewport: opts.historyViewport } : undefined,
  };
}

function makeRenderThread(window: TerminalProcessWindow): ThreadContext {
  return {
    id: "self",
    status: "running",
    events: [],
    contextWindows: [window],
    inbox: [],
    outbox: [],
  };
}

// ─────────────────────────── 单元: DEFAULT_HISTORY_VIEWPORT ─────────

describe("DEFAULT_HISTORY_VIEWPORT", () => {
  it("is { tail: 10 } and frozen", () => {
    expect(DEFAULT_HISTORY_VIEWPORT.tail).toBe(10);
    expect(Object.isFrozen(DEFAULT_HISTORY_VIEWPORT)).toBe(true);
  });
});

// ─────────────────────────── 单元: hasAnyField ───────

describe("hasAnyField", () => {
  it("detects history_tail / history_start / history_end", () => {
    expect(hasAnyField({ history_tail: 5 })).toBe(true);
    expect(hasAnyField({ history_start: 0 })).toBe(true);
    expect(hasAnyField({ history_end: 10 })).toBe(true);
  });

  it("does not trigger on unrelated keys", () => {
    expect(hasAnyField({})).toBe(false);
    expect(hasAnyField({ tail: 5 })).toBe(false);
    expect(hasAnyField({ language: "shell" })).toBe(false);
  });
});

// ─────────────────────────── render: 默认 + 边界 ────────────────────

describe("terminal_process render: default tail=10", () => {
  it("history ≤ 10: all visible, no earlier_omitted", async () => {
    const window = makeProcessWindow({ history: makeHistory(5), historyViewport: { tail: 10 } });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain("<history_viewport");
    expect(xml).toContain('total="5"');
    expect(xml).toContain('tail="10"');
    expect(xml).not.toContain("earlier_omitted");
    for (let i = 0; i < 5; i++) expect(xml).toContain(`id="exec_${i}"`);
  });

  it("history > 10: clips to last 10 + earlier_omitted", async () => {
    const window = makeProcessWindow({ history: makeHistory(25), historyViewport: { tail: 10 } });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="25"');
    expect(xml).toContain('tail="10"');
    expect(xml).toContain('earlier_omitted="15"');
    for (let i = 0; i < 15; i++) expect(xml).not.toContain(`id="exec_${i}"`);
    for (let i = 15; i < 25; i++) expect(xml).toContain(`id="exec_${i}"`);
    expect(xml).toContain('n="15"');
    expect(xml).toContain('n="24"');
  });

  it("uses DEFAULT_HISTORY_VIEWPORT when window has no historyViewport (legacy)", async () => {
    const window = makeProcessWindow({ history: makeHistory(15) });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('tail="10"');
    expect(xml).toContain('earlier_omitted="5"');
  });

  it("empty history: no history_viewport meta node, only (no exec yet) comment", async () => {
    const window = makeProcessWindow({ history: [] });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain("no exec yet");
    expect(xml).not.toContain("<history_viewport");
  });
});

describe("terminal_process render: range mode", () => {
  it("renders [history_start, history_end) and exposes range attrs", async () => {
    const window = makeProcessWindow({ history: makeHistory(20), historyViewport: { rangeStart: 5, rangeEnd: 10 } });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('history_start="5"');
    expect(xml).toContain('history_end="10"');
    expect(xml).toContain('total="20"');
    expect(xml).toContain('earlier_omitted="5"');
    for (let i = 5; i < 10; i++) expect(xml).toContain(`id="exec_${i}"`);
    expect(xml).not.toContain(`id="exec_4"`);
    expect(xml).not.toContain(`id="exec_10"`);
  });
});

describe("terminal_process render: last_output unaffected by viewport", () => {
  it("last_output always shows the most recent exec, even when not in visible viewport", async () => {
    const window = makeProcessWindow({ history: makeHistory(20), historyViewport: { rangeStart: 0, rangeEnd: 3 } });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('exec_id="exec_19"');
    expect(xml).toContain("output 19");
  });
});

// ─────────────────────────── method: set_history_window ────────────

describe("set_history_window window method", () => {
  it("history_tail returns new state with historyViewport", () => {
    const out = setViewport({ args: { history_tail: 30 }, windowState: { historyViewport: { tail: 10 } } } as any);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.state.historyViewport).toEqual({ tail: 30 });
  });

  it("range mode replaces tail", () => {
    const out = setViewport({ args: { history_start: 0, history_end: 3 }, windowState: { historyViewport: { tail: 10 } } } as any);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.state.historyViewport).toEqual({ rangeStart: 0, rangeEnd: 3 });
  });

  it("does not mutate input windowState", () => {
    const windowState = { historyViewport: { tail: 10 } };
    setViewport({ args: { history_tail: 30 }, windowState } as any);
    expect(windowState.historyViewport).toEqual({ tail: 10 });
  });

  it("fail-loud: history_tail + history_start mutually exclusive", () => {
    const out = setViewport({ args: { history_tail: 5, history_start: 0, history_end: 3 }, windowState: { historyViewport: { tail: 10 } } } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("互斥");
      expect(out.error).toContain("history_tail");
      expect(out.error).toContain("history_start");
      expect(out.error).toContain("history_end");
    }
  });

  it("fail-loud: invalid history_tail (negative)", () => {
    const out = setViewport({ args: { history_tail: -1 }, windowState: { historyViewport: { tail: 10 } } } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("history_tail");
  });

  it("fail-loud: history_start without history_end", () => {
    const out = setViewport({ args: { history_start: 0 }, windowState: { historyViewport: { tail: 10 } } } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("history_start");
      expect(out.error).toContain("history_end");
    }
  });

  it("fail-loud: history_start > history_end", () => {
    const out = setViewport({ args: { history_start: 5, history_end: 2 }, windowState: { historyViewport: { tail: 10 } } } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("history_start");
  });

  it("no viewport args returns ok with helpful result text", () => {
    const out = setViewport({ args: {}, windowState: {} } as any);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result).toContain("至少需要");
  });
});

// ─────────────────────────── windowMethod registered on terminal_process type ──

describe("set_history_window registered as windowMethod on terminal_process", () => {
  it("definition has set_history_window in windowMethods (not methods)", () => {
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    expect(def.windowMethods?.["set_history_window"]).toBeDefined();
    expect(def.methods["set_history_window"]).toBeUndefined();
  });

  it("registered windowMethod executes returning new state", () => {
    const def = builtinRegistry.getObjectDefinition("terminal_process");
    const cmd = def.windowMethods!["set_history_window"]!;
    const out = cmd.exec({ args: { history_tail: 25 }, windowState: { historyViewport: { tail: 10 } } } as any) as any;
    expect(out.ok).toBe(true);
    expect(out.state.historyViewport).toEqual({ tail: 25 });
  });
});

// ─────────────────────────── exec method unaffected by viewport ────

describe("terminal_process.exec is not affected by historyViewport", () => {
  it("exec append to full history regardless of viewport setting", async () => {
    const thread = makeThread({ id: "t_exec_under_viewport" });
    const window = makeProcessWindow({ history: makeHistory(3), historyViewport: { rangeStart: 0, rangeEnd: 1 } });
    thread.contextWindows = [window];

    const out = await executeTerminalProcessExec({ thread, args: { code: "echo new" }, self: window } as any);
    expect(out).toBeUndefined();
    expect(window.history.length).toBe(4);
    expect(window.state?.historyViewport).toEqual({ rangeStart: 0, rangeEnd: 1 });
  });
});

// ─────────────────────────── terminal.run creates with default viewport ──

describe("terminal.run creates terminal_process with DEFAULT_HISTORY_VIEWPORT", () => {
  it("new terminal_process has historyViewport = { tail: 10 }", async () => {
    const thread = makeThread({ id: "t_terminal_run" });
    const out = await executeTerminalRun({ thread, args: { code: "echo hi" } } as any);
    expect(out).toBeDefined();
    expect(typeof out).toBe("object");
    const outcome = out as { ok: true; window: TerminalProcessWindow };
    expect(outcome.ok).toBe(true);
    expect(outcome.window.class).toBe("terminal_process");
    expect(outcome.window.state?.historyViewport).toEqual({ tail: 10 });
  });
});
