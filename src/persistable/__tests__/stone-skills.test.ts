/**
 * stone-skills.test — skills 目录扫描器与 10s 缓存测试（plan §skills 支持）。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  branchSkillsDir,
  clearStoneSkillsCache,
  listBranchSkills,
  listObjectSkills,
  objectSkillsDir,
} from "../stone-skills";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearStoneSkillsCache();
});

async function writeSkill(skillsDir: string, name: string, frontmatter: string, body = ""): Promise<void> {
  const skillDir = join(skillsDir, name);
  await mkdir(skillDir, { recursive: true });
  const content = frontmatter ? `---\n${frontmatter}\n---\n${body}` : body;
  await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
}

describe("listBranchSkills", () => {
  test("返回空数组当 skills 目录不存在", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const skills = await listBranchSkills(tempRoot, "main");
    expect(skills).toEqual([]);
  });

  test("happy path：列出多个 skill 并解析 description", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const skillsDir = branchSkillsDir(tempRoot, "main");
    await writeSkill(skillsDir, "alpha", "description: alpha desc");
    await writeSkill(skillsDir, "beta", "description: beta desc");

    const skills = await listBranchSkills(tempRoot, "main");
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]); // 字典序
    expect(skills[0]?.description).toBe("alpha desc");
    expect(skills[0]?.scope).toBe("branch");
    expect(skills[0]?.skillFilePath).toContain("alpha/SKILL.md");
  });

  test("description 缺失或 frontmatter 损坏 → 落到 (无描述)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const skillsDir = branchSkillsDir(tempRoot, "main");
    await writeSkill(skillsDir, "no-desc", "name: foo"); // 没有 description
    await writeSkill(skillsDir, "broken", "this: is\n  bad yaml: {[");

    const skills = await listBranchSkills(tempRoot, "main");
    const noDesc = skills.find((s) => s.name === "no-desc");
    const broken = skills.find((s) => s.name === "broken");
    expect(noDesc?.description).toBe("(无描述)");
    expect(broken?.description).toBe("(无描述)");
  });

  test("子目录无 SKILL.md → 跳过不计入", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const skillsDir = branchSkillsDir(tempRoot, "main");
    await mkdir(join(skillsDir, "incomplete"), { recursive: true }); // 没 SKILL.md
    await writeSkill(skillsDir, "good", "description: ok");

    const skills = await listBranchSkills(tempRoot, "main");
    expect(skills.map((s) => s.name)).toEqual(["good"]);
  });

  test("点开头的子目录被忽略", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const skillsDir = branchSkillsDir(tempRoot, "main");
    await writeSkill(skillsDir, ".hidden", "description: hidden");
    await writeSkill(skillsDir, "visible", "description: visible");

    const skills = await listBranchSkills(tempRoot, "main");
    expect(skills.map((s) => s.name)).toEqual(["visible"]);
  });
});

describe("listObjectSkills", () => {
  test("路径形态：stones/<branch>/objects/<obj>/skills/", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const ref = { baseDir: tempRoot, objectId: "agent_x", stonesBranch: "main" };
    const skillsDir = objectSkillsDir(ref);
    expect(skillsDir).toContain("stones/main/objects/agent_x/skills");

    await writeSkill(skillsDir, "private-skill", "description: only mine");
    const skills = await listObjectSkills(ref);
    expect(skills.length).toBe(1);
    expect(skills[0]?.scope).toBe("object");
    expect(skills[0]?.name).toBe("private-skill");
  });

  test("不同 object 互不可见", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const refA = { baseDir: tempRoot, objectId: "a", stonesBranch: "main" };
    const refB = { baseDir: tempRoot, objectId: "b", stonesBranch: "main" };
    await writeSkill(objectSkillsDir(refA), "a-skill", "description: A's");
    await writeSkill(objectSkillsDir(refB), "b-skill", "description: B's");

    const aSkills = await listObjectSkills(refA);
    const bSkills = await listObjectSkills(refB);
    expect(aSkills.map((s) => s.name)).toEqual(["a-skill"]);
    expect(bSkills.map((s) => s.name)).toEqual(["b-skill"]);
  });
});

describe("10s TTL 缓存", () => {
  test("重复调用走缓存（不重新 readdir）", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-skills-"));
    const skillsDir = branchSkillsDir(tempRoot, "main");
    await writeSkill(skillsDir, "first", "description: v1");

    const first = await listBranchSkills(tempRoot, "main");
    expect(first.length).toBe(1);

    // 写入新 skill；缓存仍是旧视图
    await writeSkill(skillsDir, "second", "description: v2");
    const second = await listBranchSkills(tempRoot, "main");
    expect(second.length).toBe(1); // 还是 1，缓存未过期

    // 显式清缓存后看到新视图
    clearStoneSkillsCache();
    const third = await listBranchSkills(tempRoot, "main");
    expect(third.length).toBe(2);
  });
});
