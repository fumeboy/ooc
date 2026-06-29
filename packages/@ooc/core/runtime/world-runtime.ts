import {
  createSerialQueue,
  SerialQueue,
} from "./serial-queue.js";
import {
  createServerLoader,
  ServerLoader,
} from "./server-loader.js";
import {
  createStoneRegistry,
  type StoneRegistry,
} from "./stone-registry.js";
import { createReloadTable, type ReloadTable } from "./reload-table.js";
import { startHotReloadWatcher, type HotReloadWatcher } from "./hot-reload.js";
import {
  registerWorldRuntime,
  unregisterWorldRuntime,
} from "./world-runtime-registry.js";

export interface WorldRuntimeConfig {
  /** 绝对路径的 World 根目录。 */
  worldPath: string;
  /** dev 模式下开启 fs.watch 热更监听。注:stoneRegistry.invalidate → reloadTable 始终监听 (mergeFeatBranch 等显式触发不依赖 dev 模式)。 */
  dev?: boolean;
}

export interface WorldRuntime {
  readonly worldPath: string;
  readonly serialQueue: SerialQueue;
  readonly serverLoader: ServerLoader;
  readonly stoneRegistry: StoneRegistry;
  /** lifecycle on_reload 派发标记表(issue 2026-06-28; ThreadRuntime 经 deps 查)。 */
  readonly reloadTable: ReloadTable;

  dispose(): Promise<void>;
}

/**
 * 创建一个全新的 WorldRuntime 实例。
 *
 * 每个实例持有独立的 observable state / serial queue / server loader / stone registry。
 * 适合在多 world 场景下隔离不同 world 的运行时状态，也方便测试（每 test 一个实例）。
 *
 * StoneRegistry 初始扫描在后台异步执行；若需阻塞等待，调用者可显式
 * `await runtime.stoneRegistry.rescan()`。
 *
 * **`stoneRegistry.invalidate` 监听始终启用** (不论 dev 模式):
 *   - mergeFeatBranch / httpDirectMainWrite 等显式触发的 invalidate 也要 → reloadTable
 *   - 详见 `world-runtime-registry.ts` (C1 dogfood, 2026-06-29)
 *
 * 当 `config.dev === true` 时额外启动 fs.watch hot-reload:
 *   - fs.watch 监听 stones/ + packages/（deprecated fallback）
 *   - 文件变更 → stoneRegistry.invalidate(id, files) → stone:changed 事件
 *   - 利用上面恒在的 listener 自动联动 serverLoader.invalidateStone + reloadTable
 */
export function createWorldRuntime(config: WorldRuntimeConfig): WorldRuntime {
  const serialQueue = createSerialQueue();
  const serverLoader = createServerLoader();
  const stoneRegistry = createStoneRegistry(config.worldPath, { autoDiscover: true });
  const reloadTable = createReloadTable();

  let hotReload: HotReloadWatcher | null = null;
  // stoneRegistry.invalidate 始终监听 (C1 dogfood, 2026-06-29):
  // 不论 dev 模式, mergeFeatBranch / httpDirectMainWrite 等显式 invalidate 都要触发
  // reloadTable + serverLoader.invalidateStone 链。dev 仅决定 fs.watch 是否启用。
  const unsubRegistry = stoneRegistry.on("stone:changed", (ev) => {
    if (ev.kind === "code" || ev.kind === "identity" || ev.kind === "knowledge") {
      void serverLoader.invalidateStone({
        baseDir: config.worldPath,
        objectId: ev.objectId,
      });
      // identity 变体没有 files 字段（field-level event），其他 kind 有
      const files = "files" in ev ? ev.files : undefined;
      reloadTable.registerInvalidation(ev.objectId, files);
    }
  });

  if (config.dev) {
    hotReload = startHotReloadWatcher(config.worldPath, stoneRegistry);
  }

  const runtime: WorldRuntime = {
    worldPath: config.worldPath,
    serialQueue,
    serverLoader,
    stoneRegistry,
    reloadTable,
    async dispose() {
      unregisterWorldRuntime(runtime);
      if (hotReload) {
        hotReload.stop();
        hotReload = null;
      }
      unsubRegistry();
      serverLoader.clearCache();
      serialQueue.reset();
      reloadTable.clear();
    },
  };

  // 注册到 world-runtime-registry, 供 mergeFeatBranch / file-edit 原语跨进程组件通知 (C1)
  registerWorldRuntime(runtime);
  return runtime;
}
