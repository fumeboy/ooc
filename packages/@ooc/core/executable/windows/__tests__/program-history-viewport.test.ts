/**
 * 单元 + 集成测试：program_window 的 exec history viewport 协议（R1c）。
 *
 * 覆盖：
 * - render 默认 tail=10：history ≤ 10 全展开；> 10 截到末 10 + earlier_omitted
 * - set_history_window 命令：history_tail / history_start+history_end 切换、互斥、fail-loud
 * - render 时 <history_viewport> 元节点属性正确性
 * - last_output 始终是完整 history 的最后一条（不受 viewport 影响）
 * - exec 命令仍正常 append 到完整 history（不受 viewport 影响）
 * - root.program 创建时填默认 historyViewport
 */
import { describe, expect, it } from "bun:test";

import "@ooc/builtins/program"; // 触发 registerObjectType side-effect import

import { builtinRegistry } from "../_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  type ProgramExecRecord,
  type ProgramWindow,
} from "../_shared/types.js";
import { serializeXml } from "../../../thinkable/context/xml.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  executeProgramSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "@ooc/builtins/program";
import { executeProgramCommand } from "@ooc/builtins/root/executable/command.program.js";
import { executeProgramWindowExec } from "@ooc/builtins/program";
import { makeThread } from "../../../__tests__/make-thread.js";

const NOW = 1_700_000_000_000;

function makeHistory(n: number): ProgramExecRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    execId: `exec_${i}`,
    language: "shell" as const,
    code: `echo ${i}`,
    output: `output ${i}`,
    ok: true,
    startedAt: NOW + i,
  }));
}

function makeProgramWindow(opts: {
  id?: string;
  history: ProgramExecRecord[];
  historyViewport?: ProgramWindow["historyViewport"];
}): ProgramWindow {
  return {
    id: opts.id ?? "w_prog_1",
    type: "program",
    parentWindowId: ROOT_WINDOW_ID,
    title: "prog test",
    status: "open",
    createdAt: NOW,
    history: opts.history,
    historyViewport: opts.historyViewport,
  };
}

function makeRenderThread(window: ProgramWindow): ThreadContext {
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

// ─────────────────────────── 单元: hasAnyHistoryViewportField ───────

describe("hasAnyHistoryViewportField", () => {
  it("detects history_tail / history_start / history_end", () => {
    expect(hasAnyHistoryViewportField({ history_tail: 5 })).toBe(true);
    expect(hasAnyHistoryViewportField({ history_start: 0 })).toBe(true);
    expect(hasAnyHistoryViewportField({ history_end: 10 })).toBe(true);
  });

  it("does not trigger on unrelated keys", () => {
    expect(hasAnyHistoryViewportField({})).toBe(false);
    expect(hasAnyHistoryViewportField({ tail: 5 })).toBe(false);
    expect(hasAnyHistoryViewportField({ language: "shell" })).toBe(false);
  });
});

// ─────────────────────────── render: 默认 + 边界 ────────────────────

describe("program_window render: default tail=10", () => {
  it("history ≤ 10: all visible, no earlier_omitted", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("program");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain("<history_viewport");
    expect(xml).toContain('total="5"');
    expect(xml).toContain('tail="10"');
    expect(xml).not.toContain("earlier_omitted");
    // all execs visible
    for (let i = 0; i < 5; i++) {
      expect(xml).toContain(`id="exec_${i}"`);
    }
  });

  it("history > 10: clips to last 10 + earlier_omitted", async () => {
    const window = makeProgramWindow({
      history: makeHistory(25),
      historyViewport: { tail: 10 },
    });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("program");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="25"');
    expect(xml).toContain('tail="10"');
    expect(xml).toContain('earlier_omitted="15"');
    // first 15 (index 0..14) hidden from history summary
    for (let i = 0; i < 15; i++) {
      expect(xml).not.toContain(`id="exec_${i}"`);
    }
    // last 10 visible (index 15..24)
    for (let i = 15; i < 25; i++) {
      expect(xml).toContain(`id="exec_${i}"`);
    }
    // n attribute preserves absolute index
    expect(xml).toContain('n="15"');
    expect(xml).toContain('n="24"');
  });

  it("uses DEFAULT_HISTORY_VIEWPORT when window has no historyViewport (legacy)", async () => {
    const window = makeProgramWindow({
      history: makeHistory(15),
      // no historyViewport
    });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("program");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('tail="10"');
    expect(xml).toContain('earlier_omitted="5"');
  });

  it("empty history: no history_viewport meta node, only (no exec yet) comment", async () => {
    const window = makeProgramWindow({
      history: [],
    });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("program");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain("no exec yet");
    expect(xml).not.toContain("<history_viewport");
  });
});

describe("program_window render: range mode", () => {
  it("renders [history_start, history_end) and exposes range attrs", async () => {
    const window = makeProgramWindow({
      history: makeHistory(20),
      historyViewport: { rangeStart: 5, rangeEnd: 10 },
    });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("program");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('history_start="5"');
    expect(xml).toContain('history_end="10"');
    expect(xml).toContain('total="20"');
    expect(xml).toContain('earlier_omitted="5"');
    // visible 5..9
    for (let i = 5; i < 10; i++) {
      expect(xml).toContain(`id="exec_${i}"`);
    }
    expect(xml).not.toContain(`id="exec_4"`);
    expect(xml).not.toContain(`id="exec_10"`);
  });
});

