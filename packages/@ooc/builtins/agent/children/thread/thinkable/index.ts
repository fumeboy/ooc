/**
 * thread thinkable 模块入口 —— 把 think / scheduler / active / refs 暴露给 core registry。
 *
 * issue E：声明 `active` + `refs`，让 core 的 refcount / GC 通用算法依赖该协议层入口而非
 * thread 形状私域。
 *   - `active`：thread.status ∈ {done, failed} 视为终态，返 false（GC pass1 据此移除）。
 *   - `refs`：返回 thread.contextWindows —— 这就是 thread 对其它 object 的出度引用。
 *
 * issue H：think 签名收敛为 `(data, deps)`；adapter 在入口 fail-loud 断言 deps 必备字段，
 * 解包后调 thinkloop module-level think（thinkloop signature 不变）。
 */
import type { ThinkableModule, ThinkableDeps } from "@ooc/core/types/index.js";
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import type { ReloadTable } from "@ooc/core/runtime/reload-table.js";
import type { ThreadContext } from "../types.js";
import { think } from "./thinkloop.js";

const thinkable: ThinkableModule<ThreadContext> = {
  think: async (data: ThreadContext, deps: ThinkableDeps) => {
    // fail-loud：think 入口必备 deps（reviewer 关键建议——fail-loud 在 adapter 入口最接近 caller）
    if (!deps.worldDir || !deps.onDataEdit) {
      throw new Error("thread.think requires worldDir + onDataEdit in ThinkableDeps");
    }
    const llm = deps.llm as LlmClient;
    const registry = deps.registry as ObjectInsRegistry;
    await think(data, llm, registry, {
      worldDir: deps.worldDir,
      onDataEdit: deps.onDataEdit,
      // wakeSession 不 fail-loud（issue G 已 optional + ThreadRuntime 内 no-op + warn 兜底）
      wakeSession: deps.wakeSession,
      // issue 2026-06-28: reloadTable 可选透传, 缺省 ThreadRuntime 静默跳过 on_reload
      reloadTable: deps.reloadTable as ReloadTable | undefined,
      // S9 (2026-06-29): loop debug 落盘 hook (worker 注入)
      onLoopComplete: deps.onLoopComplete as
        | ((info: { loopIndex: number; input: unknown; output: unknown; meta: Record<string, unknown> }) => Promise<void> | void)
        | undefined,
    });
  },
  active: (data: ThreadContext) => {
    return data.status !== "done" && data.status !== "failed";
  },
  refs: (data: ThreadContext): OocObjectRef[] => {
    return data.contextWindows ?? [];
  },
};

export default thinkable;
export { runScheduler } from "./scheduler.js";
export { think } from "./thinkloop.js";
export { ThreadRuntime } from "../runtime/thread-runtime.js";
