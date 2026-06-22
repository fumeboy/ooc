/**
 * 单元测试：search class 的 matches viewport 协议（Wave 4 对象模型）。
 *
 * 覆盖（仍存在的行为，经新 readable 契约验证）：
 * - readable(ctx, self, win) 投影：默认 tail=50；matches ≤ 50 全展开、> 50 截到末 50 + earlier_omitted
 * - results_viewport 元节点属性（total / tail / matches_start/end / earlier_omitted）
 * - matches.count 反映全集（非可见数）
 * - set_results_window window method（(ctx,self,before,args)=>新 win）：matches_tail / matches_start+end
 *   切换、tail/range 互斥 throw、字段缺失 no-op；错误用 agent-facing matches_* 命名
 *
 * 旧 `getObjectDefinition / def.windowMethods / def.readable!({thread,window})` + `{ok,state,error}`
 * 适配器 + ContextWindow union `SearchWindow/SearchMatch` + `executable/results-viewport.js` 命名
 * 导出均已退役——本测试对齐到 search class 的 readable 模块 + 三/四参 method 契约。
 */
import { describe, expect, it } from "bun:test";

import { serializeXml, xmlElement, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { makeSelfProxy, makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";
import searchReadable, {
  DEFAULT_RESULTS_VIEWPORT,
} from "@ooc/builtins/filesystem/search/readable/index.js";
import { Class as SearchClass } from "@ooc/builtins/filesystem/search";
import type { Data, SearchMatch } from "@ooc/builtins/filesystem/search/types";

/** 把 readable 投影 {class, content} 序列化成 XML 字符串（外层包 <window>）。 */
function renderXml(self: Data, win: { resultsViewport?: Data["matches"] extends never ? never : unknown }): string {
  const node = searchReadable.readable({} as never, makeReadonlySelfProxy(self), win as never) as {
    class: string;
    content: XmlNode[];
  };
  const wrapper = xmlElement("window", { class: node.class }, node.content);
  return serializeXml(wrapper);
}

function makeMatches(n: number): SearchMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    path: `src/file-${i}.ts`,
    line: i + 1,
    snippet: `match ${i}`,
  }));
}

function makeData(matches: SearchMatch[]): Data {
  return {
    kind: "grep",
    query: "foo",
    matches,
    truncated: false,
    searchRoot: "/tmp",
  };
}

const setResultsWindow = searchReadable.window[0]!.window_methods.find(
  (m) => m.name === "set_results_window",
)!;

// ─────────────────────────── 单元: DEFAULT_RESULTS_VIEWPORT ─────────

describe("DEFAULT_RESULTS_VIEWPORT", () => {
  it("is { tail: 50 } and frozen", () => {
    expect(DEFAULT_RESULTS_VIEWPORT.tail).toBe(50);
    expect(Object.isFrozen(DEFAULT_RESULTS_VIEWPORT)).toBe(true);
  });
});

// ─────────────────────────── render: 默认 + 边界 ────────────────────

describe("search readable render: default tail=50", () => {
  it("matches ≤ 50: all visible, no earlier_omitted", () => {
    const xml = renderXml(makeData(makeMatches(20)), { resultsViewport: { tail: 50 } });
    expect(xml).toContain("<results_viewport");
    expect(xml).toContain('total="20"');
    expect(xml).toContain('tail="50"');
    expect(xml).not.toContain("earlier_omitted");
    for (let i = 0; i < 20; i++) expect(xml).toContain(`src/file-${i}.ts`);
  });

  it("matches > 50: clips to last 50 + earlier_omitted", () => {
    const xml = renderXml(makeData(makeMatches(120)), { resultsViewport: { tail: 50 } });
    expect(xml).toContain('total="120"');
    expect(xml).toContain('tail="50"');
    expect(xml).toContain('earlier_omitted="70"');
    for (let i = 0; i < 70; i++) expect(xml).not.toContain(`path="src/file-${i}.ts"`);
    for (let i = 70; i < 120; i++) expect(xml).toContain(`path="src/file-${i}.ts"`);
  });

  it("uses DEFAULT_RESULTS_VIEWPORT when win has no resultsViewport", () => {
    const xml = renderXml(makeData(makeMatches(60)), {});
    expect(xml).toContain('tail="50"');
    expect(xml).toContain('earlier_omitted="10"');
  });
});

