/**
 * skill_index —— readable 维度（投影成 context window）。
 *
 * skill_index 是完全派生的索引窗：**渲染期自算 skills**。skill_index builtin 作为 member-window
 * 被注入（`init.ts` 的 GLOBAL_SINGLETON_TOOL_MEMBERS，data={}），其 readable 在每轮渲染时按
 * `ctx.thread.persistence` 推导 stoneRef，并行扫描 workspace / object / external 三层 skills 目录
 * （10s TTL 缓存，见 ../scan.ts），按 external < workspace < object 去重合并后投影成 `<skills>`。
 *
 * 设计依据（object-model 核心 4）：readable 把 object 投影成 window——skills 的扫描+合并是 skill_index
 * 把自身投影成 context window 的内部逻辑，归 readable 维度（取代退役的 pipeline synthesizer 旁路）。
 *
 * 无 window method（展示态空）；无 object method（executable 空表）。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import {
  deriveStoneFromThread,
  readWorldConfig,
} from "@ooc/core/persistable/index.js";
import {
  listBranchSkills,
  listObjectSkills,
  listExternalSkills,
} from "../scan.js";
import type { Data, SkillEntry } from "../types.js";

/** skill_index 的**投影态**（与 Data 分离）：当前无展示态字段。 */
export interface SkillIndexWin {}

/**
 * 渲染期自算 skills——按 thread.persistence 推导 stoneRef，并行扫描三层目录后去重合并。
 * 无 persistence 或扫描失败时返回 []（知情跳过：缺 skills 目录是常态，由各 list* 内部按空处理；
 * 真异常 log 出来而不静默吞）。
 */
async function computeSkills(ctx: ReadableContext): Promise<SkillEntry[]> {
  const persistence = ctx.thread?.persistence;
  if (!persistence) return [];

  try {
    const stoneRef = deriveStoneFromThread(persistence);
    const worldConfig = await readWorldConfig(persistence.baseDir);
    const externalDir = worldConfig.externalSkillsDir;
    const [branchSkills, objectSkills, externalSkills] = await Promise.all([
      listBranchSkills(persistence.baseDir),
      listObjectSkills(stoneRef),
      externalDir ? listExternalSkills(externalDir) : Promise.resolve([]),
    ]);

    // Priority: external < branch < object (specificity increasing)
    const byName = new Map<string, SkillEntry>();
    for (const s of externalSkills) byName.set(s.name, s);
    for (const s of branchSkills) byName.set(s.name, s);
    for (const s of objectSkills) byName.set(s.name, s);

    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn(
      `[skill-index] readable scan skipped object=${persistence.objectId} msg=${(err as Error).message}`,
    );
    return [];
  }
}

const readable: ReadableModule<Data, SkillIndexWin> = {
  readable: async (ctx: ReadableContext, _self: Data) => {
    const skills = await computeSkills(ctx);
    return {
      class: "skill_index",
      content: [
        xmlElement("hint", {}, [
          xmlText(
            '使用 exec(method="open_file", args={ path: "<skillFilePath>" }) 打开具体 SKILL.md 阅读完整说明',
          ),
        ]),
        xmlElement(
          "skills",
          { count: String(skills.length) },
          skills.map((s) =>
            xmlElement(
              "skill",
              { name: s.name, scope: s.scope, path: s.skillFilePath },
              [xmlElement("description", {}, [xmlText(s.description)])],
            ),
          ),
        ),
      ],
    };
  },
  window: [
    {
      class: "skill_index",
      object_methods: [],
      window_methods: [],
    },
  ],
};

export default readable;
