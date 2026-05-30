/**
 * base/knowledge/executable — knowledge 原型的 behavior 真源（OOC-4 L4.2）。
 *
 * methods（reload/close/set_viewport）+ renderXml 从 windows/knowledge/index.ts 的
 * registry 入口迁到这里，由活路径沿 base 原型链解析（src/executable/windows/_shared/behavior.ts）。
 *
 * **复用而非 copy**：直接 import 现有 entries + renderKnowledgeWindow，避免逐字 copy 漂移；
 * 行为等价由 _shared/__tests__/behavior.test.ts 守。
 *
 * knowledge 无 basicKnowledge（method-level knowledge 由各 entry.knowledge() 派生）。
 * onClose（拒绝 close 非 explicit 来源）是 L4 排除项，仍由 windows/knowledge/index.ts registry-served（不迁链）。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import {
  reloadCommand,
  closeCommand,
  setViewportCommand,
  renderKnowledgeWindow,
} from "../../../../executable/windows/knowledge/index.js";

export const window: ObjectWindowDefinition = {
  methods: {
    reload: reloadCommand,
    close: closeCommand,
    set_viewport: setViewportCommand,
  },
  renderXml: renderKnowledgeWindow,
};
