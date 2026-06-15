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
import type { Data as SkillIndexData } from "@ooc/builtins/skill_index/types.js";
import { ROOT_WINDOW_ID, SKILL_INDEX_WINDOW_ID } from "../../executable/windows/_shared/types.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { ThreadContext } from "./index.js";

/**
 * Synthesize a skill_index object instance for the thread's object.
 *
 * Returns an array with either 0 or 1 OocObjectInstance（信封 + data.skills）。
 * When thread has no persistence, returns [].
 */
export async function synthesizeSkillIndex(
  thread: ThreadContext,
): Promise<OocObjectInstance<SkillIndexData>[]> {
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

    const skillIndex: OocObjectInstance<SkillIndexData> = {
      id: SKILL_INDEX_WINDOW_ID,
      class: "skill_index",
      parentObjectId: ROOT_WINDOW_ID,
      title: `Skills (${merged.length})`,
      status: "active",
      createdAt: Date.now(),
      data: { status: "active", skills: merged },
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

