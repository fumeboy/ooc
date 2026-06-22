import { describe, expect, test } from "bun:test";
import { computeActivations } from "../activator";
import type { ActivatesOn, KnowledgeDoc, KnowledgeIndex } from "@ooc/core/_shared/types/knowledge.js";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";
import { setSessionObject } from "@ooc/core/runtime/session-object-table.js";
import { KNOWLEDGE_CLASS_ID } from "@ooc/core/_shared/types/constants.js";

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

/**
 * B→A split：fixture 窗是对象引用（OocObjectRef，不持 data）；业务 data 经 session 对象表
 * 按 id 解析。`WinSpec` 把窗视角态 + 要登记进表的 data 一起携带；`thread()` 建表时登记。
 */
interface WinSpec {
  ref: ContextWindow;
  data: Record<string, unknown>;
}

/**
 * 构造 method_exec object 实例的辅助（B→A 对象引用形态）；activator 内部走 evaluateTrigger，
 * 读 `w.class === "method_exec"` + 表里 `data.method` + `w.parentWindowId`。
 * `method` / `parentWindowId` 经命名参数传入，落进对象表 `.data` / 窗元信息。
 */
function form(
  overrides: { id?: string; method?: string; parentWindowId?: string; status?: ContextWindow["status"] } = {},
): WinSpec {
  const { id = "f", method = "x", parentWindowId = "root", status = "open" } = overrides;
  return {
    ref: { id, class: "method_exec", parentWindowId, title: "x", status, createdAt: 0 },
    data: { method },
  };
}

function thread(overrides: Partial<ThreadContext> & { windows?: WinSpec[] }): ThreadContext {
  const { windows, ...rest } = overrides;
  const t: ThreadContext = {
    id: "t",
    status: "running",
    events: [],
    contextWindows: (windows ?? []).map((w) => w.ref),
    ...rest,
  };
  for (const w of windows ?? []) {
    setSessionObject(t, { id: w.ref.id, class: w.ref.class, data: w.data });
  }
  return t;
}

describe("computeActivations (trigger map)", () => {
  test("empty thread → no auto activations", () => {
    const out = computeActivations(
      thread({}),
      indexOf(doc("a", "A", { "method::root::program": "show_content" })),
    );
    expect(out).toEqual([]);
  });

  test("method trigger matches when form on root with same method exists → full", () => {
    const index = indexOf(doc("a", "A", { "method::root::program": "show_content" }));
    const out = computeActivations(
      thread({ windows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
    expect(out[0]?.reason).toBe("trigger_full");
  });

  test("method trigger matches → show_description level renders as summary", () => {
    const index = indexOf(doc("a", "A", { "method::root::program": "show_description" }));
    const out = computeActivations(
      thread({ windows: [form({ method: "program" })] }),
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
        "method::root::program": "show_content",
      }),
    );
    // 既有 root window（隐式由 contextWindows 中含 root window 模拟，但这里没显式塞 root window）
    // 让 program method trigger 命中即可
    const out = computeActivations(
      thread({ windows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
  });

  test("window trigger matches any open window of that type", () => {
    const index = indexOf(doc("a", "A", { "window::talk": "show_content" }));
    const talkWindow: WinSpec = {
      ref: { id: "w_talk", class: "talk", parentWindowId: "root", title: "talk", status: "open", createdAt: 0 },
      data: { target: "alice" },
    };
    const out = computeActivations(
      thread({ windows: [talkWindow] }),
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

  test("method trigger requires matching parent window type", () => {
    // method::talk::say should match form { method: "say", parent.class === "talk" }
    const index = indexOf(doc("a", "A", { "method::talk::say": "show_content" }));
    const talkWindow: WinSpec = {
      ref: { id: "w_talk", class: "talk", parentWindowId: "root", title: "talk", status: "open", createdAt: 0 },
      data: { target: "alice" },
    };
    const sayForm = form({ id: "f_say", method: "say", parentWindowId: "w_talk" });

    const out = computeActivations(
      thread({ windows: [talkWindow, sayForm] }),
      index,
    );
    expect(out).toHaveLength(1);

    // Same say form but parent is root → no match
    const sayOnRoot = form({ id: "f_say_root", method: "say", parentWindowId: "root" });
    const out2 = computeActivations(
      thread({ windows: [sayOnRoot] }),
      index,
    );
    expect(out2).toEqual([]);
  });

  test("doc without activates_on never auto-activates", () => {
    const index = indexOf(doc("a", "A", undefined));
    const out = computeActivations(
      thread({ windows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toEqual([]);
  });

  test("non-matching triggers produce no result", () => {
    const index = indexOf(doc("a", "A", { "method::root::talk": "show_content" }));
    const out = computeActivations(
      thread({ windows: [form({ method: "program" })] }),
      index,
    );
    expect(out).toEqual([]);
  });

  test("result count capped at MAX_RESULTS (20)", () => {
    const docs: KnowledgeDoc[] = [];
    for (let i = 0; i < 30; i++) {
      docs.push(doc(`k${i}`, `desc ${i}`, { "method::root::program": "show_content" }));
    }
    const out = computeActivations(
      thread({ windows: [form({ method: "program" })] }),
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
          "method::root::program": "show_description",
        } as unknown as ActivatesOn),
      );
      const out = computeActivations(
        thread({ windows: [form({ method: "program" })] }),
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
    const knWindow: WinSpec = {
      ref: { id: "kn_w_1", class: KNOWLEDGE_CLASS_ID, parentWindowId: "root", title: "a", status: "open", createdAt: 0 },
      data: { path: "a", source: "explicit", body: "doc body" },
    };
    const out = computeActivations(
      thread({ windows: [knWindow] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
    expect(out[0]?.reason).toBe("pinned");
  });
});
