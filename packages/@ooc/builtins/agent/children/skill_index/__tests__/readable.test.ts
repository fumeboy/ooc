/**
 * readable.test — skill_index builtin readable 渲染期自算 skills 的测试。
 *
 * 取代退役的 pipeline synthesizer 测试（原 core/executable/__tests__/skill-index.test.ts）。
 * skill_index 作为 member-window 注入（data={}），其 readable 按 ctx.thread.persistence 推导
 * stoneRef，扫描 workspace / object 两层目录后去重合并投影成 `<skills>`。
 *
 * 覆盖：
 * - 没有 skills → 投影 skills count=0
 * - branch + object skills 合并去重，object 同名优先
 * - 只有 branch / 只有 object
 * - thread 无 persistence → 跳过（count=0）
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { ReadableContext } from "@ooc/core/readable/contract.js";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import readable from "../readable/index";
import { branchSkillsDir, clearStoneSkillsCache, objectSkillsDir } from "../scan";
import type { Data, SkillEntry } from "../types";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearStoneSkillsCache();
});

async function writeSkill(skillsDir: string, name: string, description: string): Promise<void> {
  await mkdir(join(skillsDir, name), { recursive: true });
  await writeFile(
    join(skillsDir, name, "SKILL.md"),
    `---\ndescription: ${description}\n---\n# ${name}\n`,
    "utf8",
  );
}

/** 从 readable 投影 content 抽出 skill 条目（name/scope/description）。 */
function extractSkills(content: XmlNode[] | string): Array<{ name: string; scope: string; description: string }> {
  if (typeof content === "string") return [];
  const skillsNode = content.find((n) => n.kind === "element" && n.tag === "skills");
  if (!skillsNode || skillsNode.kind !== "element") return [];
  return (skillsNode.children ?? [])
    .filter((c): c is Extract<XmlNode, { kind: "element" }> => c.kind === "element" && c.tag === "skill")
    .map((skill) => {
      const descNode = (skill.children ?? []).find(
        (c): c is Extract<XmlNode, { kind: "element" }> => c.kind === "element" && c.tag === "description",
      );
      const descText = descNode?.children?.find((c) => c.kind === "text");
      return {
        name: skill.attrs?.name ?? "",
        scope: skill.attrs?.scope ?? "",
        description: descText && descText.kind === "text" ? descText.value : "",
      };
    });
}

const EMPTY_DATA: Data = { status: "active", skills: [] as SkillEntry[] };

function ctxFor(thread: ReturnType<typeof makeThread>): ReadableContext {
  return {
    thread,
    object: { id: "_builtin/agent/skill_index", class: "_builtin/agent/skill_index" },
    persistence: thread.persistence
      ? { baseDir: thread.persistence.baseDir, sessionId: thread.persistence.sessionId }
      : undefined,
  };
}

describe("skill_index readable 渲染期自算", () => {
  test("没有 skills → 投影 skills count=0", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-readable-"));
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const projection = await readable.readable(ctxFor(thread), EMPTY_DATA, {});
    expect(extractSkills(projection.content)).toEqual([]);
  });

  test("branch + object skills 合并；object 同名优先", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-readable-"));
    const stoneRef = { baseDir: tempRoot, objectId: "agent" };
    await writeSkill(branchSkillsDir(tempRoot), "shared", "branch version");
    await writeSkill(branchSkillsDir(tempRoot), "common", "common branch");
    await writeSkill(objectSkillsDir(stoneRef), "shared", "object override"); // 同名
    await writeSkill(objectSkillsDir(stoneRef), "private", "only mine");

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const skills = extractSkills((await readable.readable(ctxFor(thread), EMPTY_DATA, {})).content);
    expect(skills.length).toBe(3);
    expect(skills.map((s) => s.name).sort()).toEqual(["common", "private", "shared"]);
    const shared = skills.find((s) => s.name === "shared");
    expect(shared?.scope).toBe("object");
    expect(shared?.description).toBe("object override");
  });

  test("只有 branch skills", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-readable-"));
    await writeSkill(branchSkillsDir(tempRoot), "alpha", "alpha skill");
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const skills = extractSkills((await readable.readable(ctxFor(thread), EMPTY_DATA, {})).content);
    expect(skills.length).toBe(1);
    expect(skills[0]?.scope).toBe("workspace");
  });

  test("只有 object skills", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-readable-"));
    const stoneRef = { baseDir: tempRoot, objectId: "agent" };
    await writeSkill(objectSkillsDir(stoneRef), "private-only", "私有 skill");
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const skills = extractSkills((await readable.readable(ctxFor(thread), EMPTY_DATA, {})).content);
    expect(skills.length).toBe(1);
    expect(skills[0]?.scope).toBe("object");
  });

  test("thread 无 persistence → 跳过（count=0）", async () => {
    const thread = makeThread({ id: "t" });
    expect(thread.persistence).toBeUndefined();
    const skills = extractSkills((await readable.readable(ctxFor(thread), EMPTY_DATA, {})).content);
    expect(skills).toEqual([]);
  });
});
