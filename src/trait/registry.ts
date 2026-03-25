/**
 * Trait 方法注册表 (G3)
 *
 * 管理所有 Trait 方法的注册。
 * 关键规则：方法注册是全量的，不受 Trait 激活状态影响。
 * 因为 trait 的方法可能被其他对象调用或被自身其他方法依赖。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G3 — implements — Trait 方法全量注册（不受激活影响）
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
  /** shared/ 目录路径 */
  readonly sharedDir: string;
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
   * @param ctx - 方法执行上下文
   * @returns 方法名 → 包装后的函数
   */
  buildSandboxMethods(ctx: MethodContext): Record<string, (...args: unknown[]) => Promise<unknown>> {
    const result: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

    for (const [name, method] of this._methods) {
      result[name] = method.needsCtx
        ? async (...args: unknown[]) => method.fn(ctx, ...args)
        : async (...args: unknown[]) => method.fn(...args);
    }

    return result;
  }

  /**
   * 获取方法参数定义（供跨对象调用时查询）
   */
  getParamDefinition(methodName: string): TraitMethodParam[] | null {
    const method = this._methods.get(methodName);
    return method ? method.params : null;
  }
}
