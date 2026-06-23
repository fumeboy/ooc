/**
 * WindowPersistence —— WindowManager 的 **persist hook 适配器**（core 框架）。
 *
 * manager 改动 window 后经本适配器刷盘：
 * - `reportDataEdit(objectId)`：某独立对象 data 改变 → 刷它的 data.json（通用单对象 data IO，
 *   `saveObjectData`，object-model 核心 7 的「自定义 persistable / 系统默认」编织点）。
 * - `reportContextEdit()`：thread context（窗增删 / win 改）改变 → 把 manager 的 live 实例 map
 *   同步进 `thread.contextWindows`，再经 `writeThread`（core seam 派发器）整份落盘。
 *   thread 序列化形态是 thread builtin 的逻辑，`writeThread` 经 `resolvePersistable` seam 派发到其
 *   `saveThread`（thread 自主持久化）——core 不内含也不具名 import thread 序列化逻辑。
 *
 * 持 manager 的 **live `instances` Map** 引用，snapshot 时取最新全量；IO 失败 fail-soft（不阻塞 think loop）。
 */
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import type { OocObjectRef } from "./ooc-class.js";
import type { ObjectRegistry } from "./object-registry.js";
import { saveObjectData } from "../persistable/object-data.js";
import { saveObject } from "@ooc/core/persistable/runtime-object-io.js";
import { observeWarn } from "../observable/log-aggregator.js";

export class WindowPersistence {
  constructor(
    private readonly registry: ObjectRegistry,
    /** live 引用 manager 的实例表；snapshot 时取最新全量。 */
    private readonly instances: Map<string, OocObjectRef>,
  ) {}

  /**
   * 产出注回 `WindowManager.fromThread(thread, registry, hooks)` 的 hooks。
   * - reportDataEdit(objectId)：某独立对象 data 改变后刷它的 data.json。
   * - reportContextEdit()：thread context 改变后整份 writeThread（先把 live 实例 map 同步进
   *   thread.contextWindows，确保落盘是最新窗，不依赖调用方 toData() 回写时序）。
   */
  hooksFor(thread: ThreadContext): {
    reportDataEdit: (objectId: string) => Promise<void>;
    reportContextEdit: () => Promise<void>;
  } {
    return {
      reportDataEdit: async (objectId: string) => {
        const inst = this.instances.get(objectId);
        if (!inst) return;
        await saveObjectData(this.registry, thread, inst);
      },
      reportContextEdit: async () => {
        // manager 的 live 实例 map 是窗状态权威；同步进 thread.contextWindows 后整份落盘。
        thread.contextWindows = Array.from(this.instances.values());
        await saveObject(thread, this.registry).catch((e) => {
          observeWarn(
            "WindowPersistence.reportContextEdit",
            `[WindowPersistence] writeThread failed: ${(e as Error).message}`,
          );
        });
      },
    };
  }
}
