/**
 * base/skill_index/executable — skill_index 原型的 behavior 真源（OOC-4 L4.1）。
 *
 * renderXml + basicKnowledge 从 windows/skill_index/index.ts 的 registry 入口迁到这里，
 * 由活路径沿 base 原型链解析（src/executable/windows/_shared/behavior.ts）。
 *
 * **复用而非 copy**：直接 import 现有 renderSkillIndex + SKILL_INDEX_BASIC_KNOWLEDGE，
 * 避免逐字 copy 漂移；行为等价由 _shared/__tests__/behavior.test.ts 守（plan Task 6）。
 *
 * skill_index 无 method（纯派生索引 window），故 methods 为空。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import {
  renderSkillIndex,
  SKILL_INDEX_BASIC_KNOWLEDGE,
} from "../../../../executable/windows/skill_index/index.js";

export const window: ObjectWindowDefinition = {
  methods: {},
  renderXml: renderSkillIndex,
  basicKnowledge: SKILL_INDEX_BASIC_KNOWLEDGE,
};
