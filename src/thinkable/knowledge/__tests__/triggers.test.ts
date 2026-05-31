import { describe, expect, test } from "bun:test";
import {
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  parseTrigger,
} from "../triggers";
import type { ThreadContext } from "../../context";
import type {
  CommandExecWindow,
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

describe("parseTrigger", () => {
  test("window::<type>", () => {
    expect(parseTrigger("window::root")).toEqual({ kind: "window", windowType: "root" });
    expect(parseTrigger("window::talk")).toEqual({ kind: "window", windowType: "talk" });
    expect(parseTrigger("window::do")).toEqual({ kind: "window", windowType: "do" });
  });

  test("command::<window_type>::<command>", () => {
    expect(parseTrigger("command::root::talk")).toEqual({
      kind: "command",
      windowType: "root",
      command: "talk",
    });
    expect(parseTrigger("command::talk::say")).toEqual({
      kind: "command",
      windowType: "talk",
      command: "say",
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

  test("rejects malformed window::", () => {
    expect(() => parseTrigger("window::")).toThrow();
    expect(() => parseTrigger("window::foo::bar")).toThrow();
  });

  test("rejects malformed command::", () => {
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

  test("valid map parses every entry", () => {
    const out = parseActivatesOn(
      {
        "window::root": "show_description",
        "command::root::talk": "show_content",
        super: "show_content",
      },
      "x.md",
    );
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.expr).sort()).toEqual([
      "command::root::talk",
      "super",
      "window::root",
    ]);
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
        { "window::root": "always" } as unknown as Record<string, unknown>,
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

  test("window::talk hits when any open talk window exists", () => {
    const t = parseTrigger("window::talk");
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

  test("command::root::program hits when form on root with command=program is open", () => {
    const t = parseTrigger("command::root::program");
    const f = form({ method: "program", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [f] }))).toBe(true);

    // wrong command
    const otherForm = form({ method: "talk", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [otherForm] }))).toBe(false);

    // failed form does not count as active
    const failedForm = form({ method: "program", parentWindowId: "root", status: "failed" });
    expect(evaluateTrigger(t, thread({ contextWindows: [failedForm] }))).toBe(false);
  });

  test("command::talk::say requires parent window type === 'talk'", () => {
    const t = parseTrigger("command::talk::say");
    const talkW: ContextWindow = {
      id: "wt",
      type: "talk",
      parentWindowId: "root",
      title: "t",
      status: "open",
      createdAt: 0,
      target: "alice",
    } as ContextWindow;
    const sayOnTalk = form({ id: "fs1", method: "say", parentWindowId: "wt" });
    expect(evaluateTrigger(t, thread({ contextWindows: [talkW, sayOnTalk] }))).toBe(true);

    const sayOnRoot = form({ id: "fs2", method: "say", parentWindowId: "root" });
    expect(evaluateTrigger(t, thread({ contextWindows: [sayOnRoot] }))).toBe(false);
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
