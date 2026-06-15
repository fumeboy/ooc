/**
 * WindowPersistence —— WindowManager 的 **persist hook 适配器**（core 框架）。
 *
 * manager 改动 window 后经本适配器刷盘：
 * - `reportDataEdit(objectId)`：某实例 data 改变 → 刷它的 state.json（通用单对象 data IO，
 *   `saveObjectData`，object-model 核心 7 的「自定义 persistable / 系统默认」编织点）。
 * - `reportContextEdit()`：thread context 改变 → 刷 thread-context.json。**thread-context 的序列化
 *   形态是 thread builtin 的逻辑**，经 registry 解析 `_builtin/agent/thread` 的
 *   `persistable.container.writeSnapshot` **委托**——core 不内含 thread 序列化逻辑（persistable
 *   「core=框架+API、builtin=逻辑」边界）。
 *
 * 持 manager 的 **live `instances` Map** 引用，snapshot 时取最新全量；IO 失败 fail-soft（不阻塞 think loop）。
 */
import type { ThreadContext } from "../thinkable/context.js";
import type { OocObjectInstance } from "../runtime/ooc-class.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { THREAD_CLASS_ID } from "../_shared/types/constants.js";
import { saveObjectData } from "./object-data.js";
import { observeWarn } from "../observable/log-aggregator.js";

export class WindowPersistence {
  constructor(
    private readonly registry: ObjectRegistry,
    /** live 引用 manager 的实例表；snapshot 时取最新全量。 */
    private readonly instances: Map<string, OocObjectInstance>,
  ) {}

  /** 把 live 实例 map 的 thread-context 快照落盘（委托 thread builtin 容器逻辑）。 */
  private async writeThreadContextSnapshot(thread: ThreadContext): Promise<void> {
    const container = this.registry.resolvePersistable(THREAD_CLASS_ID)?.container;
    if (!container) {
      observeWarn(
        "WindowPersistence.container-missing",
        `[WindowPersistence] thread 容器持久化未注册（${THREAD_CLASS_ID}）——thread-context 快照跳过。`,
      );
      return;
    }
    await container.writeSnapshot(thread, this.instances, this.registry);
  }

  /**
   * 产出注回 `WindowManager.fromThread(thread, registry, hooks)` 的 hooks。
   * - reportDataEdit(objectId)：某实例 data 改变后刷它的 state.json。
   * - reportContextEdit()：thread context 改变后刷 thread-context.json。
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
        await this.writeThreadContextSnapshot(thread).catch((e) => {
          observeWarn(
            "WindowPersistence.reportContextEdit",
            `[WindowPersistence] writeThreadContext failed: ${(e as Error).message}`,
          );
        });
      },
    };
  }
}
