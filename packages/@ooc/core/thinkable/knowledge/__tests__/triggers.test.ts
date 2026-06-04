import { describe, expect, test } from "bun:test";
import {
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  parseTrigger,
} from "../triggers";
import type { ThreadContext } from "../../context";
import {
  MethodExecWindow,
  ContextWindow,
} from "../../../executable/windows/_shared/types";

function thread(overrides: Partial<ThreadContext> = {}): ThreadContext {
  return {
    id: "t",
    status: "running",
    events: [],
    contextWindows: [],
    ...overrides,
  };
}

function form(overrides: Partial<MethodExecWindow>): MethodExecWindow {
  return {
    id: "f",
    type: "method_exec",
    parentWindowId: "root",
    title: "x",
    status: "open",
    createdAt: 0,
    command: "x",
    description: "",
    accumulatedArgs: {},
    commandPaths: [],
    loadedKnowledgePaths: [],
    ...overrides,
  };
}

describe("parseTrigger", () => {
  // ── 新格式（2026-05-28 ooc-6 Object Unification） ───────────────────────
  test("object::<type>", () => {
    expect(parseTrigger("object::root")).toEqual({ kind: "object", objectType: "root" });
    expect(parseTrigger("object::talk")).toEqual({ kind: "object", objectType: "talk" });
    expect(parseTrigger("object::do")).toEqual({ kind: "object", objectType: "do" });
  });

  test("method::<object_type>::<method>", () => {
    expect(parseTrigger("method::root::talk")).toEqual({
      kind: "method",
      objectType: "root",
      method: "talk",
    });
    expect(parseTrigger("method::talk::say")).toEqual({
      kind: "method",
      objectType: "talk",
      method: "say",
    });
  });

  test("object_id::<id>", () => {
    expect(parseTrigger("object_id::agent_alice")).toEqual({
      kind: "objectId",
      objectId: "agent_alice",
    });
    expect(parseTrigger("object_id::sentry_factor_dev")).toEqual({
      kind: "objectId",
      objectId: "sentry_factor_dev",
    });
  });

  test("rejects malformed object::", () => {
    expect(() => parseTrigger("object::")).toThrow();
    expect(() => parseTrigger("object::foo::bar")).toThrow();
  });

  test("rejects malformed method::", () => {
    expect(() => parseTrigger("method::")).toThrow();
    expect(() => parseTrigger("method::root")).toThrow();
    expect(() => parseTrigger("method::root::")).toThrow();
    expect(() => parseTrigger("method::::talk")).toThrow();
  });

  test("rejects malformed object_id::", () => {
    expect(() => parseTrigger("object_id::")).toThrow();
    expect(() => parseTrigger("object_id::foo::bar")).toThrow();
  });

  // ── 旧格式（向后兼容,自动映射为新 kind） ──────────────────────────────
  test("window::<type> (legacy) maps to object kind", () => {
    expect(parseTrigger("window::root")).toEqual({ kind: "object", objectType: "root" });
    expect(parseTrigger("window::talk")).toEqual({ kind: "object", objectType: "talk" });
    expect(parseTrigger("window::do")).toEqual({ kind: "object", objectType: "do" });
  });

  test("command::<window_type>::<command> (legacy) maps to method kind", () => {
    expect(parseTrigger("command::root::talk")).toEqual({
      kind: "method",
      objectType: "root",
      method: "talk",
    });
    expect(parseTrigger("command::talk::say")).toEqual({
      kind: "method",
      objectType: "talk",
      method: "say",
    });
  });

  test("super", () => {
    expect(parseTrigger("super")).toEqual({ kind: "super" });
  });

  test("rejects empty string", () => {
    expect(() => parseTrigger("")).toThrow();
  });

  test("rejects legacy bare path forms (root, talk, program.shell)", () => {
    expect(() => parseTrigger("root")).toThrow(/Unknown trigger/);
    expect(() => parseTrigger("talk")).toThrow(/Unknown trigger/);
    expect(() => parseTrigger("program.shell")).toThrow(/Unknown trigger/);
  });

  test("rejects malformed window:: (legacy)", () => {
    expect(() => parseTrigger("window::")).toThrow();
    expect(() => parseTrigger("window::foo::bar")).toThrow();
  });

  test("rejects malformed command:: (legacy)", () => {
    expect(() => parseTrigger("command::")).toThrow();
    expect(() => parseTrigger("command::root")).toThrow();
    expect(() => parseTrigger("command::root::")).toThrow();
    expect(() => parseTrigger("command::::talk")).toThrow();
  });
});

