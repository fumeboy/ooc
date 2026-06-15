/**
 * skill_index —— readable 维度（投影成 context window）。
 *
 * 把派生注入的 Data.skills 渲染成 XML 子节点序列。实际派生逻辑（异步 IO 扫描 skills 目录）
 * 由 synthesizer 在每轮 collect 时完成、填进 Data；本投影只读 Data、不碰 IO。
 *
 * 无 window method（展示态空）；无 object method（executable 空表）。
 */

import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** skill_index 的**投影态**（与 Data 分离）：当前无展示态字段。 */
export interface SkillIndexWin {}

const readable: ReadableModule<Data, SkillIndexWin> = {
  readable: (_ctx: ReadableContext, self: Data) => {
    const skills = self.skills ?? [];
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