describe("program_window render: last_output unaffected by viewport", () => {
  it("last_output always shows the most recent exec, even when not in visible viewport", async () => {
    const window = makeProgramWindow({
      history: makeHistory(20),
      historyViewport: { rangeStart: 0, rangeEnd: 3 },
    });
    const thread = makeRenderThread(window);
    const def = builtinRegistry.getObjectDefinition("program");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    // history summary clipped to [0, 3); last_output still shows exec_19
    expect(xml).toContain('exec_id="exec_19"');
    expect(xml).toContain("output 19");
  });
});

// ─────────────────────────── command: set_history_window ────────────

describe("set_history_window command", () => {
  it("history_tail updates window.historyViewport", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await executeProgramSetHistoryViewport({
      args: { history_tail: 30 },
      self: window,
    });
    expect(out).toBeUndefined();
    expect(window.historyViewport).toEqual({ tail: 30 });
  });

  it("range mode replaces tail", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await executeProgramSetHistoryViewport({
      args: { history_start: 0, history_end: 3 },
      self: window,
    });
    expect(out).toBeUndefined();
    expect(window.historyViewport).toEqual({ rangeStart: 0, rangeEnd: 3 });
  });

  it("fail-loud: history_tail + history_start mutually exclusive", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await executeProgramSetHistoryViewport({
      args: { history_tail: 5, history_start: 0, history_end: 3 },
      self: window,
    });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("互斥");
    // 错误信息应用 history_* 命名（不暴露内部 tail / range_*）
    expect(out as string).toContain("history_tail");
    expect(out as string).toContain("history_start");
    expect(out as string).toContain("history_end");
    // unchanged
    expect(window.historyViewport).toEqual({ tail: 10 });
  });

  it("fail-loud: invalid history_tail (negative)", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await executeProgramSetHistoryViewport({
      args: { history_tail: -1 },
      self: window,
    });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("history_tail");
    expect(window.historyViewport).toEqual({ tail: 10 });
  });

  it("fail-loud: history_start without history_end", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await executeProgramSetHistoryViewport({
      args: { history_start: 0 },
      self: window,
    });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("history_start");
    expect(out as string).toContain("history_end");
    expect(window.historyViewport).toEqual({ tail: 10 });
  });

  it("fail-loud: history_start > history_end", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await executeProgramSetHistoryViewport({
      args: { history_start: 5, history_end: 2 },
      self: window,
    });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("history_start");
    expect(window.historyViewport).toEqual({ tail: 10 });
  });

  // P6.§3 (2026-06-02): self-type guard 已下放到 manager.submit；method 体不再 re-check。
  // 旧测试 "rejects when not mounted on program_window" 已删除，跨类型拒绝由
  // manager-dispatch 测试覆盖（见 manager-method-dispatch.test.ts）。

  it("no viewport args returns helpful error", async () => {
    const window = makeProgramWindow({
      history: makeHistory(5),
    });
    const out = await executeProgramSetHistoryViewport({
      args: {},
      self: window,
    });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("至少需要");
  });
});

// ─────────────────────────── command registered on program type ──────

describe("set_history_window registered on program window", () => {
  it("program window definition has set_history_window command", () => {
    const def = builtinRegistry.getObjectDefinition("program");
    expect(def.methods["set_history_window"]).toBeDefined();
  });

  it("registered command executes via window registry", async () => {
    const def = builtinRegistry.getObjectDefinition("program");
    const cmd = def.methods["set_history_window"]!;
    const window = makeProgramWindow({
      history: makeHistory(5),
      historyViewport: { tail: 10 },
    });
    const out = await cmd.exec({
      args: { history_tail: 25 },
      self: window,
    });
    expect(out).toBeUndefined();
    expect(window.historyViewport).toEqual({ tail: 25 });
  });
});

// ─────────────────────────── exec command unaffected by viewport ────

describe("program_window.exec is not affected by historyViewport", () => {
  it("exec append to full history regardless of viewport setting", async () => {
    const thread = makeThread({ id: "t_exec_under_viewport" });
    const window = makeProgramWindow({
      history: makeHistory(3),
      historyViewport: { rangeStart: 0, rangeEnd: 1 },
    });
    thread.contextWindows = [window];

    const out = await executeProgramWindowExec({
      thread,
      args: { language: "shell", code: "echo new" },
      self: window,
    });
    expect(out).toBeUndefined();
    // history should now have 4 entries (3 original + 1 new)
    expect(window.history.length).toBe(4);
    // viewport unchanged
    expect(window.historyViewport).toEqual({ rangeStart: 0, rangeEnd: 1 });
  });
});

// ─────────────────────────── root.program creates with default viewport ──

describe("root.program creates program_window with DEFAULT_HISTORY_VIEWPORT", () => {
  it("new program_window has historyViewport = { tail: 10 }", async () => {
    const thread = makeThread({ id: "t_root_program" });
    const out = await executeProgramCommand({
      thread,
      args: { language: "shell", code: "echo hi" },
    });
    // P6.§4-§5: root.program 现在是 constructor 委托——返回 { ok:true, object } 而非 undefined
    expect(out).toBeDefined();
    expect(typeof out).toBe("object");
    const outcome = out as { ok: true; object: ProgramWindow };
    expect(outcome.ok).toBe(true);
    expect(outcome.object.type).toBe("program");
    expect(outcome.object.historyViewport).toEqual({ tail: 10 });
  });
});
