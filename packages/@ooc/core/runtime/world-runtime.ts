/**
 * WorldRuntime — per-world 运行时状态聚合。
 *
 * M1 (2026-06-02): 把原 module-level singleton 集中封装到一个 WorldRuntime 实例里。
 * M2 (2026-06-03): 追加 stoneRegistry（stones/ 扫描与元数据解析）。
 */
import {
  createObjectRegistry,
  ObjectRegistry,
} from "./object-registry.js";
import {
  createObservableStore,
  ObservableStore,
} from "./observable-store.js";
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
import { startHotReloadWatcher, type HotReloadWatcher } from "./hot-reload.js";

export interface WorldRuntimeConfig {
  /** 绝对路径的 World 根目录。 */
  worldPath: string;
  /** dev 模式下开启热更新（后续阶段使用）。 */
  dev?: boolean;
}

export interface WorldRuntime {
  readonly worldPath: string;
  readonly objects: ObjectRegistry;
  readonly observable: ObservableStore;
  readonly serialQueue: SerialQueue;
  readonly serverLoader: ServerLoader;
  readonly stoneRegistry: StoneRegistry;

  dispose(): Promise<void>;
}

/**
 * 创建一个全新的 WorldRuntime 实例。
 *
 * 每个实例持有独立的 object registry / observable state / serial queue / server loader / stone registry。
 * 适合在多 world 场景下隔离不同 world 的运行时状态，也方便测试（每 test 一个实例）。
 *
 * StoneRegistry 初始扫描在后台异步执行；若需阻塞等待，调用者可显式
 * `await runtime.stoneRegistry.rescan()`。
 *
 * 当 `config.dev === true` 时启动 hot-reload：
 *   - fs.watch 监听 stones/ + packages/（deprecated fallback）
 *   - 文件变更 → stoneRegistry.invalidate(id, files) → stone:changed 事件
 *   - 自动联动 serverLoader.invalidateStone() 使 executable/readable 缓存失效
 */
export function createWorldRuntime(config: WorldRuntimeConfig): WorldRuntime {
  const objects = createObjectRegistry();
  const observable = createObservableStore();
  const serialQueue = createSerialQueue();
  const serverLoader = createServerLoader();
  const stoneRegistry = createStoneRegistry(config.worldPath, { autoDiscover: true });

  let hotReload: HotReloadWatcher | null = null;
  let unsubRegistry: (() => void) | null = null;

  if (config.dev) {
    // 文件变更 → executable/readable loader 缓存失效
    unsubRegistry = stoneRegistry.on("stone:changed", (ev) => {
      if (ev.kind === "code" || ev.kind === "identity" || ev.kind === "knowledge") {
        void serverLoader.invalidateStone({
          baseDir: config.worldPath,
          objectId: ev.objectId,
        });
      }
    });
    hotReload = startHotReloadWatcher(config.worldPath, stoneRegistry);
  }

  const runtime: WorldRuntime = {
    worldPath: config.worldPath,
    objects,
    observable,
    serialQueue,
    serverLoader,
    stoneRegistry,
    async dispose() {
      if (hotReload) {
        hotReload.stop();
        hotReload = null;
      }
      if (unsubRegistry) {
        unsubRegistry();
        unsubRegistry = null;
      }
      serverLoader.clearCache();
      serialQueue.reset();
    },
  };

  return runtime;
}
