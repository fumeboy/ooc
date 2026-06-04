/**
 * Skill index synthesis — extracted from synthesizer.collectExecutableKnowledgeEntries Phase 1.6.
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
import type { ContextWindow, SkillIndexWindow } from "../../executable/windows/_shared/types.js";
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
  } catch {
    return [];
  }
}

/**
 * Merge skill index windows into a context window list, replacing any existing
 * skill_index window by id.
 */
export function mergeSkillIndex(existing: ContextWindow[], skillIndex: SkillIndexWindow[]): ContextWindow[] {
  if (skillIndex.length === 0) return existing;
  const idx = existing.findIndex((w) => w.id === SKILL_INDEX_WINDOW_ID);
  if (idx >= 0) {
    const copy = [...existing];
    copy[idx] = skillIndex[0];
    return copy;
  }
  return [...existing, ...skillIndex];
}

/**
 * Get type-level basicKnowledge path+value for skill_index.
 * Used when protocol knowledge needs the skill_index basics.
 */
export function getSkillIndexBasicPath(): string {
  return "internal/windows/skill_index/basic";
}
