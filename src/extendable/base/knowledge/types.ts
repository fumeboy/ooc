/**
 * Knowledge Object — 一段 knowledge 文本作为 Object 出现在 context 中。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object，
 * 放置在 src/extendable/base/knowledge/。
 *
 * 类型定义保留在原位置（src/executable/windows/knowledge/types.ts）以避免破坏现有导入，
 * 此处重导出供新代码使用。
 */

export type { KnowledgeWindow } from "../../../executable/windows/knowledge/types.js";