describe("search readable render: range mode", () => {
  it("renders [matches_start, matches_end) and exposes range attrs", () => {
    const xml = renderXml(makeData(makeMatches(20)), { resultsViewport: { rangeStart: 5, rangeEnd: 10 } });
    expect(xml).toContain('matches_start="5"');
    expect(xml).toContain('matches_end="10"');
    expect(xml).toContain('total="20"');
    expect(xml).toContain('earlier_omitted="5"');
    for (let i = 5; i < 10; i++) expect(xml).toContain(`path="src/file-${i}.ts"`);
    expect(xml).not.toContain(`path="src/file-4.ts"`);
    expect(xml).not.toContain(`path="src/file-10.ts"`);
  });
});

describe("search readable render: matches.count reflects full total (not visible)", () => {
  it("count attribute is total matches.length, NOT visible.length", () => {
    const xml = renderXml(makeData(makeMatches(100)), { resultsViewport: { tail: 10 } });
    expect(xml).toContain('<matches count="100"');
    expect(xml).toContain('total="100"');
  });
});

// ─────────────────────────── set_results_window window method ────────

describe("set_results_window window method", () => {
  const call = (before: unknown, args: Record<string, unknown>) =>
    setResultsWindow.exec({} as never, makeReadonlySelfProxy(makeData([])), before as never, args);

  it("matches_tail returns new win with resultsViewport", () => {
    const out = call({ resultsViewport: { tail: 50 } }, { matches_tail: 100 });
    expect(out).toEqual({ resultsViewport: { tail: 100 } });
  });

  it("range mode replaces tail", () => {
    const out = call({ resultsViewport: { tail: 50 } }, { matches_start: 0, matches_end: 5 });
    expect(out).toEqual({ resultsViewport: { rangeStart: 0, rangeEnd: 5 } });
  });

  it("does not mutate input win", () => {
    const before = { resultsViewport: { tail: 50 } };
    call(before, { matches_tail: 100 });
    expect(before.resultsViewport).toEqual({ tail: 50 });
  });

  it("fail-loud: matches_tail + matches_start mutually exclusive (matches_* naming)", () => {
    expect(() => call({ resultsViewport: { tail: 50 } }, { matches_tail: 10, matches_start: 0, matches_end: 5 })).toThrow(
      /互斥/,
    );
    try {
      call({ resultsViewport: { tail: 50 } }, { matches_tail: 10, matches_start: 0, matches_end: 5 });
    } catch (e) {
      const msg = (e as Error).message;
      // 错误信息用 agent-facing matches_* 命名（不暴露内部 tail / range_*）
      expect(msg).toContain("matches_tail");
      expect(msg).toContain("matches_start");
      expect(msg).toContain("matches_end");
    }
  });

  it("fail-loud: invalid matches_tail (negative)", () => {
    expect(() => call({ resultsViewport: { tail: 50 } }, { matches_tail: -5 })).toThrow(/matches_tail/);
  });

  it("fail-loud: matches_start without matches_end", () => {
    expect(() => call({ resultsViewport: { tail: 50 } }, { matches_start: 0 })).toThrow(/matches_start/);
  });

  it("fail-loud: matches_start > matches_end", () => {
    expect(() => call({ resultsViewport: { tail: 50 } }, { matches_start: 10, matches_end: 5 })).toThrow(/matches_start/);
  });

  it("no viewport args returns current viewport unchanged (no-op)", () => {
    const out = call({ resultsViewport: { tail: 50 } }, {});
    expect(out).toEqual({ resultsViewport: { tail: 50 } });
  });
});

// ─────────────────────────── set_results_window 挂在 search 的 window 声明上 ──

describe("set_results_window registered on search window class", () => {
  it("search readable window declares set_results_window in window_methods (not object_methods)", () => {
    const decl = searchReadable.window.find((w) => w.class === "search")!;
    expect(decl.window_methods.map((m) => m.name)).toContain("set_results_window");
    expect(decl.object_methods).not.toContain("set_results_window");
  });

  it("search Class has open_match/close as object methods", () => {
    expect(SearchClass.executable!.methods.map((m) => m.name)).toEqual(
      expect.arrayContaining(["open_match", "close"]),
    );
  });
});

// ─────────────────────────── open_match 不受 viewport 影响 ──────────

describe("open_match honors full matches array (not viewport-clipped)", () => {
  it("missing index returns input-prompt error (does not depend on viewport)", async () => {
    const openMatch = SearchClass.executable!.methods.find((m) => m.name === "open_match")!;
    const self = makeData(makeMatches(100));
    // tail=10 → visible 90..99；open_match 按全集 index 寻址，但本例只验证缺 index 的 guard。
    const out = await openMatch.exec(
      { thread: { contextWindows: [], events: [] }, runtime: undefined } as never,
      makeSelfProxy(self, "w_search", undefined),
      {},
    );
    expect(typeof out).toBe("string");
    expect(out as string).toContain("缺少 index");
  });
});
