/**
 * skill-index.test — synthesizer 派生 skill_index window 的测试（plan §skills 支持）。
 *
 * 覆盖：
 * - 没有 skills 时 → enriched 中无 skill_index window（用户补充）
 * - branch + object 都有 skills → 合并去重，object 优先
 * - 只有 branch skills → enriched 含 skill_index
 * - 只有 object skills → enriched 含 skill_index
 * - thread 无 persistence → 无法定位 stoneRef，跳过派生
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { synthesizeSkillIndex } from "../../../thinkable/context/skill-index";
import { branchSkillsDir, clearStoneSkillsCache, objectSkillsDir } from "../../../persistable/stone-skills";
import { makeThread } from "../../../__tests__/make-thread";
import type { ContextWindow, SkillIndexWindow } from "../_shared/types";

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

function findSkillIndex(windows: ContextWindow[] | undefined): SkillIndexWindow | undefined {
  return windows?.find((w): w is SkillIndexWindow => w.type === "skill_index");
}

describe("synthesizer skill_index 派生", () => {
  test("没有 skills → 不注入 skill_index", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-synth-"));
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const result = await synthesizeSkillIndex(thread);
    expect(findSkillIndex(result)).toBeUndefined();
  });

  test("branch + object skills 合并；object 同名优先", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-synth-"));
    const stoneRef = { baseDir: tempRoot, objectId: "agent" };
    await writeSkill(branchSkillsDir(tempRoot), "shared", "branch version");
    await writeSkill(branchSkillsDir(tempRoot), "common", "common branch");
    await writeSkill(objectSkillsDir(stoneRef), "shared", "object override"); // 同名
    await writeSkill(objectSkillsDir(stoneRef), "private", "only mine");

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const result = await synthesizeSkillIndex(thread);
    const skillIndex = findSkillIndex(result);
    expect(skillIndex).toBeDefined();
    expect(skillIndex?.skills.length).toBe(3);
    const names = skillIndex!.skills.map((s) => s.name).sort();
    expect(names).toEqual(["common", "private", "shared"]);
    // 同名 shared 应该是 object 级
    const shared = skillIndex!.skills.find((s) => s.name === "shared");
    expect(shared?.scope).toBe("object");
    expect(shared?.description).toBe("object override");
  });

  test("只有 branch skills → 注入 skill_index", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-synth-"));
    await writeSkill(branchSkillsDir(tempRoot), "alpha", "alpha skill");

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const result = await synthesizeSkillIndex(thread);
    const skillIndex = findSkillIndex(result);
    expect(skillIndex?.skills.length).toBe(1);
    expect(skillIndex?.skills[0]?.scope).toBe("workspace");
  });

  test("只有 object skills → 注入 skill_index", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skill-synth-"));
    const stoneRef = { baseDir: tempRoot, objectId: "agent" };
    await writeSkill(objectSkillsDir(stoneRef), "private-only", "私有 skill");

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const result = await synthesizeSkillIndex(thread);
    const skillIndex = findSkillIndex(result);
    expect(skillIndex?.skills.length).toBe(1);
    expect(skillIndex?.skills[0]?.scope).toBe("object");
  });

  test("thread 无 persistence → 跳过派生（无法定位 stoneRef）", async () => {
    const thread = makeThread({ id: "t" });
    expect(thread.persistence).toBeUndefined();
    const result = await synthesizeSkillIndex(thread);
    expect(findSkillIndex(result)).toBeUndefined();
  });
});
