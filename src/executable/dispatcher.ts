/**
 * Dispatcher: method 调用统一入口。
 *
 * 按 ObjectRecord URI 查 record，沿 prototype 链找对应 method body，调用并返回结果。
 *
 * 详见 spec §3.1。
 */

import type { ObjectContext, ServerMethod } from "./server";
import { MethodNotFoundError, MethodNotPublicError } from "./server";
import type { ObjectRegistry } from "./registry";
import { findInChain, resolveChain } from "./prototype-resolver";

/**
 * 调用 targetUri 上的 public method。
 *
 * - 找 method body: 沿 extends 链查 serverPublic[methodName]，找到第一个就用
 * - 若 method body 被 private map 持有但 public 没有 → MethodNotPublicError
 * - 都找不到 → MethodNotFoundError
 *
 * @param registry Object 注册表
 * @param targetUri 被调对象 URI
 * @param methodName 方法名
 * @param args 方法 args
 * @param baseCtx 调用上下文（除 record 外其他字段需提供）
 */
export async function invokeMethod(
    registry: ObjectRegistry,
    targetUri: string,
    methodName: string,
    args: unknown,
    baseCtx: Omit<ObjectContext, "record">,
): Promise<unknown> {
    const targetRecord = registry.get(targetUri);
    if (!targetRecord) {
        throw new Error(`Object not registered: ${targetUri}`);
    }

    // 先在链上找 public method
    const ownerUri = findInChain(registry, targetUri, (r) =>
        Boolean(r.serverPublic && methodName in r.serverPublic),
    );

    if (!ownerUri) {
        // 检查是否是 private 方法 (沿链查 serverPrivate)
        const privateOwner = findInChain(registry, targetUri, (r) =>
            Boolean(r.serverPrivate && methodName in r.serverPrivate),
        );
        if (privateOwner) {
            throw new MethodNotPublicError(methodName, targetUri);
        }
        throw new MethodNotFoundError(methodName, targetUri);
    }

    const ownerRecord = registry.get(ownerUri)!;
    const method = ownerRecord.serverPublic![methodName] as ServerMethod;
    const ctx: ObjectContext = {
        ...baseCtx,
        record: targetRecord,    // 注意: ctx.record 是被调对象（target），不是 method 的拥有者(prototype 祖先)
    };
    return await method(args, ctx);
}

/**
 * 调用 target Object 自身的 private method（仅同 Object server 内部 + sub-thread 共享 owner 身份场景）。
 *
 * 严格：private 不沿链查；只在 targetUri 自身的 serverPrivate 找。
 */
export async function invokePrivateMethod(
    registry: ObjectRegistry,
    targetUri: string,
    methodName: string,
    args: unknown,
    baseCtx: Omit<ObjectContext, "record">,
): Promise<unknown> {
    const record = registry.get(targetUri);
    if (!record) {
        throw new Error(`Object not registered: ${targetUri}`);
    }
    const priv = record.serverPrivate;
    if (!priv || !(methodName in priv)) {
        throw new MethodNotFoundError(methodName, targetUri);
    }
    const method = priv[methodName] as ServerMethod;
    const ctx: ObjectContext = { ...baseCtx, record };
    return await method(args, ctx);
}

/**
 * 返回 target Object 在 prototype 链上可见的所有 public method 名（去重，链顺序保留先于祖先）。
 * 用于 LLM context surface 渲染。
 */
export function listPublicMethods(
    registry: ObjectRegistry,
    targetUri: string,
): string[] {
    const chain = resolveChain(registry, targetUri);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const uri of chain) {
        const record = registry.get(uri);
        if (!record?.serverPublic) continue;
        for (const name of Object.keys(record.serverPublic)) {
            if (!seen.has(name)) {
                seen.add(name);
                names.push(name);
            }
        }
    }
    return names;
}