describe("parseActivatesOn", () => {
  test("empty / undefined → []", () => {
    expect(parseActivatesOn(undefined, "x.md")).toEqual([]);
    expect(parseActivatesOn(null, "x.md")).toEqual([]);
  });

  test("valid map parses every entry (new format)", () => {
    const out = parseActivatesOn(
      {
        "object::root": "show_description",
        "method::root::talk": "show_content",
        "object_id::agent_alice": "show_description",
        super: "show_content",
      },
      "x.md",
    );
    expect(out).toHaveLength(4);
    expect(out.map((e) => e.expr).sort()).toEqual([
      "method::root::talk",
      "object::root",
      "object_id::agent_alice",
      "super",
    ]);
    // AST kinds are normalized to new format
    expect(out.map((e) => e.trigger.kind).sort()).toEqual([
      "method",
      "object",
      "objectId",
      "super",
    ]);
  });

  test("legacy window::/command:: formats auto-map to new AST kinds", () => {
    const out = parseActivatesOn(
      {
        "window::root": "show_description",
        "command::root::talk": "show_content",
      },
      "legacy.md",
    );
    expect(out).toHaveLength(2);
    // expr keeps original string for diagnostics, but AST uses new kind names
    const windowEntry = out.find((e) => e.expr === "window::root")!;
    const commandEntry = out.find((e) => e.expr === "command::root::talk")!;
    expect(windowEntry.trigger.kind).toBe("object");
    expect((windowEntry.trigger as any).objectType).toBe("root");
    expect(commandEntry.trigger.kind).toBe("method");
    expect((commandEntry.trigger as any).objectType).toBe("root");
    expect((commandEntry.trigger as any).method).toBe("talk");
  });

  test("legacy show_description_when key fails loud with migration hint", () => {
    expect(() =>
      parseActivatesOn(
        { show_description_when: ["root"] } as unknown as Record<string, unknown>,
        "old.md",
      ),
    ).toThrow(/legacy schema/);
  });

  test("legacy show_content_when key fails loud", () => {
    expect(() =>
      parseActivatesOn(
        { show_content_when: ["program"] } as unknown as Record<string, unknown>,
        "old.md",
      ),
    ).toThrow(/legacy schema/);
  });

  test("invalid level value fails loud", () => {
    expect(() =>
      parseActivatesOn(
        { "object::root": "always" } as unknown as Record<string, unknown>,
        "x.md",
      ),
    ).toThrow(/show_description.*show_content/);
  });

  test("array activates_on fails loud", () => {
    expect(() =>
      parseActivatesOn(["root"] as unknown as Record<string, unknown>, "x.md"),
    ).toThrow(/object map/);
  });
});

