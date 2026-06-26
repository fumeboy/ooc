/**
 * core/runtime/refcount —— object refcount 计算（issue E）。
 *
 * 历史上 refcount 算法位于 thread builtin 私有（thread-runtime.ts.refcountInSession），因为只有
 * thread 形状的对象有 contextWindows 字段（refcount 来源）。issue E 把"哪些 inst 出度引用 X" 的
 * 谓词上提到 ThinkableModule.refs(data)：实现 refs 的 class contributes refcount，其它 class 不
 * 实现即不贡献——thread 通过实现 refs 返 contextWindows 来 contributes，行为与历史等价。
 *
 * **纯函数**：扫一个 session 的全部 inst,对每个 inst 取其 class 的 refs() 计算贡献,统计目标
 * objectId 出现的次数。不读外部状态、不副作用。
 *
 * **self-ref 过滤（issue I）**：遍历时若 `inst.id === objectId` 则跳过该 inst 的 refs 贡献。
 * 这是通用 GC 语义——一个对象自指（如 thread 把自身 self-view ref 挂进自身 contextWindows）
 * 不应让自己永生。否则 issue G 的 unactive GC 会失效（refcount 永远 ≥1）。语义对所有 class 一致、
 * 不限 thread。
 */
import type { ObjectInsRegistry } from "./object-registry.js";

/**
 * 计算一个 session 内某 objectId 当前的 refcount。
 *
 * 算法：遍历该 session 的全部对象实例 → **跳过自指 inst**（inst.id === objectId）→ 对其余
 *      inst 调 `classRegistry.resolveThinkable(inst.class)?.refs?.(inst.data)` → 累加 ref 列表里
 *      `id === objectId` 的次数。
 *
 * 没声明 refs 的 class 视为 0 贡献。同一 inst 内多次引用同一 target → 计为多次（与历史 contextWindows
 * 数组重复元素的语义一致）。
 *
 * 第三个参数 `classRegistry` 在签名上独立 —— 当前 ObjectInsRegistry extends ClassRegistry，故
 * 调用方一般直接传同一个 registry 充当两个角色（也允许传 `ClassRegistry` 测试纯算法）。
 */
export function computeRefcount(
  sessionId: string,
  objectId: string,
  registry: ObjectInsRegistry,
): number {
  let count = 0;
  registry.iterObjects((inst) => {
    // self-ref guard（issue I）：自指边不计入 refcount——
    // 否则 thread 把自身 self-view ref 挂进自身 contextWindows 后永远 refcount ≥1、GC 失效。
    if (inst.id === objectId) return;
    const thinkable = registry.resolveThinkable(inst.class);
    const refs = thinkable?.refs?.(inst.data) ?? [];
    for (const ref of refs) {
      if (ref.id === objectId) count++;
    }
  });
  return count;
}
