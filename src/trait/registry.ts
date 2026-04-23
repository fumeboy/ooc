/**
 * Trait 方法注册表 (G3) — Phase 2 重构版
 *
 * 新协议（硬迁移，无兼容层）：
 * - key = (traitId, methodName, channel)；channel ∈ {llm, ui}
 * - buildSandboxMethods 只暴露 `callMethod(traitIdRaw, methodName, args)` 单函数
 * - 沙箱只能调 llm_methods；ui_methods 由 HTTP /api/.../call_method 端点调（Phase 4）
 * - 支持省略 namespace：按 self → kernel → library 顺序查找
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 方法全量注册（双通道隔离）
 * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md
 * @ref src/types/trait.ts — references — TraitDefinition, TraitMethod, TraitMethodChannel 类型
 */

import type {
  TraitDefinition,
  TraitMethod,
  TraitMethodParam,
  TraitMethodChannel,
} from "../types/index.js";
import { traitId } from "./activator.js";

/** 方法执行上下文（注入到每个 trait 方法中） */
export interface MethodContext {
  /** 当前 Stone 的数据（实时视图，每次访问都读取最新值） */
  readonly data: Record<string, unknown>;
  /** 读取单个数据项（flow.data 优先，fallback stone.data） */
  getData(key: string): unknown;
  /** 设置 Stone 数据 */
  setData(key: string, value: unknown): void;
  /** 输出文本 */
  print(...args: unknown[]): void;
  /** 当前会话 ID */
  readonly sessionId: string;
  /** files/ 目录路径 */
  readonly filesDir: string;
  /** world_dir（用户仓库根目录） */
  readonly rootDir: string;
  /** stones/{name}/（对象自身目录） */
  readonly selfDir: string;
  /** 对象名称 */
  readonly stoneName: string;
  /**
   * 可选：当前线程 ID
   *
   * engine 在沙箱 callMethod 里构造时可以透传；trait 方法里用于 build_hooks
   * 的 feedback 隔离（apply_edits 完成后按 threadId 把 feedback 归档到对应线程）。
   */
  readonly threadId?: string;
  /**
   * 向当前对象的根线程 inbox 写入一条 system 消息
   *
   * 行为：
   * - 写入 root 线程的 inbox（status=unread）
   * - 若 root 线程状态为 done，则自动复活（revival）
   * - 仅在 HTTP call_method 或 UI 方法上下文中可用；LLM 沙箱中通常为 no-op
   *
   * 由调用点（如 HTTP call_method endpoint）显式注入实现。
   *
   * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.6
   */
  notifyThread?(content: string, opts?: { from?: string }): void;
}

/** 注册表中的方法条目 */
export interface RegisteredMethod {
  /** 方法名（不含 traitId） */
  name: string;
  /** 来源 traitId（`namespace:name` 格式） */
  traitName: string;
  /** 方法描述 */
  description: string;
  /** 参数列表 */
  params: TraitMethodParam[];
  /** 实际函数 */
  fn: (...args: unknown[]) => Promise<unknown>;
  /** 函数是否需要 ctx 作为第一个参数 */
  needsCtx: boolean;
  /** 通道：llm（LLM 沙箱） / ui（前端 HTTP） */
  channel: TraitMethodChannel;
}

/** 三元键：`${traitId}::${methodName}::${channel}` */
type RegistryKey = string;

/**
 * 方法注册表（双通道）
 *
 * 同一个 (traitId, methodName) 允许同时在 llm 和 ui 两个通道注册
 * （一个方法被"同时暴露"是允许的；但通常不同的方法被不同通道使用）。
 */
export class MethodRegistry {
  /** 所有注册的方法：(traitId, methodName, channel) → RegisteredMethod */
  private _methods: Map<RegistryKey, RegisteredMethod> = new Map();

  /**
   * 注册一个方法到指定通道
   */
  register(
    traitId: string,
    methodName: string,
    def: TraitMethod,
    channel: TraitMethodChannel,
  ): void {
    const key = this._buildKey(traitId, methodName, channel);
    this._methods.set(key, {
      name: methodName,
      traitName: traitId,
      description: def.description,
      params: def.params,
      fn: def.fn,
      needsCtx: def.needsCtx ?? true,
      channel,
    });
  }

