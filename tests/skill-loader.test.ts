/**
 * Skill 加载器测试
 *
 * @ref docs/superpowers/specs/2026-04-10-skill-system-design.md#3.1
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadSkills, loadSkillBody } from "../src/extendable/skill/loader.js";

const TMP = join(import.meta.dir, "__tmp_skills__");

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** 辅助：创建 SKILL.md */
function createSkill(name: string, frontmatter: string, body: string) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}`);
}

describe("loadSkills", () => {
  test("加载单个 skill 的 frontmatter", () => {
    createSkill("commit", 'name: commit\ndescription: "生成 commit message"\nwhen: "提交代码时"', "# Commit\n详细内容");
    const skills = loadSkills(TMP);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("commit");
    expect(skills[0]!.description).toBe("生成 commit message");
    expect(skills[0]!.when).toBe("提交代码时");
    expect(skills[0]!.dir).toBe(join(TMP, "commit"));
  });

  test("加载多个 skills", () => {
    createSkill("commit", 'name: commit\ndescription: "提交"', "body1");
    createSkill("review", 'name: review\ndescription: "审查"', "body2");
    const skills = loadSkills(TMP);
    expect(skills).toHaveLength(2);
    const names = skills.map(s => s.name).sort();
    expect(names).toEqual(["commit", "review"]);
  });

  test("跳过没有 SKILL.md 的目录", () => {
    mkdirSync(join(TMP, "empty-dir"), { recursive: true });
    createSkill("valid", 'name: valid\ndescription: "有效"', "body");
    const skills = loadSkills(TMP);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("valid");
  });

  test("目录不存在时返回空数组", () => {
    const skills = loadSkills("/nonexistent/path");
    expect(skills).toEqual([]);
  });

  test("when 字段可选", () => {
    createSkill("simple", 'name: simple\ndescription: "简单"', "body");
    const skills = loadSkills(TMP);
    expect(skills[0]!.when).toBeUndefined();
  });
});

describe("loadSkillBody", () => {
  test("按需读取 SKILL.md body", () => {
    createSkill("commit", 'name: commit\ndescription: "提交"', "# Commit 流程\n\n1. 检查 status");
    const body = loadSkillBody(join(TMP, "commit"));
    expect(body).toContain("# Commit 流程");
    expect(body).toContain("1. 检查 status");
    expect(body).not.toContain("name: commit");
  });

  test("SKILL.md 不存在时返回 null", () => {
    mkdirSync(join(TMP, "empty"), { recursive: true });
    const body = loadSkillBody(join(TMP, "empty"));
    expect(body).toBeNull();
  });
});
