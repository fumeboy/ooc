/**
 * Context 相关类型定义 (G5)
 *
 * Context 是系统为 Flow 构建的结构化输入。
 * 对象不知道 Context 之外的任何事情。
 *
 * @ref docs/哲学文档/gene.md#G5 — implements — Context 结构（whoAmI, process, messages, windows, directory, status）
 * @ref docs/哲学文档/gene.md#G3 — references — ContextWindow 来自 Trait 的 readme 内容
 * @ref src/types/object.ts — references — TalkableFunction, DirectoryEntry 中的对象接口
 * @ref src/types/flow.ts — references — FlowMessage, FlowStatus, Action 类型
 */

import type { TalkableFunction } from "./object.js";
import type { FlowMessage, FlowStatus, Action } from "./flow.js";

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
 * - stone_default: stone.data._traits_ref 里声明的对象级默认激活
 * - thread_pinned: 线程显式 open(type="trait") pin 的 trait
 * - always_on:    trait 自身 when="always" 声明的常驻激活
 * - command_binding: 被 open(type="command") / partial submit 通过 command_binding 带入的 transient trait
 * - scope_chain:  线程祖先链 traits/activatedTraits 中声明的激活（未归入上面几类）
 * - skill_index:  `available-skills` 索引窗口
 * - memory:       `{stoneDir}/memory/index.md` 或 legacy `memory.md` 的注入
 * - coverage:     最近一次 --coverage 结果
 * - build_feedback: world.hooks 失败反馈
 * - file_window:  open(type="file") 产生的文件内容窗口
 * - extra:        engine 调用方通过 extraWindows 注入
 */
export type ContextWindowSource =
  | "stone_default"
  | "thread_pinned"
  | "always_on"
  | "command_binding"
  | "scope_chain"
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

/**
 * 动态 Window 配置（持久化在 Flow.data._windows 中）
 *
 * 三种来源：
 * - static: 直接提供文本内容
 * - file: 指定文件路径，每次构建 context 时读取
 * - function: 指定 trait 方法，每次构建 context 时调用
 */
export interface WindowConfig {
  /** 窗口名称 */
  name: string;
  /** 来源类型 */
  type: "static" | "file" | "function";
  /** 静态内容（type=static） */
  content?: string;
  /** 文件路径，相对于对象目录（type=file） */
  filePath?: string;
  /** trait 名称（type=function） */
  traitName?: string;
  /** 方法名称（type=function） */
  methodName?: string;
}

/** 完整 Context 结构 (G5) */
export interface Context {
  /** 对象名称（系统中的唯一标识） */
  name: string;
  /** 我是谁（thinkable.whoAmI） */
  whoAmI: string;
  /** 行为树文本表示（Phase 3，Phase 1 为空） */
  process: string;
  /** 消息列表 */
  messages: FlowMessage[];
  /** 行为历史（thought + program 执行结果，用于多轮反馈） */
  actions: Action[];
  /** 系统指令窗口（kernel trait readme，如何使用系统） */
  instructions: ContextWindow[];
  /** 知识窗口（用户 trait readme + 动态 windows） */
  knowledge: ContextWindow[];
  /** 通讯录（系统中所有其他对象） */
  directory: DirectoryEntry[];
  /** 当前状态 */
  status: FlowStatus;
  /** 沙箱路径变量（注入到 STATUS 区域，让对象知道自己的物理位置） */
  paths?: Record<string, string>;
}