describe("evaluateTrigger", () => {
  test("super hits only in super session", () => {
    const t = parseTrigger("super");
    expect(evaluateTrigger(t, thread())).toBe(false);
    expect(
      evaluateTrigger(
        t,
        thread({
          persistence: {
            baseDir: "/tmp",
            sessionId: "super",
            objectId: "a",
            threadId: "t",
          },
        }),
      ),
    ).toBe(true);
    expect(
      evaluateTrigger(
        t,
        thread({
          persistence: {
            baseDir: "/tmp",
            sessionId: "web",
            objectId: "a",
            threadId: "t",
          },
        }),
      ),
    ).toBe(false);
  });

  // ── object:: 新格式 ──────────────────────────────────────────────
  test("object::talk hits when any open talk window exists", () => {
    const t = parseTrigger("object::talk");
    const talkW: ContextWindow = {
      id: "w1",
      type: "talk",
      parentWindowId: "root",
      title: "t",
      status: "open",
      createdAt: 0,
      target: "alice",
    } as ContextWindow;
    expect(evaluateTrigger(t, thread({ contextWindows: [talkW] }))).toBe(true);

    // closed talk window does NOT count
    const closed: ContextWindow = { ...talkW, status: "closed" } as ContextWindow;
    expect(evaluateTrigger(t, thread({ contextWindows: [closed] }))).toBe(false);
  });

  // ── window:: 旧格式（向后兼容,parse 阶段已映射为 object kind） ──
  test("window::talk (legacy) also hits via auto-map", () => {
    const t = parseTrigger("window::talk");
    expect(t.kind).toBe("object"); // 已归一化
    const talkW: ContextWindow = {
      id: "w1",
      type: "talk",
      parentWindowId: "root",
      title: "t",
      status: "open",
      createdAt: 0,
      target: "alice",
    } as ContextWindow;
    expect(evaluateTrigger(t, thread({ contextWindows: [talkW] }))).toBe(true);
  });

  // ── object_id:: 新格式 ──────────────────────────────────────────
  test("object_id::agent_alice hits when window with id=agent_alice is open (ooc-6 design)", () => {
    const t = parseTrigger("object_id::agent_alice");
    const objW: ContextWindow = {
      id: "agent_alice",
      type: "agent_alice" as any,
      parentWindowId: "root",
      title: "Agent Alice",
      status: "open",
      createdAt: 0,
    } as ContextWindow;
    expect(evaluateTrigger(t, thread({ contextWindows: [objW] }))).toBe(true);

    // 其他 objectId 不命中
    const otherW: ContextWindow = {
      ...objW,
      id: "agent_bob",
    } as ContextWindow;
    expect(evaluateTrigger(t, thread({ contextWindows: [otherW] }))).toBe(false);

    // closed 不算
    const closed: ContextWindow = { ...objW, status: "closed" } as ContextWindow;
    expect(evaluateTrigger(t, thread({ contextWindows: [closed] }))).toBe(false);
  });

  // ── method:: 新格式 ─────────────────────────────────────────────
  test("method::root::program hits when form on root with command=program is open", () => {
    const t = parseTrigger("method::root::program");
    const f = form({ command: "program", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [f] }))).toBe(true);

    // wrong command
    const otherForm = form({ command: "talk", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [otherForm] }))).toBe(false);

    // failed form does not count as active
    const failedForm = form({ command: "program", parentWindowId: "root", status: "failed" });
    expect(evaluateTrigger(t, thread({ contextWindows: [failedForm] }))).toBe(false);
  });

  test("method::talk::say requires parent window type === 'talk'", () => {
    const t = parseTrigger("method::talk::say");
    const talkW: ContextWindow = {
      id: "wt",
      type: "talk",
      parentWindowId: "root",
      title: "t",
      status: "open",
      createdAt: 0,
      target: "alice",
    } as ContextWindow;
    const sayOnTalk = form({ id: "fs1", command: "say", parentWindowId: "wt" });
    expect(evaluateTrigger(t, thread({ contextWindows: [talkW, sayOnTalk] }))).toBe(true);

    const sayOnRoot = form({ id: "fs2", command: "say", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [sayOnRoot] }))).toBe(false);
  });

  // ── command:: 旧格式（向后兼容,parse 阶段已映射为 method kind） ──
  test("command::root::program (legacy) also hits via auto-map", () => {
    const t = parseTrigger("command::root::program");
    expect(t.kind).toBe("method"); // 已归一化
    const f = form({ command: "program", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [f] }))).toBe(true);
  });
});

describe("maxLevel", () => {
  test("empty → undefined", () => {
    expect(maxLevel([])).toBeUndefined();
  });
  test("only show_description → show_description", () => {
    expect(maxLevel(["show_description"])).toBe("show_description");
  });
  test("mixed → show_content wins", () => {
    expect(maxLevel(["show_description", "show_content"])).toBe("show_content");
    expect(maxLevel(["show_content", "show_description"])).toBe("show_content");
  });
});
