/**
 * Context 相关共享类型
 *
 * @ref docs/哲学文档/gene.md#G3 — references — ContextWindow 来自 Trait 的 readme 内容
 * @ref src/shared/types/object.ts — references — TalkableFunction, DirectoryEntry 中的对象接口
 */

import type { TalkableFunction } from "./object.js";

/** 通讯录中的对象条目 */
export interface DirectoryEntry {
  /** 对象名称 */
  name: string;
  /** 对外简介 */
  whoAmI: string;
  /** 公开方法列表 */
  functions: TalkableFunction[];
}

/**
 * 窗口来源（Phase 3 — llm_input_viewer）
 *
 * 描述"这个窗口为什么会出现在 context 里"，用于前端 hover tooltip 溯源。
 *
 * 枚举值：
 * - thread_pinned: 线程显式 open(type="trait") pin 的 trait
 * - always_on:    系统协议基座（kernel:base）常驻激活
 * - command_binding: 被 open(type="command") / refine 通过 command_binding 带入的 transient trait
 * - from_parent:  线程祖先链 traits/activatedTraits 中声明的激活（未归入上面几类）
 * - skill_index:  `available-skills` 索引窗口
 * - memory:       `{stoneDir}/memory/index.md` 或 legacy `memory.md` 的注入
 * - coverage:     最近一次 --coverage 结果
 * - build_feedback: world.hooks 失败反馈
 * - file_window:  open(type="file") 产生的文件内容窗口
 * - extra:        engine 调用方通过 extraWindows 注入
 */
export type ContextWindowSource =
  | "thread_pinned"
  | "always_on"
  | "command_binding"
  | "from_parent"
  | "skill_index"
  | "memory"
  | "coverage"
  | "build_feedback"
  | "file_window"
  | "extra";

/** Context 中的知识窗口 */
export interface ContextWindow {
  /** 窗口名称（通常是 trait 名） */
  name: string;
  /** 窗口内容 */
  content: string;
  /** trait 生命周期：pinned=用户显式固定，transient=command_binding 带入（form 关闭即回收）。
   * 非 trait 窗口（memory/skill/file 等）为 undefined。 */
  lifespan?: "pinned" | "transient";
  /**
   * 窗口来源（Phase 3 — llm_input_viewer）
   *
   * 用于前端 hover tooltip 解释"它为什么被激活"。可选字段，旧调用方不填不影响 LLM
   * 行为；上层统一由 getOpenFiles / context-builder 注入。
   */
  source?: ContextWindowSource;
}
