/**
 * 单元测试：terminal_process 的 exec history viewport 协议（Wave 4 对象模型）。
 *
 * 覆盖（仍存在的行为，经新 readable 契约验证）：
 * - render 默认 tail=10：history ≤ 10 全展开；> 10 截到末 10 + earlier_omitted
 * - <history_viewport> 元节点属性正确性（total / tail / history_start/end / earlier_omitted）
 * - last_output 始终是完整 history 最后一条（不受 viewport 影响）
 * - exec object method 仍正常 append 到完整 history（不受 viewport 影响）
 * - set_history_window window method（(ctx,self,before,args)=>新 win）：history_tail / history_start+end
 *   切换、tail/range 互斥 throw、字段缺失 no-op
 *
 * 旧 `getObjectDefinition / def.windowMethods / def.readable!({thread,window})` + `{ok,state,error}`
 * 适配器 + ContextWindow union `TerminalProcessWindow / ProcessExecRecord` + `process-history-viewport.js`
 * 命名导出均已退役——本测试对齐到 terminal_process class 的 readable 模块 + 三/四参 method 契约。
 */
import { describe, expect, it } from "bun:test";

import { serializeXml, xmlElement, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  renderProcessHistory,
  setHistoryWindowMethod,
  type ProcessWin,
} from "@ooc/builtins/terminal/terminal_process/readable/history.js";
import type { ProcessExecRecord } from "@ooc/builtins/terminal/terminal_process/types.js";
import terminalProcessReadable from "@ooc/builtins/terminal/terminal_process/readable/index.js";
import { Class as TerminalProcessClass } from "@ooc/builtins/terminal/terminal_process";
import type { Data as TerminalProcessData } from "@ooc/builtins/terminal/terminal_process";
import { makeThread } from "../../__tests__/make-thread.js";

const NOW = 1_700_000_000_000;
const setHistoryWindow = setHistoryWindowMethod;

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

/** 渲染 terminal_process readable 投影 → XML 字符串（外层包 <window>）。 */
function renderXml(history: ProcessExecRecord[], win: ProcessWin): string {
  const node = terminalProcessReadable.readable({} as never, { history }, win) as {
    class: string;
    content: XmlNode[];
  };
  const wrapper = xmlElement("window", { class: node.class }, node.content);
  return serializeXml(wrapper);
}

// ─────────────────────────── 单元: DEFAULT_HISTORY_VIEWPORT ─────────

describe("DEFAULT_HISTORY_VIEWPORT", () => {
  it("is { tail: 10 } and frozen", () => {
    expect(DEFAULT_HISTORY_VIEWPORT.tail).toBe(10);
    expect(Object.isFrozen(DEFAULT_HISTORY_VIEWPORT)).toBe(true);
  });
});

// ─────────────────────────── render: 默认 + 边界 ────────────────────

describe("terminal_process render: default tail=10", () => {
  it("history ≤ 10: all visible, no earlier_omitted", () => {
    const xml = renderXml(makeHistory(5), { historyViewport: { tail: 10 } });
    expect(xml).toContain("<history_viewport");
    expect(xml).toContain('total="5"');
    expect(xml).toContain('tail="10"');
    expect(xml).not.toContain("earlier_omitted");
    for (let i = 0; i < 5; i++) expect(xml).toContain(`id="exec_${i}"`);
  });

  it("history > 10: clips to last 10 + earlier_omitted", () => {
    const xml = renderXml(makeHistory(25), { historyViewport: { tail: 10 } });
    expect(xml).toContain('total="25"');
    expect(xml).toContain('tail="10"');
    expect(xml).toContain('earlier_omitted="15"');
    for (let i = 0; i < 15; i++) expect(xml).not.toContain(`id="exec_${i}"`);
    for (let i = 15; i < 25; i++) expect(xml).toContain(`id="exec_${i}"`);
    expect(xml).toContain('n="15"');
    expect(xml).toContain('n="24"');
  });

  it("uses DEFAULT_HISTORY_VIEWPORT when win has no historyViewport", () => {
    const xml = renderXml(makeHistory(15), {});
    expect(xml).toContain('tail="10"');
    expect(xml).toContain('earlier_omitted="5"');
  });

  it("empty history: no history_viewport meta node, only (no exec yet) comment", () => {
    const xml = renderXml([], {});
    expect(xml).toContain("no exec yet");
    expect(xml).not.toContain("<history_viewport");
  });
});

