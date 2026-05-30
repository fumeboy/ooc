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
import { resolveRenderXml, resolveBasicKnowledge, clearBehaviorCache } from "../behavior";
import {
  renderSkillIndex,
  SKILL_INDEX_BASIC_KNOWLEDGE,
} from "../../skill_index/index";
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
  test("skeleton proto without executable → undefined (caller falls back to registry)", async () => {
    expect(await resolveRenderXml("program")).toBeUndefined();
    expect(await resolveBasicKnowledge("program")).toBeUndefined();
  });
  test("non-base type → undefined", async () => {
    expect(await resolveRenderXml("do")).toBeUndefined();
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
