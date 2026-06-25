/**
 * thread thinkable 模块入口 —— 把 think / scheduler 暴露给 core registry。
 */
import type { ThinkableModule, ThinkableDeps } from "@ooc/core/types/index.js";
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class.js";
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
};

export default thinkable;
export { runScheduler } from "./scheduler.js";
export { think } from "./thinkloop.js";
export { ThreadRuntime } from "../runtime/thread-runtime.js";
