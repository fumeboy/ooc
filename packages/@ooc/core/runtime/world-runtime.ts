/**
 * WorldRuntime — per-world 运行时状态聚合。
 *
 * M1 (2026-06-02): 把原 module-level singleton 集中封装到一个 WorldRuntime 实例里。
 * M2 (2026-06-03): 追加 stoneRegistry（stones/ 扫描与元数据解析）。
 */
import {
  builtinRegistry,
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
import {
  createObjectTypeRegistrar,
  ObjectTypeRegistrar,
} from "./object-type-registrar.js";

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
  /** Resolves when the startup object-type registration pass is done. */
  readonly typeRegistration: Promise<void>;

  /**
   * 显式注册（或刷新）一个运行时新建/改动的 stone 的 type 定义。
   * API 写路径（createStone / putServerSource）调用——不依赖 dev-only 的 hot-reload fs.watch，
   * 让非 dev server 里运行时创建的对象也能立即被其它对象的 think 上下文用上（修 collaborable
   * 惰性注册 / programmable 自写方法 prod 不 re-register）。先 rescan 让 stoneRegistry 认得新 stone，再注册。
   */
  registerStone(objectId: string): Promise<void>;

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
  // Seed builtin type definitions (root, file, plan, etc.) from the module-level
  // builtinRegistry. Builtins register themselves via side-effect imports.
  objects.seedFrom(builtinRegistry);
  const observable = createObservableStore();
  const serialQueue = createSerialQueue();
  const serverLoader = createServerLoader();
  const stoneRegistry = createStoneRegistry(config.worldPath, { autoDiscover: true });
  const registrar = createObjectTypeRegistrar({
    worldPath: config.worldPath,
    registry: objects,
    loader: serverLoader,
    stones: stoneRegistry,
  });
  // P1: kick off background registration of stone-backed types.
  // Callers who want to block can await runtime.typeRegistration.
  const typeRegistration = registrar.start();

  let hotReload: HotReloadWatcher | null = null;
  let unsubRegistry: (() => void) | null = null;
  let unsubRegistrarHotReload: (() => void) | null = null;

  if (config.dev) {
    // 文件变更 → executable/readable loader 缓存失效
    unsubRegistry = stoneRegistry.on("stone:changed", (ev) => {
      if (ev.kind === "code" || ev.kind === "identity" || ev.kind === "knowledge") {
        void serverLoader.invalidateStone({
          baseDir: config.worldPath,
          objectId: ev.objectId,
        });
        // Hot-reload: re-register the changed stone's type definition
        void registrar.registerStone(ev.objectId);
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
    typeRegistration,
    async registerStone(objectId: string) {
      // rescan 让 stoneRegistry 认得运行时新建的 stone（registrar.registerStone 内部 getDef 才不为空），
      // 再注册其 type 定义进 ObjectRegistry。invalidate loader 缓存以拿到最新 self/server。
      await stoneRegistry.rescan();
      serverLoader.invalidateStone({ baseDir: config.worldPath, objectId });
      await registrar.registerStone(objectId);
    },
    async dispose() {
      if (hotReload) {
        hotReload.stop();
        hotReload = null;
      }
      if (unsubRegistry) {
        unsubRegistry();
        unsubRegistry = null;
      }
      if (unsubRegistrarHotReload) {
        unsubRegistrarHotReload();
        unsubRegistrarHotReload = null;
      }
      serverLoader.clearCache();
      serialQueue.reset();
    },
  };

  return runtime;
}
