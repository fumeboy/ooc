import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { STONES_MAIN_BRANCH } from "./stone-bootstrap";
import { stoneDir, type StoneObjectRef } from "./common";
import { parseKnowledgeFile } from "../thinkable/knowledge/parser";

/**
 * stone skills 目录扫描（plan §skills 支持）。
 *
 * 双层 skills 目录：
 * - Branch 级: `{baseDir}/stones/{branch}/skills/<skill-name>/SKILL.md`
 *   跨 Object 共享的公共 skill 库
 * - Object 级: `{baseDir}/stones/{branch}/objects/{objectId}/skills/<skill-name>/SKILL.md`
 *   属于具体 Object 的私有 skill
 *
 * 每个 skill 子目录至少含 SKILL.md（带 frontmatter description）；
 * 其它辅助文件（references / scripts / 子 .md）随 skill 自由组织，OOC 不约束结构。
 *
 * 10s TTL 缓存（避免每轮 thread render 都做 readdir + readFile）：
 * - 模块级 Map<cacheKey, { fetchedAt, skills }>
 * - 重复调用 ≤ 10s 走缓存；> 10s 重新 readdir + 解析
 * - clearStoneSkillsCache() 测试钩子
 */

/** 单个 skill 索引项（plan §skills 支持的 SkillEntry）。 */
export interface SkillEntry {
  /** skill 名（目录名）。 */
  name: string;
  /** SKILL.md frontmatter 的 description；缺失或解析失败时为 "(无描述)"。 */
  description: string;
  /** SKILL.md 的绝对路径，用作 open_file 提示。 */
  skillFilePath: string;
  /**
   * 来源 scope：
   * - branch  — 公共：stones/<branch>/skills/<name>/SKILL.md
   * - object  — 私有：stones/<branch>/objects/<self>/skills/<name>/SKILL.md
   * - external — 外部目录：由 .world.json 的 externalSkillsDir 指定（与 stone 无关）
   */
  scope: "branch" | "object" | "external";
}

/** branch 级 skills 目录绝对路径。 */
export function branchSkillsDir(baseDir: string, stonesBranch?: string): string {
  return join(baseDir, "stones", stonesBranch ?? STONES_MAIN_BRANCH, "skills");
}

/** object 级 skills 目录绝对路径。 */
export function objectSkillsDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "skills");
}

interface CachedEntry {
  fetchedAt: number;
  skills: SkillEntry[];
}

const SKILLS_CACHE_TTL_MS = 10_000;
const cache = new Map<string, CachedEntry>();

function cacheGet(key: string): SkillEntry[] | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > SKILLS_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.skills;
}

function cacheSet(key: string, skills: SkillEntry[]): void {
  cache.set(key, { fetchedAt: Date.now(), skills });
}

/** 清空 skills 缓存（测试钩子；与 server loader.clearServerLoaderCache 同 pattern）。 */
export function clearStoneSkillsCache(): void {
  cache.clear();
}

/**
 * 扫描指定 skills 目录，对每个子目录读 SKILL.md 解析 frontmatter.description。
 *
 * - 子目录无 SKILL.md → 跳过（不计入索引）
 * - frontmatter 损坏 / description 缺失 → description 设为 "(无描述)"
 * - skills 目录本身不存在（ENOENT）→ 返回 []
 * - 其它 IO 错误向上抛
 */
async function scanSkillsDir(skillsDirPath: string, scope: "branch" | "object" | "external"): Promise<SkillEntry[]> {
  let entries;
  try {
    entries = await readdir(skillsDirPath, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const results: SkillEntry[] = [];
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name.startsWith(".")) continue;
    const skillName = dirent.name;
    const skillFilePath = join(skillsDirPath, skillName, "SKILL.md");
    let text: string;
    try {
      text = await readFile(skillFilePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const { frontmatter } = parseKnowledgeFile(text);
    const description = typeof frontmatter.description === "string" && frontmatter.description.trim().length > 0
      ? frontmatter.description.trim()
      : "(无描述)";
    results.push({ name: skillName, description, skillFilePath, scope });
  }
  // 按 name 字典序，便于 LLM 视图稳定
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * 列出 branch 级 skills（跨 Object 共享）。
 *
 * 路径：`{baseDir}/stones/{stonesBranch}/skills/<skill-name>/SKILL.md`
 */
export async function listBranchSkills(
  baseDir: string,
  stonesBranch?: string,
): Promise<SkillEntry[]> {
  const branch = stonesBranch ?? STONES_MAIN_BRANCH;
  const cacheKey = `branch:${baseDir}:${branch}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const skills = await scanSkillsDir(branchSkillsDir(baseDir, branch), "branch");
  cacheSet(cacheKey, skills);
  return skills;
}

/**
 * 列出 object 级 skills（仅属于该 Object）。
 *
 * 路径：`{baseDir}/stones/{stonesBranch}/objects/{objectId}/skills/<skill-name>/SKILL.md`
 */
export async function listObjectSkills(ref: StoneObjectRef): Promise<SkillEntry[]> {
  const cacheKey = `object:${stoneDir(ref)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const skills = await scanSkillsDir(objectSkillsDir(ref), "object");
  cacheSet(cacheKey, skills);
  return skills;
}

/**
 * 列出外部 skills 目录（与 stone 无关；由 \`<baseDir>/.world.json\` 的 externalSkillsDir 字段配置）。
 *
 * 行为与 listBranchSkills / listObjectSkills 同款（10s TTL 缓存 + ENOENT 静默返回 []）；
 * scope="external"。调用方负责传入展开后的绝对路径（见 persistable/world-config.ts:resolveExternalSkillsDir）。
 *
 * 调用方未配置 externalSkillsDir → 不应调用本函数（直接给 [] 即可，不必走缓存）。
 */
export async function listExternalSkills(externalSkillsDir: string): Promise<SkillEntry[]> {
  const cacheKey = `external:${externalSkillsDir}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const skills = await scanSkillsDir(externalSkillsDir, "external");
  cacheSet(cacheKey, skills);
  return skills;
}
