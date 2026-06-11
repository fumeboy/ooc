/**
 * skill_index object —— stones 上 skills 目录的索引视图。
 *
 * Object Unification: 从 builtin window 迁移为 builtin object。
 *
 * 形态决策：
 * - **完全由 synthesizer 派生**：每轮渲染时按 thread.persistence 推导 stoneRef，
 *   并行扫描 branch / object 两层 skills 目录（10s TTL 缓存，详见 stone-skills.ts）；
 *   合并去重（同名 object 级优先），把派生的 SkillIndexWindow 插入 enriched
 *   contextWindows 视图。
 * - **如果两层都没有 skills，跳过注入**——避免空白 window 占 context；
 * - **不持久化**：thread.json 中不出现该 window；synthesizer 在每轮 collect 时按需重建；
 * - 不注册任何 method；readable 维度（readable hook + onClose + basicKnowledge）全在 ../readable.ts。
 *
 * UI 端类似——ContextSnapshotViewer 渲染时如果 skills 为空就不显示卡片。
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
// readable 维度由 barrel index.ts 的 import "./readable.js" 加载（executable 不 import readable）。

// skill_index 无 object method / constructor —— executable 维度只声明空方法表。
builtinRegistry.registerExecutable("skill_index", { methods: {} });
