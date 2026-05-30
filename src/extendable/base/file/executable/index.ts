/**
 * base/file/executable — file 原型的 behavior 真源（OOC-4 L4.2）。
 *
 * methods（set_range/set_viewport/reload/edit/close）+ renderXml 从 windows/file/index.ts 的
 * registry 入口迁到这里，由活路径沿 base 原型链解析（src/executable/windows/_shared/behavior.ts）。
 *
 * **复用而非 copy**：直接 import 现有 entries + renderFileWindow，避免逐字 copy 漂移；
 * 行为等价由 _shared/__tests__/behavior.test.ts 守。
 *
 * file 无 basicKnowledge（method-level knowledge 由各 entry.knowledge() 派生）。
 * compressView 是 L4 排除项，仍由 windows/file/index.ts registry-served（不迁链）。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import {
  setRangeCommand,
  setViewportCommand,
  reloadCommand,
  editCommand,
  closeCommand,
  renderFileWindow,
} from "../../../../executable/windows/file/index.js";

export const window: ObjectWindowDefinition = {
  methods: {
    set_range: setRangeCommand,
    set_viewport: setViewportCommand,
    reload: reloadCommand,
    edit: editCommand,
    close: closeCommand,
  },
  renderXml: renderFileWindow,
};