describe("terminal_process render: range mode", () => {
  it("renders [history_start, history_end) and exposes range attrs", () => {
    const xml = renderXml(makeHistory(20), { historyViewport: { rangeStart: 5, rangeEnd: 10 } });
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
  it("last_output always shows the most recent exec, even when not in visible viewport", () => {
    const xml = renderXml(makeHistory(20), { historyViewport: { rangeStart: 0, rangeEnd: 3 } });
    expect(xml).toContain('exec_id="exec_19"');
    expect(xml).toContain("output 19");
  });
});

// renderProcessHistory 直调（与 readable 同源）等价
describe("renderProcessHistory shared helper", () => {
  it("returns nodes equivalent to readable projection content", () => {
    const nodes = renderProcessHistory(makeHistory(3), { historyViewport: { tail: 10 } });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="3"');
    for (let i = 0; i < 3; i++) expect(xml).toContain(`id="exec_${i}"`);
  });
});

// ─────────────────────────── set_history_window window method ────────

describe("set_history_window window method", () => {
  const call = (before: ProcessWin, args: Record<string, unknown>) =>
    setHistoryWindow.exec({} as never, { history: [] }, before, args);

  it("history_tail returns new win with historyViewport", () => {
    const out = call({ historyViewport: { tail: 10 } }, { history_tail: 30 });
    expect(out).toEqual({ historyViewport: { tail: 30 } });
  });

  it("range mode replaces tail", () => {
    const out = call({ historyViewport: { tail: 10 } }, { history_start: 0, history_end: 3 });
    expect(out).toEqual({ historyViewport: { rangeStart: 0, rangeEnd: 3 } });
  });

  it("does not mutate input win", () => {
    const before: ProcessWin = { historyViewport: { tail: 10 } };
    call(before, { history_tail: 30 });
    expect(before.historyViewport).toEqual({ tail: 10 });
  });

  it("fail-loud: history_tail + history_start mutually exclusive", () => {
    expect(() =>
      call({ historyViewport: { tail: 10 } }, { history_tail: 5, history_start: 0, history_end: 3 }),
    ).toThrow(/互斥/);
  });

  it("fail-loud: invalid history_tail (negative)", () => {
    expect(() => call({ historyViewport: { tail: 10 } }, { history_tail: -1 })).toThrow(/正整数/);
  });

  it("fail-loud: history_start without history_end", () => {
    expect(() => call({ historyViewport: { tail: 10 } }, { history_start: 0 })).toThrow(
      /range_start 与 range_end 必须同时出现/,
    );
  });

  it("fail-loud: history_start > history_end", () => {
    expect(() => call({ historyViewport: { tail: 10 } }, { history_start: 5, history_end: 2 })).toThrow(
      /range_start \(5\) > range_end \(2\)/,
    );
  });

  it("no viewport args returns current viewport unchanged (no-op)", () => {
    const out = call({ historyViewport: { tail: 10 } }, {});
    expect(out).toEqual({ historyViewport: { tail: 10 } });
  });
});

// ─────────────────────────── set_history_window 挂在 terminal_process 的 window 声明上 ──

describe("set_history_window registered on terminal_process window class", () => {
  it("terminal_process readable window declares set_history_window in window_methods (not object_methods)", () => {
    const decl = terminalProcessReadable.window.find((w) => w.class === "terminal_process")!;
    expect(decl.window_methods.map((m) => m.name)).toContain("set_history_window");
    expect(decl.object_methods).not.toContain("set_history_window");
  });
});

// ─────────────────────────── exec object method unaffected by viewport ────

describe("terminal_process.exec object method is not affected by historyViewport", () => {
  it("exec appends to full history regardless of viewport setting", async () => {
    const thread = makeThread({ id: "t_exec_under_viewport" });
    const execMethod = TerminalProcessClass.executable!.methods.find((m) => m.name === "exec")!;
    const self: TerminalProcessData = { history: makeHistory(3) };
    const ctx = { thread, runtime: undefined, reportDataEdit: async () => {} } as never;

    const out = await execMethod.exec(ctx, self, { code: "echo new" });
    expect(out).toBeUndefined();
    // exec append 到完整 history（viewport 是投影态、不在 Data 上，故不受影响）。
    expect(self.history.length).toBe(4);
  });
});
