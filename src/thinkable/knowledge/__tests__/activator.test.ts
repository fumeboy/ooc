import { describe, expect, test } from "bun:test";
import { computeActivations } from "../activator";
import type { ActivatesOn, KnowledgeDoc, KnowledgeIndex } from "../types";
import type { ThreadContext } from "../../context";
import type { CommandExecWindow, ContextWindow } from "../../../executable/windows/_shared/types";

function doc(
  path: string,
  description: string,
  activates_on: ActivatesOn | undefined,
  body = `body of ${path}`,
): KnowledgeDoc {
  return {
    path,
    file: `/tmp/${path}.md`,
    frontmatter: { description, activates_on },
    body,
    mtime: 0,
  };
}

function indexOf(...docs: KnowledgeDoc[]): KnowledgeIndex {
  return { byPath: new Map(docs.map((d) => [d.path, d])) };
}

/** 构造 command_exec window 的辅助；activator 内部走 evaluateTrigger，需 parentWindowId + method 字段。 */
function form(overrides: Partial<CommandExecWindow>): CommandExecWindow {
  return {
    id: "f",
    type: "command_exec",
    parentWindowId: "root",
    title: "x",
    status: "open",
    createdAt: 0,
    method: "x",
    description: "",
    accumulatedArgs: {},
    commandPaths: [],
    loadedKnowledgePaths: [],
    ...overrides,
  };
}

function thread(overrides: Partial<ThreadContext>): ThreadContext {
  return {
    id: "t",
    status: "running",
    events: [],
    contextWindows: [],
    ...overrides,
  };
}

describe("computeActivations (trigger map)", () => {
  test("empty thread → no auto activations", () => {
    const out = computeActivations(
      thread({}),
      indexOf(doc("a", "A", { "command::root::program": "show_content" })),
    );
    expect(out).toEqual([]);
  });

  test("command trigger matches when form on root with same command exists → full", () => {
    const index = indexOf(doc("a", "A", { "command::root::program": "show_content" }));
    const out = computeActivations(
      thread({ contextWindows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
    expect(out[0]?.reason).toBe("trigger_full");
  });

  test("command trigger matches → show_description level renders as summary", () => {
    const index = indexOf(doc("a", "A", { "command::root::program": "show_description" }));
    const out = computeActivations(
      thread({ contextWindows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("summary");
    expect(out[0]?.reason).toBe("trigger_summary");
  });

  test("multiple triggers hit → max level wins (show_content beats show_description)", () => {
    const index = indexOf(
      doc("a", "A", {
        "window::root": "show_description",
        "command::root::program": "show_content",
      }),
    );
    // 既有 root window（隐式由 contextWindows 中含 root window 模拟，但这里没显式塞 root window）
    // 让 program command trigger 命中即可
    const out = computeActivations(
      thread({ contextWindows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
  });

  test("window trigger matches any open window of that type", () => {
    const index = indexOf(doc("a", "A", { "window::talk": "show_content" }));
    const talkWindow: ContextWindow = {
      id: "w_talk",
      type: "talk",
      parentWindowId: "root",
      title: "talk",
      status: "open",
      createdAt: 0,
      target: "alice",
    } as ContextWindow;
    const out = computeActivations(
      thread({ contextWindows: [talkWindow] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
  });

  test("super trigger matches only when sessionId === 'super'", () => {
    const index = indexOf(doc("a", "A", { super: "show_content" }));

    const normal = computeActivations(
      thread({
        persistence: { baseDir: "/tmp", sessionId: "web", objectId: "agent", threadId: "t" },
      }),
      index,
    );
    expect(normal).toEqual([]);

    const inSuper = computeActivations(
      thread({
        persistence: { baseDir: "/tmp", sessionId: "super", objectId: "agent", threadId: "t" },
      }),
      index,
    );
    expect(inSuper).toHaveLength(1);
    expect(inSuper[0]?.presentation).toBe("full");
  });

  test("command trigger requires matching parent window type", () => {
    // command::talk::say should match form { command: "say", parent.type === "talk" }
    const index = indexOf(doc("a", "A", { "command::talk::say": "show_content" }));
    const talkWindow: ContextWindow = {
      id: "w_talk",
      type: "talk",
      parentWindowId: "root",
      title: "talk",
      status: "open",
      createdAt: 0,
      target: "alice",
    } as ContextWindow;
    const sayForm = form({ id: "f_say", method: "say", parentWindowId: "w_talk" });

    const out = computeActivations(
      thread({ contextWindows: [talkWindow, sayForm] }),
      index,
    );
    expect(out).toHaveLength(1);

    // Same say form but parent is root → no match
    const sayOnRoot = form({ id: "f_say_root", method: "say", parentWindowId: "root" });
    const out2 = computeActivations(
      thread({ contextWindows: [sayOnRoot] }),
      index,
    );
    expect(out2).toEqual([]);
  });

  test("doc without activates_on never auto-activates", () => {
    const index = indexOf(doc("a", "A", undefined));
    const out = computeActivations(
      thread({ contextWindows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toEqual([]);
  });

  test("non-matching triggers produce no result", () => {
    const index = indexOf(doc("a", "A", { "command::root::talk": "show_content" }));
    const out = computeActivations(
      thread({ contextWindows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toEqual([]);
  });

  test("result count capped at MAX_RESULTS (20)", () => {
    const docs: KnowledgeDoc[] = [];
    for (let i = 0; i < 30; i++) {
      docs.push(doc(`k${i}`, `desc ${i}`, { "command::root::program": "show_content" }));
    }
    const out = computeActivations(
      thread({ contextWindows: [form({ method: "program" })] }),
      indexOf(...docs),
    );
    expect(out.length).toBe(20);
  });

  test("unknown trigger expression in activates_on → warn + skip that entry, others still evaluate", () => {
    const origWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(" "));
    };
    try {
      // bad-trigger 解析失败；good-trigger 仍命中
      const index = indexOf(
        doc("a", "A", {
          "totally::bogus::trigger": "show_content",
          "command::root::program": "show_description",
        } as unknown as ActivatesOn),
      );
      const out = computeActivations(
        thread({ contextWindows: [form({ method: "program" })] }),
        index,
      );
      expect(out).toHaveLength(1);
      expect(out[0]?.presentation).toBe("summary");
      expect(warnings.some((w) => w.includes("totally::bogus::trigger"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  test("explicit knowledge_window forces full regardless of activates_on", () => {
    const index = indexOf(doc("a", "A", undefined));
    const knWindow: ContextWindow = {
      id: "kn_w_1",
      type: "knowledge",
      parentWindowId: "root",
      title: "a",
      status: "open",
      createdAt: 0,
      path: "a",
      source: "explicit",
      body: "doc body",
    } as ContextWindow;
    const out = computeActivations(
      thread({ contextWindows: [knWindow] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
    expect(out[0]?.reason).toBe("pinned");
  });
});
