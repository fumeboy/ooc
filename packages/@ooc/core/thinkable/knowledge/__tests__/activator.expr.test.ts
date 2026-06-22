import { describe, expect, test } from "bun:test";
import {
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  parseTrigger,
} from "../activator.expr";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";
import { setSessionObject } from "@ooc/core/runtime/session-object-table.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";

/**
 * B→A split：fixture 窗是对象引用（OocObjectRef，不持 data）；业务 data 经 session 对象表
 * 按 id 解析。`WinSpec` 携带窗视角态 + 要登记进表的 data；`thread()` 建表时登记。
 */
interface WinSpec {
  ref: ContextWindow;
  data: Record<string, unknown>;
}

function thread(overrides: (Partial<ThreadContext> & { windows?: WinSpec[] }) = {}): ThreadContext {
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

/**
 * 构造 method_exec object 实例的辅助（B→A 对象引用形态）；evaluateTrigger 读
 * `w.class === "method_exec"` + 表里 `data.method` + `w.parentWindowId`。
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

describe("parseTrigger", () => {
  // ── 新格式 ───────────────────────
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

  test("command:: is no longer supported (use method:: instead)", () => {
    expect(() => parseTrigger("command::root::talk")).toThrow(/Unknown trigger/);
    expect(() => parseTrigger("command::talk::say")).toThrow(/Unknown trigger/);
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

  test("rejects command:: (no longer supported)", () => {
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

  test("legacy window:: format auto-maps to new AST kinds", () => {
    const out = parseActivatesOn(
      {
        "window::root": "show_description",
        "method::root::talk": "show_content",
      },
      "legacy.md",
    );
    expect(out).toHaveLength(2);
    // expr keeps original string for diagnostics, but AST uses new kind names
    const windowEntry = out.find((e) => e.expr === "window::root")!;
    const methodEntry = out.find((e) => e.expr === "method::root::talk")!;
    expect(windowEntry.trigger.kind).toBe("object");
    expect((windowEntry.trigger as any).objectType).toBe("root");
    expect(methodEntry.trigger.kind).toBe("method");
    expect((methodEntry.trigger as any).objectType).toBe("root");
    expect((methodEntry.trigger as any).method).toBe("talk");
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
    const talkW: WinSpec = {
      ref: { id: "w1", class: "talk", parentWindowId: "root", title: "t", status: "open", createdAt: 0 },
      data: { target: "alice" },
    };
    expect(evaluateTrigger(t, thread({ windows: [talkW] }))).toBe(true);

    // closed talk window does NOT count
    const closed: WinSpec = { ref: { ...talkW.ref, status: "closed" }, data: talkW.data };
    expect(evaluateTrigger(t, thread({ windows: [closed] }))).toBe(false);
  });

  // ── window:: 旧格式（向后兼容,parse 阶段已映射为 object kind） ──
  test("window::talk (legacy) also hits via auto-map", () => {
    const t = parseTrigger("window::talk");
    expect(t.kind).toBe("object"); // 已归一化
    const talkW: WinSpec = {
      ref: { id: "w1", class: "talk", parentWindowId: "root", title: "t", status: "open", createdAt: 0 },
      data: { target: "alice" },
    };
    expect(evaluateTrigger(t, thread({ windows: [talkW] }))).toBe(true);
  });

  // ── window::root = always-on ──
  test("window::root always hits（root 是隐式父，从不进 contextWindows；契约文档化为『任何时候』）", () => {
    const t = parseTrigger("window::root");
    expect(t).toEqual({ kind: "object", objectType: "root" });
    // 空 contextWindows（无 type:root window）也命中——否则 sediment 的 memory 永不召回
    expect(evaluateTrigger(t, thread())).toBe(true);
    expect(evaluateTrigger(t, thread({ windows: [] }))).toBe(true);
    // 有其它 window 时同样命中
    const todoW: WinSpec = {
      ref: { id: "w_t", class: "todo", parentWindowId: "root", title: "x", status: "open", createdAt: 0 },
      data: {},
    };
    expect(evaluateTrigger(t, thread({ windows: [todoW] }))).toBe(true);
  });

  // ── object_id:: 新格式 ──────────────────────────────────────────
  test("object_id::agent_alice hits when window with id=agent_alice is open", () => {
    const t = parseTrigger("object_id::agent_alice");
    const objW: WinSpec = {
      ref: { id: "agent_alice", class: "agent_alice", parentWindowId: "root", title: "Agent Alice", status: "open", createdAt: 0 },
      data: {},
    };
    expect(evaluateTrigger(t, thread({ windows: [objW] }))).toBe(true);

    // 其他 objectId 不命中
    const otherW: WinSpec = { ref: { ...objW.ref, id: "agent_bob" }, data: {} };
    expect(evaluateTrigger(t, thread({ windows: [otherW] }))).toBe(false);

    // closed 不算
    const closed: WinSpec = { ref: { ...objW.ref, status: "closed" }, data: {} };
    expect(evaluateTrigger(t, thread({ windows: [closed] }))).toBe(false);
  });

  // ── method:: 新格式 ─────────────────────────────────────────────
  test("method::root::program hits when form on root with command=program is open", () => {
    const t = parseTrigger("method::root::program");
    const f = form({ method: "program", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ windows: [f] }))).toBe(true);

    // wrong command
    const otherForm = form({ method: "talk", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ windows: [otherForm] }))).toBe(false);

    // failed form does not count as active
    const failedForm = form({ method: "program", parentWindowId: "root", status: "failed" });
    expect(evaluateTrigger(t, thread({ windows: [failedForm] }))).toBe(false);
  });

  test("method::talk::say requires parent window type === 'talk'", () => {
    const t = parseTrigger("method::talk::say");
    const talkW: WinSpec = {
      ref: { id: "wt", class: "talk", parentWindowId: "root", title: "t", status: "open", createdAt: 0 },
      data: { target: "alice" },
    };
    const sayOnTalk = form({ id: "fs1", method: "say", parentWindowId: "wt" });
    expect(evaluateTrigger(t, thread({ windows: [talkW, sayOnTalk] }))).toBe(true);

    const sayOnRoot = form({ id: "fs2", method: "say", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ windows: [sayOnRoot] }))).toBe(false);
  });

  // ── phase 2：填表式渐进执行的知识激活对接 ──
  test("method::<targetClass>::<m>：form 的 data.targetObjectId 指向目标对象，解析其 class 命中", () => {
    const t = parseTrigger("method::todo::save");
    const target: WinSpec = {
      ref: { id: "note1", class: "todo", title: "n", status: "open", createdAt: 0 },
      data: {},
    };
    const f: WinSpec = {
      ref: { id: "f1", class: "method_exec", title: "f", status: "open", createdAt: 0 },
      data: { method: "save", targetObjectId: "note1" },
    };
    expect(evaluateTrigger(t, thread({ windows: [target, f] }))).toBe(true);

    // 目标类不匹配 → 不命中
    const t2 = parseTrigger("method::file::save");
    expect(evaluateTrigger(t2, thread({ windows: [target, f] }))).toBe(false);
  });

  test("intent::<name>：open form 的 data.intentPaths 含该 intent 命中（不再读死的 intentCache）", () => {
    const t = parseTrigger("intent::create");
    const f: WinSpec = {
      ref: { id: "f1", class: "method_exec", title: "f", status: "open", createdAt: 0 },
      data: { method: "save", targetObjectId: "note1", intentPaths: ["create"] },
    };
    expect(evaluateTrigger(t, thread({ windows: [f] }))).toBe(true);

    // failed form 不算活跃
    const failed: WinSpec = { ref: { ...f.ref, status: "failed" }, data: f.data };
    expect(evaluateTrigger(t, thread({ windows: [failed] }))).toBe(false);

    // 不含该 intent 不命中
    const other: WinSpec = { ref: { ...f.ref }, data: { method: "save", targetObjectId: "note1", intentPaths: ["update"] } };
    expect(evaluateTrigger(t, thread({ windows: [other] }))).toBe(false);
  });

  // ── method:: triggers correctly evaluate ──
  test("method::root::program hits when form on root with method=program is open", () => {
    const t = parseTrigger("method::root::program");
    expect(t.kind).toBe("method");
    const f = form({ method: "program", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ windows: [f] }))).toBe(true);
  });

  // ── method:: 单跳 parentClass 匹配 ──
  // evaluateTrigger 对 form 的 parentType 做一次单跳 parentClass 检查（resolveParentClassChain 单跳）。
  // 注册一个 parentClass=runtime 的子类，验证：子类自身精确命中 + 其单一父类 runtime 命中，
  // 且非祖先类型不误伤。
  test("method:: 单跳父类匹配：form 跑在子类自窗上，自身与单一父类的 trigger 命中、旁系不命中", () => {
    const childType = `__test_child_${Date.now()}`;
    // 单跳链：childType → runtime（runtime 是其唯一 parentClass）
    builtinRegistry.register(childType, { executable: { methods: [] } }, { parentClass: "runtime" });
    const selfWin: WinSpec = {
      ref: { id: "self", class: childType, parentWindowId: "root", title: "self", status: "open", createdAt: 0 },
      data: {},
    };
    const callForm = form({ id: "fcall", method: "talk", parentWindowId: "self" });
    const ctx = thread({ windows: [selfWin, callForm] });

    // 自身类型精确命中
    expect(evaluateTrigger(parseTrigger(`method::${childType}::talk`), ctx)).toBe(true);
    // 单一父类 runtime 命中（单跳）
    expect(evaluateTrigger(parseTrigger("method::runtime::talk"), ctx)).toBe(true);
    // 旁系类型（filesystem 非其父类）不命中
    expect(evaluateTrigger(parseTrigger("method::filesystem::talk"), ctx)).toBe(false);
  });

  test("method:: 单跳不误伤：create_object 跑在 runtime 成员窗（parentClass=null），仅 runtime 精确命中", () => {
    const runtimeWin: WinSpec = {
      ref: { id: "runtime", class: "runtime", parentWindowId: "root", title: "runtime", status: "open", createdAt: 0 },
      data: {},
    };
    const createForm = form({ id: "fco", method: "create_object", parentWindowId: "runtime" });
    const ctx = thread({ windows: [runtimeWin, createForm] });
    expect(evaluateTrigger(parseTrigger("method::runtime::create_object"), ctx)).toBe(true);
    // runtime parentClass=null → root 非其祖先 → 旧 `method::root::create_object` 不再命中
    expect(evaluateTrigger(parseTrigger("method::root::create_object"), ctx)).toBe(false);
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
