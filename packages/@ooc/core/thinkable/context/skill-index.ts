/**
 * Skill index synthesis.
 *
 * Scans stones/<branch>/skills + stones/<branch>/objects/<self>/skills + optional externalSkillsDir,
 * merges them (object > branch > external), and produces a SkillIndexWindow when non-empty.
 */
import {
  deriveStoneFromThread,
  listBranchSkills,
  listObjectSkills,
  listExternalSkills,
  readWorldConfig,
} from "../../persistable/index.js";
import type { SkillIndexWindow } from "../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID, SKILL_INDEX_WINDOW_ID } from "../../executable/windows/_shared/types.js";
import type { ThreadContext } from "./index.js";

/**
 * Synthesize a SkillIndexWindow for the thread's object.
 *
 * Returns an array with either 0 or 1 SkillIndexWindow.
 * When thread has no persistence, returns [].
 */
export async function synthesizeSkillIndex(thread: ThreadContext): Promise<SkillIndexWindow[]> {
  if (!thread.persistence) return [];

  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const worldConfig = await readWorldConfig(thread.persistence.baseDir);
    const externalDir = worldConfig.externalSkillsDir;
    const [branchSkills, objectSkills, externalSkills] = await Promise.all([
      listBranchSkills(thread.persistence.baseDir),
      listObjectSkills(stoneRef),
      externalDir ? listExternalSkills(externalDir) : Promise.resolve([]),
    ]);

    // Priority: external < branch < object (specificity increasing)
    const byName = new Map<string, typeof branchSkills[number]>();
    for (const s of externalSkills) byName.set(s.name, s);
    for (const s of branchSkills) byName.set(s.name, s);
    for (const s of objectSkills) byName.set(s.name, s);

    const merged = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (merged.length === 0) return [];

    const skillIndex: SkillIndexWindow = {
      id: SKILL_INDEX_WINDOW_ID,
      type: "skill_index",
      parentWindowId: ROOT_WINDOW_ID,
      title: `Skills (${merged.length})`,
      status: "active",
      createdAt: Date.now(),
      skills: merged,
    };
    return [skillIndex];
  } catch (err) {
    // 知情跳过（silent-swallow ban）：缺 skills 目录是常态、由各 list* 内部按空处理；
    // 走到这里是真异常（config 读失败 / 非 ENOENT IO 错），log 出来而不是静默吞掉。
    console.warn(
      `[skill-index] synthesize skipped object=${thread.persistence?.objectId} msg=${(err as Error).message}`,
    );
    return [];
  }
}

