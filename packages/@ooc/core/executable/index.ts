/**
 * executable 子系统 — 公开门面（barrel）。
 *
 * 历史上承担"全局基础知识 + form-command knowledge 派生 + KnowledgeWindow 合成"
 * 全部职责。2026-05-18 把 knowledge 合成迁到 thinkable/knowledge（决定 LLM 看见
 * 什么知识是 thinkable 概念，详见 src/thinkable/knowledge/synthesizer.ts 顶部 doc）。
 *
 * 本文件保留 re-export 以维持 `@ooc/core/executable` 导入面的稳定。
 */

export {
  collectExecutableKnowledgeEntries,
  computeFormKnowledgeEntries,
  enrichFormCommandKnowledge,
  BASIC_KNOWLEDGE_PATH,
  KNOWLEDGE,
} from "../thinkable/knowledge/index.js";
