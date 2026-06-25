/**
 * source-intents —— 按 source-key 维护活跃 intents 集（phase-1 简化版）。
 *
 * 设计目标（issue 2026-06-26-object-guide-method-split 改动 9）：每个产生动态 intents 的来源
 * （主要是 `_builtin/agent/method_exec_form` 实例）以自己的 objectId 作 source-key，refine 后整组替换
 * 该 source 的 intents 集；context 构造期把所有 source 的 intents 合并为 `ActivationContext.activeIntents`
 * 供 trigger `intent::<name>` 求值。
 *
 * **phase-1 简化**：
 * - 进程级单 store（thread-scoped 隔离待 phase-2 引入 source-scope 化）；
 * - context.ts 直接从 thread.contextWindows 扫 form 对象 data.currentIntents 注入；本模块的 API
 *   留作未来 source-key 撤销/分组的扩展点。phase-1 实际工作面由 context.ts 的内联扫描完成；
 *   `setSourceIntents` / `clearSourceIntents` 作为 forward-compatible API 暴露但**当前未挂主路径**。
 *
 * phase-2 目标：context 构造期改读本 store；refine 调 `setSourceIntents`；form 关窗 / unactive 调
 * `clearSourceIntents`；activator 按 source-key 分组激活 / 撤销，避免 form 关后旧 intents 残留。
 */
const store = new Map<string, Set<string>>();

/** 按 source-key 整组替换 intents 集（phase-1 stub；phase-2 上线后 context 构造期读此 store）。 */
export function setSourceIntents(sourceKey: string, intents: readonly string[]): void {
  store.set(sourceKey, new Set(intents));
}

/** 清除某 source-key 的 intents（form 关窗 / unactive 时调）。 */
export function clearSourceIntents(sourceKey: string): void {
  store.delete(sourceKey);
}

/** 合并所有 source-key 的 intents 为扁平集合（phase-2 ActivationContext.activeIntents 数据源）。 */
export function getAllActiveIntents(): Set<string> {
  const out = new Set<string>();
  for (const s of store.values()) for (const i of s) out.add(i);
  return out;
}

/** 取一个 source-key 当前的 intents（debug / test 用）。 */
export function getSourceIntents(sourceKey: string): Set<string> | undefined {
  return store.get(sourceKey);
}

/** 全量重置（test fixture 清理用）。 */
export function resetSourceIntentsStore(): void {
  store.clear();
}
