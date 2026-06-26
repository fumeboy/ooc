/**
 * thread thinkable 模块入口 —— 把 think / scheduler / active / refs 暴露给 core registry。
 *
 * issue E：声明 `active` + `refs`，让 core 的 refcount / GC 通用算法依赖该协议层入口而非
 * thread 形状私域。
 *   - `active`：thread.status ∈ {done, failed} 视为终态，返 false（GC pass1 据此移除）。
 *   - `refs`：返回 thread.contextWindows —— 这就是 thread 对其它 object 的出度引用。
 */
import type { ThinkableModule, ThinkableDeps } from "@ooc/core/types/index.js";
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectInstance, OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectInsRegistry } from "@ooc/core/runtime/object-registry.js";
import type { ThreadContext } from "../types.js";
import { think } from "./thinkloop.js";

const thinkable: ThinkableModule<ThreadContext> = {
  think: async (instance: OocObjectInstance<ThreadContext>, deps: ThinkableDeps) => {
    await think(
      instance.data,
      deps.llm as LlmClient,
      deps.registry as ObjectInsRegistry,
    );
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
