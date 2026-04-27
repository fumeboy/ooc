/**
 * EffectTracker —— 副作用追踪器
 *
 * 统一追踪沙箱中所有有副作用的 API 调用。
 * 新增 API 时只需声明 effect 格式化函数，无需修改追踪逻辑。
 *
 * @ref docs/哲学文档/gene.md#G4 — implements — 程序执行副作用追踪（effects 反馈给 LLM）
 * @ref docs/哲学文档/gene.md#G8 — references — Effect 概念（对象如何影响世界）
 */

/** 副作用回执格式化函数：接收调用参数和返回值，输出一行回执文本 */
type EffectFormatter = (args: unknown[], result: unknown) => string;

/** 带副作用追踪的 API 注册项 */
interface TrackedAPI {
  /** API 名称（注入到沙箱的 key） */
  name: string;
  /** 实际函数 */
  fn: Function;
  /** 副作用回执格式化函数（无则不追踪） */
  effect?: EffectFormatter;
}

export class EffectTracker {
  /** 副作用回执日志 */
  private _effects: string[] = [];

  /** 获取所有副作用回执 */
  getEffects(): string[] {
    return [...this._effects];
  }

  /** 清空回执 */
  clear(): void {
    this._effects.length = 0;
  }

  /**
   * 包装一个函数，自动追踪副作用
   *
   * @param fn - 原始函数
   * @param effect - 回执格式化函数
   * @returns 包装后的函数（签名不变）
   */
  wrap<T extends Function>(fn: T, effect: EffectFormatter): T {
    const tracker = this;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const result = fn.apply(this, args);
      tracker._effects.push(effect(args, result));
      return result;
    };
    return wrapped as unknown as T;
  }

  /**
   * 批量注册 API 到 context 对象
   *
   * 有 effect 的自动包装追踪，无 effect 的直接注入。
   */
  register(context: Record<string, unknown>, apis: TrackedAPI[]): void {
    for (const api of apis) {
      context[api.name] = api.effect
        ? this.wrap(api.fn, api.effect)
        : api.fn;
    }
  }
}
