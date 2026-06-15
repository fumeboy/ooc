/**
 * 单元 + 集成测试：search_window 的 matches viewport 协议（R1b）。
 *
 * 覆盖：
 * - render 默认 tail=50：matches ≤ 50 全展开；> 50 截到末 50 + earlier_omitted
 * - set_results_window 命令：matches_tail / matches_start+matches_end 切换、互斥、fail-loud
 * - render 时 <results_viewport> 元节点属性正确性
 * - open_match 按完整 matches 的 index 寻址，不受 viewport 截取影响
 */
import { describe, expect, it } from "bun:test";

import "@ooc/core/runtime/register-builtins.js";

import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import {
  ROOT_WINDOW_ID,
  type SearchMatch,
  type SearchWindow,
} from "@ooc/core/_shared/types/context-window.js";
import { serializeXml } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext } from "../../../thinkable/context.js";
import {
  DEFAULT_RESULTS_VIEWPORT,
  searchSetResultsViewport,
  hasAnyResultsViewportField,
} from "@ooc/builtins/filesystem/search/executable/results-viewport.js";

const NOW = 1_700_000_000_000;

function makeMatches(n: number): SearchMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    path: `src/file-${i}.ts`,
    line: i + 1,
    snippet: `match ${i}`,
  }));
}

function makeSearchWindow(opts: {
  id?: string;
  matches: SearchMatch[];
  resultsViewport?: SearchWindow["resultsViewport"];
}): SearchWindow {
  return {
    id: opts.id ?? "w_search_1",
    class: "search",
    parentWindowId: ROOT_WINDOW_ID,
    title: "grep test",
    status: "open",
    createdAt: NOW,
    kind: "grep",
    query: "foo",
    matches: opts.matches,
    truncated: false,
    searchRoot: "/tmp",
    state: opts.resultsViewport ? { resultsViewport: opts.resultsViewport } : undefined,
  };
}

function makeThread(window: SearchWindow): ThreadContext {
  return {
    id: "self",
    status: "running",
    events: [],
    contextWindows: [window],
    inbox: [],
    outbox: [],
  };
}

// ─────────────────────────── 单元: DEFAULT_RESULTS_VIEWPORT ─────────

describe("DEFAULT_RESULTS_VIEWPORT", () => {
  it("is { tail: 50 } and frozen", () => {
    expect(DEFAULT_RESULTS_VIEWPORT.tail).toBe(50);
    expect(Object.isFrozen(DEFAULT_RESULTS_VIEWPORT)).toBe(true);
  });
});

// ─────────────────────────── 单元: hasAnyResultsViewportField ───────

describe("hasAnyResultsViewportField", () => {
  it("detects matches_tail / matches_start / matches_end", () => {
    expect(hasAnyResultsViewportField({ matches_tail: 10 })).toBe(true);
    expect(hasAnyResultsViewportField({ matches_start: 0 })).toBe(true);
    expect(hasAnyResultsViewportField({ matches_end: 10 })).toBe(true);
  });

  it("does not trigger on unrelated keys", () => {
    expect(hasAnyResultsViewportField({})).toBe(false);
    expect(hasAnyResultsViewportField({ tail: 10 })).toBe(false);
    expect(hasAnyResultsViewportField({ index: 5 })).toBe(false);
  });
});

// ─────────────────────────── render: 默认 + 边界 ────────────────────

describe("search_window render: default tail=50", () => {
  it("matches ≤ 50: all visible, no earlier_omitted", async () => {
    const window = makeSearchWindow({
      matches: makeMatches(20),
      resultsViewport: { tail: 50 },
    });
    const thread = makeThread(window);
    const def = builtinRegistry.getObjectDefinition("search");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain("<results_viewport");
    expect(xml).toContain('total="20"');
    expect(xml).toContain('tail="50"');
    expect(xml).not.toContain("earlier_omitted");
    // all matches visible
    for (let i = 0; i < 20; i++) {
      expect(xml).toContain(`src/file-${i}.ts`);
    }
  });

  it("matches > 50: clips to last 50 + earlier_omitted", async () => {
    const window = makeSearchWindow({
      matches: makeMatches(120),
      resultsViewport: { tail: 50 },
    });
    const thread = makeThread(window);
    const def = builtinRegistry.getObjectDefinition("search");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="120"');
    expect(xml).toContain('tail="50"');
    expect(xml).toContain('earlier_omitted="70"');
    // first 70 (index 0..69) hidden
    for (let i = 0; i < 70; i++) {
      // path="src/file-{i}.ts" only appears in <match path="..."> - check no full match shown
      expect(xml).not.toContain(`path="src/file-${i}.ts"`);
    }
    // last 50 visible
    for (let i = 70; i < 120; i++) {
      expect(xml).toContain(`path="src/file-${i}.ts"`);
    }
  });

  it("uses DEFAULT_RESULTS_VIEWPORT when window has no resultsViewport (legacy)", async () => {
    const window = makeSearchWindow({
      matches: makeMatches(60),
      // no resultsViewport
    });
    const thread = makeThread(window);
    const def = builtinRegistry.getObjectDefinition("search");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('tail="50"');
    expect(xml).toContain('earlier_omitted="10"');
  });
});

