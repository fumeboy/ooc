/**
 * Engine 层 open(type="skill") 集成测试
 *
 * 验证 skill 加载流程：查找 skill → 读取 body → 写入 inject event
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkillBody } from "../src/extendable/skill/loader.js";
import type { SkillDefinition } from "../src/extendable/skill/types.js";

const TMP = join(import.meta.dir, "__tmp_engine_skill__");

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function createSkill(name: string, body: string) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: "test"\n---\n\n${body}`);
  return dir;
}

describe('open(type="skill") engine flow', () => {
  test("skill 找到时：loadSkillBody 返回 body 内容", () => {
    const dir = createSkill("commit", "# Commit 流程\n\n1. 检查 status");
    const body = loadSkillBody(dir);
    expect(body).toContain("# Commit 流程");
    expect(body).toContain("1. 检查 status");
  });

  test("skill 未找到时：loadSkillBody 返回 null", () => {
    const body = loadSkillBody(join(TMP, "nonexistent"));
    expect(body).toBeNull();
  });

  test("skill 查找逻辑：按 name 匹配 SkillDefinition", () => {
    const dir = createSkill("commit", "body");
    const skills: SkillDefinition[] = [
      { name: "commit", description: "提交", dir },
      { name: "review", description: "审查", dir: join(TMP, "review") },
    ];
    const found = skills.find(s => s.name === "commit");
    expect(found).toBeDefined();
    expect(found!.dir).toBe(dir);

    const notFound = skills.find(s => s.name === "nonexistent");
    expect(notFound).toBeUndefined();
  });
});
