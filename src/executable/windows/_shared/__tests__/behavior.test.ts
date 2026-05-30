/**
 * behavior.test — 活路径 prototype-chain 解析（renderXml + basicKnowledge）+ skill_index 行为等价（OOC-4 L4.1）。
 *
 * 覆盖：
 * 1. 解析层（Task 1）：
 *    - skill_index renderXml/basicKnowledge 经 base 原型链解析（registry 不再持有）
 *    - 骨架 proto（program 无 executable）→ undefined（caller 回退 registry）
 *    - 非 base type（do）→ undefined
 * 2. 行为等价（Task 6，关键）：
 *    - resolveRenderXml("skill_index") 产出的 XmlNode[] 与旧 renderSkillIndex 对同输入逐字节一致
 *    - collectExecutableKnowledgeEntries 仍注入 internal/windows/skill_index/basic，内容 === SKILL_INDEX_BASIC_KNOWLEDGE
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveRenderXml,
  resolveBasicKnowledge,
  resolveMethod,
  resolveAllMethods,
  clearBehaviorCache,
} from "../behavior";
import {
  renderSkillIndex,
  SKILL_INDEX_BASIC_KNOWLEDGE,
} from "../../skill_index/index";
import {
  execCommand as programExec,
  closeCommand as programClose,
  setHistoryWindowCommand as programSetHistory,
  renderProgramWindow,
} from "../../program/index";
import {
  closeCommand as searchClose,
  openMatchCommand as searchOpenMatch,
  renderSearchWindow,
  SEARCH_WINDOW_BASIC_KNOWLEDGE,
} from "../../search/index";
import { setResultsWindowCommandForSearch } from "../../search/command.set-results-window";
import {
  setRangeCommand as fileSetRange,
  setViewportCommand as fileSetViewport,
  reloadCommand as fileReload,
  editCommand as fileEdit,
  closeCommand as fileClose,
  renderFileWindow,
} from "../../file/index";
import {
  reloadCommand as knowledgeReload,
  closeCommand as knowledgeClose,
  setViewportCommand as knowledgeSetViewport,
  renderKnowledgeWindow,
} from "../../knowledge/index";
import type { RenderContext } from "../registry";
import type { SkillIndexWindow } from "../types";
import { SKILL_INDEX_WINDOW_ID } from "../types";
import { serializeXml } from "../../../../thinkable/context/xml";
import { collectExecutableKnowledgeEntries } from "../../../../thinkable/knowledge/synthesizer";
import { branchSkillsDir, clearStoneSkillsCache } from "../../../../persistable/stone-skills";
import { makeThread } from "../../../../__tests__/make-thread";

afterEach(() => clearBehaviorCache());

describe("prototype behavior resolution (renderXml + basicKnowledge)", () => {
  test("skill_index renderXml resolves via base prototype chain", async () => {
    expect(typeof (await resolveRenderXml("skill_index"))).toBe("function");
  });
  test("skill_index basicKnowledge resolves via chain", async () => {
    expect(await resolveBasicKnowledge("skill_index")).toContain("skill");
  });
  test("base proto without executable (command_exec) → undefined (caller falls back to registry)", async () => {
    expect(await resolveRenderXml("command_exec")).toBeUndefined();
    expect(await resolveBasicKnowledge("command_exec")).toBeUndefined();
  });
  test("program transcribed (L4.2) → renderXml resolves via chain", async () => {
    expect(typeof (await resolveRenderXml("program"))).toBe("function");
  });
  test("non-base type → undefined", async () => {
    expect(await resolveRenderXml("do")).toBeUndefined();
  });
});

describe("method resolution (resolveMethod + resolveAllMethods, sawExecutable 语义)", () => {
  test("skill_index has executable (methods={}) → resolveAllMethods returns {} (not undefined)", async () => {
    const m = await resolveAllMethods("skill_index");
    expect(m).toBeDefined();
    expect(Object.keys(m!)).toEqual([]);
  });
  test("skill_index resolveMethod(any) → undefined (空 methods)", async () => {
    expect(await resolveMethod("skill_index", "close")).toBeUndefined();
  });
  test("non-base type (do) → resolveAllMethods undefined / resolveMethod undefined", async () => {
    expect(await resolveAllMethods("do")).toBeUndefined();
    expect(await resolveMethod("do", "continue")).toBeUndefined();
  });
  test("custom proto has no executable → resolveAllMethods undefined (custom 走 registry/dispatcher 分支)", async () => {
    expect(await resolveAllMethods("custom")).toBeUndefined();
    expect(await resolveMethod("custom", "anything")).toBeUndefined();
  });
});

describe("skill_index behavior equivalence (L4.1 fidelity gate)", () => {
  function makeSkillIndexWindow(): SkillIndexWindow {
    return {
      id: SKILL_INDEX_WINDOW_ID,
      type: "skill_index",
      parentWindowId: "root",
      title: "Skills (2)",
      status: "active",
      createdAt: 0,
      skills: [
        {
          name: "alpha",
          description: "alpha desc",
          skillFilePath: "/stones/main/skills/alpha/SKILL.md",
          scope: "branch",
        },
        {
          name: "beta",
          description: "beta desc",
          skillFilePath: "/stones/main/objects/agent/skills/beta/SKILL.md",
          scope: "object",
        },
      ],
    };
  }

  test("renderXml via base chain === original renderSkillIndex (byte-identical XML)", async () => {
    const window = makeSkillIndexWindow();
    const ctx: RenderContext = { thread: {} as RenderContext["thread"], window };

    const chainHook = await resolveRenderXml("skill_index");
    expect(chainHook).toBeDefined();

    const chainNodes = await chainHook!(ctx);
    const originalNodes = await renderSkillIndex(ctx);

    // 逐字节比对：把两组 XmlNode[] 各包一层 root 再序列化，断言完全一致
    const wrap = (nodes: typeof chainNodes) =>
      nodes.map((n) => serializeXml(n)).join("\n");
    expect(wrap(chainNodes)).toBe(wrap(originalNodes));
  });

  test("basicKnowledge injected into synthesizer === SKILL_INDEX_BASIC_KNOWLEDGE", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-behavior-skill-"));
    try {
      // 写一个 branch 级 skill，让 synthesizer 派生出 skill_index window 触发 basicKnowledge 注入
      const skillsDir = branchSkillsDir(tempRoot, "main");
      await mkdir(join(skillsDir, "demo"), { recursive: true });
      await writeFile(
        join(skillsDir, "demo", "SKILL.md"),
        "---\ndescription: demo skill\n---\n# demo\n",
        "utf8",
      );

      const thread = makeThread({
        id: "t",
        persistence: {
          baseDir: tempRoot,
          sessionId: "s",
          objectId: "agent",
          threadId: "t",
          stonesBranch: "main",
        },
      });
      const result = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);

      const key = "internal/windows/skill_index/basic";
      expect(result.knowledgeEntries[key]).toBe(SKILL_INDEX_BASIC_KNOWLEDGE);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      clearStoneSkillsCache();
    }
  });
});

describe("L4.2 proto transcription equivalence (program/search/file/knowledge)", () => {
  // import-reuse 天然保证行为等价：链解析到的 entry / renderXml 与原 registry 用的是同一函数引用。
  // 这些测试守住「迁移后链返回的就是同一引用」+「method 集合名一致」。

  test("program: methods + renderXml resolve to the same references", async () => {
    expect(await resolveMethod("program", "exec")).toBe(programExec);
    expect(await resolveMethod("program", "close")).toBe(programClose);
    expect(await resolveMethod("program", "set_history_window")).toBe(programSetHistory);
    expect(await resolveRenderXml("program")).toBe(renderProgramWindow);
    const all = await resolveAllMethods("program");
    expect(Object.keys(all!).sort()).toEqual(["close", "exec", "set_history_window"]);
    // program 无 basicKnowledge
    expect(await resolveBasicKnowledge("program")).toBeUndefined();
  });

  test("search: methods + renderXml + basicKnowledge resolve to the same references", async () => {
    expect(await resolveMethod("search", "close")).toBe(searchClose);
    expect(await resolveMethod("search", "open_match")).toBe(searchOpenMatch);
    expect(await resolveMethod("search", "set_results_window")).toBe(
      setResultsWindowCommandForSearch,
    );
    expect(await resolveRenderXml("search")).toBe(renderSearchWindow);
    expect(await resolveBasicKnowledge("search")).toBe(SEARCH_WINDOW_BASIC_KNOWLEDGE);
    const all = await resolveAllMethods("search");
    expect(Object.keys(all!).sort()).toEqual(["close", "open_match", "set_results_window"]);
  });

  test("file: methods + renderXml resolve to the same references", async () => {
    expect(await resolveMethod("file", "set_range")).toBe(fileSetRange);
    expect(await resolveMethod("file", "set_viewport")).toBe(fileSetViewport);
    expect(await resolveMethod("file", "reload")).toBe(fileReload);
    expect(await resolveMethod("file", "edit")).toBe(fileEdit);
    expect(await resolveMethod("file", "close")).toBe(fileClose);
    expect(await resolveRenderXml("file")).toBe(renderFileWindow);
    const all = await resolveAllMethods("file");
    expect(Object.keys(all!).sort()).toEqual([
      "close",
      "edit",
      "reload",
      "set_range",
      "set_viewport",
    ]);
    expect(await resolveBasicKnowledge("file")).toBeUndefined();
  });

  test("knowledge: methods + renderXml resolve to the same references", async () => {
    expect(await resolveMethod("knowledge", "reload")).toBe(knowledgeReload);
    expect(await resolveMethod("knowledge", "close")).toBe(knowledgeClose);
    expect(await resolveMethod("knowledge", "set_viewport")).toBe(knowledgeSetViewport);
    expect(await resolveRenderXml("knowledge")).toBe(renderKnowledgeWindow);
    const all = await resolveAllMethods("knowledge");
    expect(Object.keys(all!).sort()).toEqual(["close", "reload", "set_viewport"]);
    expect(await resolveBasicKnowledge("knowledge")).toBeUndefined();
  });

  test("renderXml via chain === original (byte-identical XML) for program", async () => {
    const window = {
      id: "w_prog_eq",
      type: "program" as const,
      parentWindowId: "root",
      title: "prog eq",
      status: "open" as const,
      createdAt: 0,
      history: [
        {
          execId: "e0",
          language: "shell" as const,
          code: "echo hi",
          output: "hi",
          ok: true,
          startedAt: 1,
        },
      ],
      historyViewport: { tail: 10 },
    };
    const ctx: RenderContext = { thread: {} as RenderContext["thread"], window: window as never };
    const chainHook = await resolveRenderXml("program");
    const chainNodes = await chainHook!(ctx);
    const originalNodes = await renderProgramWindow(ctx);
    const wrap = (nodes: typeof chainNodes) => nodes.map((n) => serializeXml(n)).join("\n");
    expect(wrap(chainNodes)).toBe(wrap(originalNodes));
  });
});
