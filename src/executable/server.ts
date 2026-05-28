/**
 * Object server 类型：定义 method body 接收/返回的契约。
 *
 * 详见 spec §3.6 (方法可见性 vs 调用边界) + §3.1 (统一调用形式)。
 */

import type { ObjectRecord } from "../persistable/object-record";

/**
 * Method 调用时传给 body 的运行时上下文。
 *
 * - record: 被调方法所属 Object 的 record（含三层 paths）
 * - worldRoot: world 根目录绝对路径
 * - sessionId: 当前活跃 session id（除离线场景外应总有值）
 * - registry: 反向引用 ObjectRegistry，允许 method 内部查询其他 Object（如 talk 找 peer）
 */
export type ObjectContext = {
    record: ObjectRecord;
    worldRoot: string;
    sessionId?: string;
    registry: import("./registry").ObjectRegistry;
};

/**
 * 单个方法的签名：接 args + ctx → 异步结果。
 *
 * args 类型留给具体方法声明 (`args: any` 这里是最 permissive)；实际方法应自己定义具体 args 类型。
 */
export type ServerMethod<TArgs = unknown, TResult = unknown> = (
    args: TArgs,
    ctx: ObjectContext,
) => Promise<TResult>;

/**
 * Object 自定义的 method 集合，按 public / private 分组。
 *
 * public: LLM 看见 + 可通过 emit action 调用 + 跨 Object 可调用
 * private: 只允许同 Object 内部 method body 调用（参 spec §3.6 矩阵）
 */
export type ServerMap = {
    public: Record<string, ServerMethod>;
    private: Record<string, ServerMethod>;
};

/**
 * defineObject: 类型守卫的便捷构造函数，让 server/index.ts 写法清晰。
 *
 * 用法：
 * ```ts
 * import { defineObject } from "@src/executable/server";
 *
 * export default defineObject({
 *   public: {
 *     async talk(args, ctx) { ... },
 *   },
 *   private: {
 *     async _helper(args, ctx) { ... },
 *   },
 * });
 * ```
 */
export function defineObject(map: ServerMap): ServerMap {
    return map;
}

/**
 * Method 不存在时统一错误类型。
 */
export class MethodNotFoundError extends Error {
    constructor(public methodName: string, public objectUri: string) {
        super(`Method "${methodName}" not found on Object ${objectUri}`);
        this.name = "MethodNotFoundError";
    }
}

/**
 * 调用 public method 但对方法 private 的错误。
 */
export class MethodNotPublicError extends Error {
    constructor(public methodName: string, public objectUri: string) {
        super(`Method "${methodName}" is private and not invokable from outside on Object ${objectUri}`);
        this.name = "MethodNotPublicError";
    }
}
