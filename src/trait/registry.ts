/**
 * Trait 方法注册表 (G3)
 *
 * 管理所有 Trait 方法的注册。
 * 关键规则：方法注册是全量的（registerAll 注册所有 trait 的方法）。
 * 但 buildSandboxMethods 支持按 activatedTraits 过滤，只注入已激活 trait 的方法到沙箱。
 * 这确保对象只能调用自己有权限的工具，同时保留全量注册以支持跨 trait 方法依赖。
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 方法全量注册（不受激活影响）
 * @ref src/types/trait.ts — references — TraitDefinition, TraitMethod, TraitMethodParam 类型
 */

import type { TraitDefinition, TraitMethod, TraitMethodParam } from "../types/index.js";

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
  /** 当前任务 ID */
  readonly taskId: string;
  /** files/ 目录路径 */
  readonly filesDir: string;
  /** world_dir（用户仓库根目录） */
  readonly rootDir: string;
  /** stones/{name}/（对象自身目录） */
  readonly selfDir: string;
  /** 对象名称 */
  readonly stoneName: string;
}

/** 注册表中的方法条目 */
export interface RegisteredMethod {
  /** 方法名 */
  name: string;
  /** 来源 trait */
  traitName: string;
  /** 方法描述 */
  description: string;
  /** 参数列表 */
  params: TraitMethodParam[];
  /** 实际函数 */
  fn: (...args: unknown[]) => Promise<unknown>;
  /** 函数是否需要 ctx 作为第一个参数 */
  needsCtx: boolean;
}

/** 方法注册表 */
export class MethodRegistry {
  /** 所有注册的方法：methodName → RegisteredMethod */
  private _methods: Map<string, RegisteredMethod> = new Map();

  /**
   * 从 Trait 列表注册所有方法
   *
   * @param traits - Trait 定义列表
   */
  registerAll(traits: TraitDefinition[]): void {
    this._methods.clear();
    for (const trait of traits) {
      for (const method of trait.methods) {
        this._methods.set(method.name, {
          name: method.name,
          traitName: trait.name,
          description: method.description,
          params: method.params,
          fn: method.fn,
          needsCtx: method.needsCtx ?? true,
        });
      }
    }
  }

  /**
   * 获取指定方法
   */
  get(name: string): RegisteredMethod | undefined {
    return this._methods.get(name);
  }

  /**
   * 获取所有方法名
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
   * 将注册的方法包装为 (ctx: MethodContext, ...args) → result 的形式，
   * 返回可以直接注入到执行上下文中的函数映射。
   *
   * 调用方式：`traitName.methodName()`（两段式，避免命名冲突）
   *
   * @param ctx - 方法执行上下文
   * @param activatedTraits - 已激活的 trait 名称列表。只注入这些 trait 的方法。
   * @returns 嵌套结构：{ traitName: { methodName: function, ... } }
   */
  buildSandboxMethods(
    ctx: MethodContext,
    activatedTraits: string[],
  ): Record<string, unknown> {
    /* 嵌套映射：{ traitName: { methodName: function, ... } }（两段式调用） */
    const nested: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};

    const filterSet = new Set(activatedTraits);

    for (const [name, method] of this._methods) {
      if (!filterSet.has(method.traitName)) continue;

      const wrapped = method.needsCtx
        ? async (...args: unknown[]) => method.fn(ctx, ...args)
        : async (...args: unknown[]) => method.fn(...args);

      /* 两段式调用：traitName.methodName */
      if (!nested[method.traitName]) {
        nested[method.traitName] = {};
      }
      nested[method.traitName]![name] = wrapped;
    }

    return nested;
  }

  /**
   * 获取方法参数定义（供跨对象调用时查询）
   */
  getParamDefinition(methodName: string): TraitMethodParam[] | null {
    const method = this._methods.get(methodName);
    return method ? method.params : null;
  }
}
