/**
 * Trait 相关类型定义 (G3)
 *
 * Trait 是对象的能力单元。
 * 每个 Trait 是一个目录：TRAIT.md/SKILL.md/readme.md（文档/bias）+ 可选 index.ts（方法）。
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 自我定义单元（TraitDefinition, TraitMethod）
 * @ref docs/哲学文档/gene.md#G12 — references — Trait 是经验沉淀的载体
 */

/** Trait 类型 */
export type TraitType = "how_to_use_tool" | "how_to_think" | "how_to_interact";

/**
 * Trait Namespace —— 三个且仅有三个
 *
 * - kernel：内核能力（kernel/traits/**），所有对象共享
 * - library：公共能力库（library/traits/**），所有对象可复用
 * - self：对象私有能力（stones/{name}/traits/** 或 views/**）
 */
export type TraitNamespace = "kernel" | "library" | "self";

/**
 * Trait Kind —— trait 与 view 的统一建模
 *
 * - trait：普通能力单元（TRAIT.md）
 * - view：UI 视图单元（VIEW.md + frontend.tsx + backend.ts 三件套）
 */
export type TraitKind = "trait" | "view";

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
  /**
   * 实际的函数引用
   *
   * 新协议下统一签名为 `(ctx, args: object) => Promise<any>`。
   * 旧位置参数形式（`(ctx, a, b, c)`）在 Phase 2 全量迁移为对象参数解构。
   */
  fn: (...args: unknown[]) => Promise<unknown>;
  /** 函数是否需要 ctx 作为第一个参数（默认 true，LLM 创建的函数通常为 false） */
  needsCtx?: boolean;
}

/** Trait 方法通道：llm（LLM 沙箱调用） vs ui（前端 HTTP 调用） */
export type TraitMethodChannel = "llm" | "ui";

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

/** Trait 示例 */
export interface TraitExample {
  /** 示例标题 */
  title: string;
  /** 示例内容（通常是 shell 脚本或代码） */
  content: string;
}

/** Trait 常见错误 */
export interface TraitCommonMistake {
  /** 错误类型 */
  type: string;
  /** 错误示例 */
  wrong: string;
  /** 正确示例 */
  right: string;
}

/** Trait 的完整定义 */
export interface TraitDefinition {
  /** Trait namespace —— 必填，kernel | library | self 三选一 */
  namespace: TraitNamespace;
  /**
   * namespace 下的相对名称（不含 namespace 前缀，可含 `/` 分级）
   *
   * 例：
   *   - kernel 下 `computable/file_ops`
   *   - library 下 `lark/doc`
   *   - self 下 `reporter`
   */
  name: string;
  /** trait 还是 view。默认 "trait"，VIEW.md 加载时置为 "view" */
  kind: TraitKind;
  /** Trait 类型（how_to_use_tool / how_to_think / how_to_interact） */
  type: TraitType;
  /** 版本号 */
  version?: string;
  /** 一行摘要（~50字），用于 trait catalog 展示 */
  description: string;
  /** readme.md/TRAIT.md 的文本内容（用作 bias/context window） */
  readme: string;
  /**
   * LLM 沙箱可调用的方法（Phase 2 填充）
   *
   * 来源：index.ts / backend.ts 的 `export const llm_methods`。
   * 调用入口：沙箱 `callMethod(traitId, method, args)`。
   */
  llmMethods?: Record<string, TraitMethod>;
  /**
   * 前端 HTTP 可调用的方法（Phase 2 填充）
   *
   * 来源：index.ts / backend.ts 的 `export const ui_methods`。
   * 调用入口：`POST /api/flows/:sid/objects/:name/call_method`（白名单：self + kind=view + 此表）。
   */
  uiMethods?: Record<string, TraitMethod>;
  /**
   * 依赖的其他 trait
   *
   * 新格式：`namespace:name`（如 `kernel:computable`），或省略 namespace 的 `name`
   * （按 self → kernel → library 解析）。
   */
  deps: string[];
  /** 子 trait 的 ID 列表（树形结构时自动填充） */
  children?: string[];
  /** 父 trait 的 ID（树形结构时自动填充） */
  parent?: string;
  /** trait 目录的绝对路径 */
  dir?: string;
  /** 生命周期 hooks */
  hooks?: { [K in TraitHookEvent]?: TraitHook };
  /** 指令绑定：声明此 trait 在哪些指令执行时被加载（form 模型） */
  commandBinding?: {
    commands: string[];
  };
  /**
   * 反向激活声明：当 form 路径命中以下任一时，激活此 knowledge 的展示形态。
   * - showDescriptionWhen：只展示 description / summary
   * - showContentWhen：展示正文内容，并可进入方法可用的 activatedTraits
   *
   * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
   */
  activatesOn?: {
    showDescriptionWhen?: string[];
    showContentWhen?: string[];
  };
  /** 使用示例（用于 Context 注入） */
  examples?: TraitExample[];
  /** 常见错误对比（正确 vs 错误） */
  common_mistakes?: TraitCommonMistake[];
}

/** Trait 树节点 */
export interface TraitTree {
  /** 完整 trait ID（如 "kernel/computable/output_format"） */
  id: string;
  /** TRAIT.md 的文件系统绝对路径 */
  path: string;
  /** 解析后的 trait 定义 */
  trait: TraitDefinition;
  /** 子 trait 树节点 */
  children: TraitTree[];
  /** 在树中的深度（根 = 0） */
  depth: number;
}