describe("search_window render: range mode", () => {
  it("renders [matches_start, matches_end) and exposes range attrs", async () => {
    const window = makeSearchWindow({
      matches: makeMatches(20),
      resultsViewport: { rangeStart: 5, rangeEnd: 10 },
    });
    const thread = makeThread(window);
    const def = builtinRegistry.getObjectDefinition("search");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('matches_start="5"');
    expect(xml).toContain('matches_end="10"');
    expect(xml).toContain('total="20"');
    expect(xml).toContain('earlier_omitted="5"');
    // visible 5..9
    for (let i = 5; i < 10; i++) {
      expect(xml).toContain(`path="src/file-${i}.ts"`);
    }
    expect(xml).not.toContain(`path="src/file-4.ts"`);
    expect(xml).not.toContain(`path="src/file-10.ts"`);
  });
});

describe("search_window render: matches.count reflects full total (not visible)", () => {
  it("count attribute is total matches.length, NOT visible.length", async () => {
    const window = makeSearchWindow({
      matches: makeMatches(100),
      resultsViewport: { tail: 10 },
    });
    const thread = makeThread(window);
    const def = builtinRegistry.getObjectDefinition("search");
    const nodes = await def.readable!({ thread, window });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    // matches.count = 100 (全集)；results_viewport.total = 100；
    // visible 末 10 个：90..99
    expect(xml).toContain('<matches count="100"');
    expect(xml).toContain('total="100"');
  });
});

// ─────────────────────────── method: set_results_window ────────────

describe("set_results_window window method", () => {
  it("matches_tail returns new state with resultsViewport", () => {
    const out = searchSetResultsViewport({
      args: { matches_tail: 100 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.state.resultsViewport).toEqual({ tail: 100 });
  });

  it("range mode replaces tail", () => {
    const out = searchSetResultsViewport({
      args: { matches_start: 0, matches_end: 5 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.state.resultsViewport).toEqual({ rangeStart: 0, rangeEnd: 5 });
  });

  it("does not mutate input windowState", () => {
    const windowState = { resultsViewport: { tail: 50 } };
    searchSetResultsViewport({ args: { matches_tail: 100 }, windowState } as any);
    expect(windowState.resultsViewport).toEqual({ tail: 50 });
  });

  it("fail-loud: matches_tail + matches_start mutually exclusive", () => {
    const out = searchSetResultsViewport({
      args: { matches_tail: 10, matches_start: 0, matches_end: 5 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("互斥");
      // 错误信息应用 matches_* 命名（不暴露内部 tail / range_*）
      expect(out.error).toContain("matches_tail");
      expect(out.error).toContain("matches_start");
      expect(out.error).toContain("matches_end");
    }
  });

  it("fail-loud: invalid matches_tail (negative)", () => {
    const out = searchSetResultsViewport({
      args: { matches_tail: -5 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("matches_tail");
  });

  it("fail-loud: matches_start without matches_end", () => {
    const out = searchSetResultsViewport({
      args: { matches_start: 0 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("matches_start");
      expect(out.error).toContain("matches_end");
    }
  });

  it("fail-loud: matches_start > matches_end", () => {
    const out = searchSetResultsViewport({
      args: { matches_start: 10, matches_end: 5 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("matches_start");
  });

  it("no viewport args returns ok with helpful result text", () => {
    const out = searchSetResultsViewport({
      args: {},
      windowState: {},
    } as any);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result).toContain("至少需要");
  });
});

// ─────────────────────────── windowMethod registered on search type ──

describe("set_results_window registered as windowMethod on search", () => {
  it("search definition has set_results_window in windowMethods (not methods)", () => {
    const def = builtinRegistry.getObjectDefinition("search");
    expect(def.windowMethods?.["set_results_window"]).toBeDefined();
    expect(def.methods["set_results_window"]).toBeUndefined();
  });

  it("registered windowMethod executes returning new state", () => {
    const def = builtinRegistry.getObjectDefinition("search");
    const cmd = def.windowMethods!["set_results_window"]!;
    const out = cmd.exec({
      args: { matches_tail: 25 },
      windowState: { resultsViewport: { tail: 50 } },
    } as any) as any;
    expect(out.ok).toBe(true);
    expect(out.state.resultsViewport).toEqual({ tail: 25 });
  });
});

// ─────────────────────────── open_match 不受 viewport 影响 ──────────

describe("open_match honors full matches array (not viewport-clipped)", () => {
  it("can open a match whose index is outside visible viewport tail", async () => {
    const def = builtinRegistry.getObjectDefinition("search");
    const cmd = def.methods["open_match"]!;
    // 100 matches, tail=10 → visible 90..99；但 open_match(index=5) 仍应工作
    const window = makeSearchWindow({
      matches: makeMatches(100),
      resultsViewport: { tail: 10 },
    });
    const thread = makeThread(window);
    const out = await cmd.exec({
      args: { index: 5 },
      self: window,
      thread,
    });
    expect(out).toBeUndefined();
    // file_window 已挂上
    const fileWin = thread.contextWindows.find((w) => w.class === "file");
    expect(fileWin).toBeDefined();
  });
});
