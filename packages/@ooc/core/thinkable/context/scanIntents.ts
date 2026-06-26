/**
 * scanIntents —— 从 thread.contextWindows 聚合 intents（issue N）。
 *
 * 设计意图（用户原话）：「core 负责产出意图,ooc class 可以基于这个约定来实现基于意图的知识 /
 * 记忆激活匹配」。本函数兑现"协议层职责":遍历 + 聚合 + 去重,不识别任何 class id —— 仅依赖
 * 通用 registry + readable 槽。
 *
 * 流程：
 *   1. 遍历 refs
 *   2. 经 classRegistry.resolveReadable(ref.class) 拿模块、读 `intents?` 供给槽
 *   3. 经 registry.getObject(ref.id) 拿实例 data、make readonly self proxy
 *   4. 调 readable.intents(self) 取 intents 列表
 *   5. 全部并入 Set 去重
 *
 * **stateless**：每轮 thinkloop 重算、无缓存,form close 后自然消失。
 *
 * 性能：典型 thread context 10-20 个 ref,仅 method_exec_form / 少数 class 实现 intents 槽,
 * 其余 readable.intents 缺省 undefined 快返。
 *
 * 设计权威：`.ooc-world-meta/.../children/thinkable/self.md`,issue 2026-06-26-thinkable-knowledge-split。
 */
import type { OocObjectRef } from "../../runtime/ooc-class.js";
import type {
  ClassRegistry,
  ObjectInsRegistry,
} from "../../runtime/object-registry.js";
import { makeReadonlySelfProxy } from "../../runtime/self-proxy.js";

export function scanIntents(
  refs: readonly OocObjectRef[],
  registry: ObjectInsRegistry,
  classRegistry: ClassRegistry,
): Set<string> {
  const out = new Set<string>();
  for (const ref of refs) {
    // **core 兜底**:每条 ref 自动产 `class::<full_id>` + `class::<short_name>`（issue N 三段式
    // 命名空间的 class category）。把"context 中存在该 class 的 window"语义上升为协议层默认契约,
    // 避免每个 class 都要在自己 readable.intents 里重复写。
    //
    // 双重产意图:knowledge md 既支持精确 `class::_builtin/agent/plan` 也支持简称 `class::plan`,
    // 后者便于跨 class 共享语义（如 root window 在多个不同 agent class 下都该命中 `class::root`）。
    out.add(`class::${ref.class}`);
    const short = ref.class.includes("/") ? ref.class.slice(ref.class.lastIndexOf("/") + 1) : ref.class;
    if (short !== ref.class) out.add(`class::${short}`);

    // class 自决 supply (form_open / super_flow / user::* / 自定义)
    const readable = classRegistry.resolveReadable(ref.class);
    if (!readable?.intents) continue;
    const inst = registry.getObject(ref.id);
    // self-view ref / hydrate 落后场景:inst 缺失时 data = {}（与 renderReadable 一致）
    const data = inst?.data ?? {};
    const self = makeReadonlySelfProxy(data as object);
    for (const i of readable.intents(self, ref)) out.add(i);
  }
  return out;
}
