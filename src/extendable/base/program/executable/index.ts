/**
 * base/program/executable — program 原型的 behavior 真源（OOC-4 L4.2）。
 *
 * methods（exec/close/set_history_window）+ renderXml 从 windows/program/index.ts 的
 * registry 入口迁到这里，由活路径沿 base 原型链解析（src/executable/windows/_shared/behavior.ts）。
 *
 * **复用而非 copy**：直接 import 现有 execCommand/closeCommand/setHistoryWindowCommand +
 * renderProgramWindow，避免逐字 copy 漂移；行为等价由 _shared/__tests__/behavior.test.ts 守。
 *
 * program 无 basicKnowledge（method-level knowledge 由各 entry.knowledge() 派生），无 onClose / compressView。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import {
  execCommand,
  closeCommand,
  setHistoryWindowCommand,
  renderProgramWindow,
} from "../../../../executable/windows/program/index.js";

export const window: ObjectWindowDefinition = {
  methods: {
    exec: execCommand,
    close: closeCommand,
    set_history_window: setHistoryWindowCommand,
  },
  renderXml: renderProgramWindow,
};
