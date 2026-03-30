/**
 * Trait 相关类型定义 (G3)
 *
 * Trait 是对象的能力单元。
 * 每个 Trait 是一个目录：readme.md（文档/bias）+ 可选 index.ts（方法）。
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 自我定义单元（TraitDefinition, TraitWhen, TraitMethod）
 * @ref docs/哲学文档/gene.md#G12 — references — Trait 是经验沉淀的载体
 */

/** Trait 方法参数定义 */
export interface TraitMethodParam {
  /** 参数名 */
  name: string;
  /** 参数类型 */
  type: string;
  /** 参数描述 */
  description: string;
  /** 是否必填 */
  required: boolean;
}

/** Trait 方法定义 */
export interface TraitMethod {
  /** 方法名 */
  name: string;
  /** 方法描述 */
  description: string;
  /** 参数列表 */
  params: TraitMethodParam[];
  /** 实际的函数引用 */
  fn: (...args: unknown[]) => Promise<unknown>;
  /** 函数是否需要 ctx 作为第一个参数（默认 true，LLM 创建的函数通常为 false） */
  needsCtx?: boolean;
}

/** Trait 激活条件 */
export type TraitWhen = "always" | "never" | string;

/** Trait Hook 事件名 — 栈帧级 + Flow 级 */
export type TraitHookEvent = "before" | "after" | "when_finish" | "when_wait" | "when_error";

/** Trait Hook 定义 */
export interface TraitHook {
  /** 注入到 program output 的提示文本 */
  inject: string;
  /** 简要描述这个 inject 是干嘛的（用于 UI 折叠展示） */
  inject_title?: string;
  /** 是否只触发一次（默认 true） */
  once?: boolean;
}

/** Trait 的完整定义 */
export interface TraitDefinition {
  /** Trait 名称 */
  name: string;
  /** 激活条件 */
  when: TraitWhen;
  /** 一行摘要（~50字），用于 trait catalog 展示 */
  description: string;
  /** readme.md 的文本内容（用作 bias/context window） */
  readme: string;
  /** 从 index.ts 加载的方法列表 */
  methods: TraitMethod[];
  /** 依赖的其他 trait 名称 */
  deps: string[];
  /** 生命周期 hooks */
  hooks?: { [K in TraitHookEvent]?: TraitHook };
}
