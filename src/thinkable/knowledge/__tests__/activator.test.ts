import { describe, expect, test } from "bun:test";
import { computeActivations } from "../activator";
import type { KnowledgeDoc, KnowledgeIndex } from "../types";
import type { ThreadContext } from "../../context";
import type { CommandExecWindow } from "../../../executable/windows/_shared/types";

function doc(
  path: string,
  description: string,
  activates_on: KnowledgeDoc["frontmatter"]["activates_on"] | undefined,
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

/** 构造 command_exec window 的辅助；activator 仅读 commandPaths 字段。 */
function form(overrides: Partial<CommandExecWindow>): CommandExecWindow {
  return {
    id: "f",
    type: "command_exec",
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

function thread(overrides: Partial<ThreadContext>): ThreadContext {
  return {
    id: "t",
    status: "running",
    events: [],
    contextWindows: [],
    ...overrides,
  };
}

describe("computeActivations (ContextWindow model)", () => {
  test("empty thread → empty result", () => {
    const out = computeActivations(thread({}), indexOf(doc("a", "A", { show_content_when: ["program"] })));
    expect(out).toEqual([]);
  });

  test("show_content_when match → full", () => {
    const index = indexOf(doc("a", "A", { show_content_when: ["program.shell"] }));
    const out = computeActivations(
      thread({ contextWindows: [form({ commandPaths: ["program.shell"] })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
    expect(out[0]?.reason).toBe("command_path_full");
  });

  test("show_description_when match → summary", () => {
    const index = indexOf(doc("a", "A", { show_description_when: ["program"] }));
    const out = computeActivations(
      thread({ contextWindows: [form({ commandPaths: ["program"] })] }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("summary");
    expect(out[0]?.reason).toBe("command_path_summary");
  });

  test("both summary and full hit → full wins", () => {
    const index = indexOf(
      doc("a", "A", {
        show_description_when: ["program"],
        show_content_when: ["program.shell"],
      }),
    );
    const out = computeActivations(
      thread({
        contextWindows: [form({ commandPaths: ["program", "program.shell"] })],
      }),
      index,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.presentation).toBe("full");
  });

  test("multiple forms union commandPaths", () => {
    const index = indexOf(
      doc("a", "A", { show_content_when: ["program"] }),
      doc("b", "B", { show_content_when: ["talk"] }),
    );
    const out = computeActivations(
      thread({
        contextWindows: [
          form({ id: "f1", commandPaths: ["program"] }),
          form({ id: "f2", commandPaths: ["talk"] }),
        ],
      }),
      index,
    );
    expect(out.map((r) => r.path).sort()).toEqual(["a", "b"]);
  });

  test("non-matching paths produce no results", () => {
    const index = indexOf(doc("a", "A", { show_content_when: ["talk"] }));
    const out = computeActivations(
      thread({ contextWindows: [form({ commandPaths: ["program"] })] }),
      index,
    );
    expect(out).toEqual([]);
  });

  test("result count capped at 20", () => {
    const docs: KnowledgeDoc[] = [];
    for (let i = 0; i < 30; i++) {
      docs.push(doc(`k${i}`, `desc ${i}`, { show_content_when: ["program"] }));
    }
    const out = computeActivations(
      thread({ contextWindows: [form({ commandPaths: ["program"] })] }),
      indexOf(...docs),
    );
    expect(out.length).toBe(20);
  });

  test("doc without activates_on never auto-activates", () => {
    const index = indexOf(doc("a", "A", undefined));
    const out = computeActivations(
      thread({ contextWindows: [form({ commandPaths: ["program"] })] }),
      index,
    );
    expect(out).toEqual([]);
  });
});