  /**
   * 从一组 Trait 定义批量注册所有方法
   *
   * 注册规则：
   * - trait.llmMethods 中的方法 → llm channel
   * - trait.uiMethods 中的方法 → ui channel
   * - trait.methods（旧数组形式，Phase 2 过渡期）→ llm channel（默认）
   *
   * @param traits - Trait 定义列表
   */
  registerAll(traits: TraitDefinition[]): void {
    this._methods.clear();
    for (const trait of traits) {
      const id = traitId(trait);

      /* llmMethods: Record<name, def> */
      if (trait.llmMethods) {
        for (const [methodName, def] of Object.entries(trait.llmMethods)) {
          this.register(id, methodName, def, "llm");
        }
      }

      /* uiMethods: Record<name, def> */
      if (trait.uiMethods) {
        for (const [methodName, def] of Object.entries(trait.uiMethods)) {
          this.register(id, methodName, def, "ui");
        }
      }

      /* 旧 methods 数组（过渡期，Phase 2 任务 2.3/2.4/2.5 逐个 trait 迁移到 llm_methods 后可删除） */
      if (trait.methods && trait.methods.length > 0) {
        for (const method of trait.methods) {
          /* 不重复注册：若同名方法已通过 llmMethods 注册则跳过 */
          if (this.get(id, method.name, "llm")) continue;
          this.register(id, method.name, method, "llm");
        }
      }
    }
  }

  /**
   * 获取指定方法
   */
  get(
    traitId: string,
    methodName: string,
    channel: TraitMethodChannel,
  ): RegisteredMethod | undefined {
    return this._methods.get(this._buildKey(traitId, methodName, channel));
  }

  /**
   * 获取 ui 通道方法（供 HTTP /call_method 端点快捷使用）
   */
  getUiMethod(traitId: string, methodName: string): RegisteredMethod | undefined {
    return this.get(traitId, methodName, "ui");
  }

  /**
   * 获取所有方法的 (traitId, methodName, channel) 清单
   */
  names(): string[] {
    return Array.from(this._methods.keys());
  }

  /**
   * 获取所有方法
   */
  all(): RegisteredMethod[] {
    return Array.from(this._methods.values());
  }

  /**
   * 构建用于沙箱的方法映射
   *
   * 新协议：只暴露 `callMethod(traitIdRaw, methodName, args)` 单函数。
   * 取消扁平命名（`readFile(...)`）与两段式命名（`trait.method(...)`）。
   *
   * callMethod 解析 traitIdRaw：
   * - 含冒号 → 精确匹配完整 traitId
   * - 不含冒号 → 按 self → kernel → library 顺序查找
   *
   * @param ctx - 方法执行上下文
   * @param _stoneName - 预留参数（后续 Phase 可能用于 self:X 的定向解析）
   * @returns `{ callMethod }`
   */
  buildSandboxMethods(
    ctx: MethodContext,
    _stoneName: string,
  ): { callMethod: (traitIdRaw: string, methodName: string, args?: object) => Promise<unknown> } {
    const callMethod = async (
      traitIdRaw: string,
      methodName: string,
      args: object = {},
    ): Promise<unknown> => {
      const resolvedTraitId = this._resolveTraitId(traitIdRaw);
      const m = resolvedTraitId
        ? this.get(resolvedTraitId, methodName, "llm")
        : undefined;
      if (!m) {
        throw new Error(
          `callMethod: ${traitIdRaw}:${methodName} not found (llm channel)`,
        );
      }
      if (m.needsCtx) {
        return m.fn(ctx, args);
      }
      return m.fn(args);
    };
    return { callMethod };
  }

  /**
   * 获取方法参数定义（供跨对象调用时查询）
   */
  getParamDefinition(
    traitId: string,
    methodName: string,
    channel: TraitMethodChannel = "llm",
  ): TraitMethodParam[] | null {
    const m = this.get(traitId, methodName, channel);
    return m ? m.params : null;
  }

  /* ========== 内部实现 ========== */

  /** 构造三元键 */
  private _buildKey(
    traitId: string,
    methodName: string,
    channel: TraitMethodChannel,
  ): RegistryKey {
    return `${traitId}::${methodName}::${channel}`;
  }

  /**
   * 解析 traitIdRaw 到完整 traitId
   *
   * - 含冒号 → 原样返回（后续 get 未命中则报错）
   * - 不含冒号 → 查看所有已注册方法的 key，找 `{ns}:{raw}::*` 命中的第一个
   *   按优先级 self > kernel > library
   */
  private _resolveTraitId(raw: string): string | null {
    if (raw.includes(":")) return raw;
    for (const ns of ["self", "kernel", "library"] as const) {
      const prefix = `${ns}:${raw}::`;
      for (const key of this._methods.keys()) {
        if (key.startsWith(prefix)) return `${ns}:${raw}`;
      }
    }
    return null;
  }
}
