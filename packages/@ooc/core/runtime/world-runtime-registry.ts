/**
 * world-runtime-registry — 进程级 WorldRuntime 实例注册表 (C1 dogfood, 2026-06-29)。
 *
 * **设计权威 / 动机**: reflectable feat-branch PR merge 后 (mergeFeatBranch),
 * 需要让**所有正在跑的 WorldRuntime 实例** (内含 reloadTable + stoneRegistry)
 * 都被通知 stone 已变,触发 lifecycle.on_reload 派发。
 *
 * 设计选择:进程内 WeakRef Set + 生命周期挂在 createWorldRuntime / dispose:
 * - createWorldRuntime 时自动注册 (WeakRef 不阻 GC)
 * - dispose 时显式移除
 * - notifyAllWorldRuntimes(baseDir, objectId, files?) 遍历所有活实例,只通知 baseDir 匹配的
 *   (避免跨 world 的 stone 变更被误触发)
 *
 * 这个 registry 是 collaborable 跨进程组件互通的常用模式,避免 mergeFeatBranch 内
 * dynamic import 单例 serverLoader (单例与 createWorldRuntime per-instance 不一致)。
 *
 * **同进程多 world**:OOC 支持 (测试场景多 server),本 registry 用 baseDir 区分。
 */
import type { WorldRuntime } from "./world-runtime.js";

const instances = new Set<WeakRef<WorldRuntime>>();

/** 注册 WorldRuntime 实例。createWorldRuntime 内调用。 */
export function registerWorldRuntime(rt: WorldRuntime): void {
  instances.add(new WeakRef(rt));
}

/** 取消注册 WorldRuntime 实例。dispose 内调用。 */
export function unregisterWorldRuntime(rt: WorldRuntime): void {
  for (const ref of instances) {
    const r = ref.deref();
    if (r === rt || r === undefined) {
      instances.delete(ref);
    }
  }
}

/**
 * 通知所有匹配 baseDir 的 WorldRuntime 实例:某 stone class 变了。
 *
 * 实现:遍历所有活 WorldRuntime → 经 stoneRegistry.invalidate 触发 stone:changed event
 * → WorldRuntime 内 listener 写 reloadTable + serverLoader.invalidateStone。
 *
 * **典型调用方**:
 * - mergeFeatBranch (issue D): PR ff-merge 后通知 reloadTable
 * - httpDirectMainWrite (S1 file-edit 原语): 人类直写 main 后同步通知
 */
export async function notifyAllWorldRuntimes(
  baseDir: string,
  objectId: string,
  files?: string[],
): Promise<void> {
  for (const ref of [...instances]) {
    const rt = ref.deref();
    if (!rt) {
      instances.delete(ref);
      continue;
    }
    if (rt.worldPath !== baseDir) continue;
    try {
      rt.stoneRegistry.invalidate(objectId, files ?? ["package.json"]);
    } catch {
      // best-effort: 单实例失败不影响其他
    }
  }
}

/** 测试用 — 清空 registry。 */
export function clearWorldRuntimeRegistry(): void {
  instances.clear();
}
