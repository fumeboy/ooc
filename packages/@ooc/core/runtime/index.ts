/**
 * Per-world runtime subsystem.
 *
 * 把原 module-level singleton 重构成可实例化的类，按 World 聚合：
 * stoneRegistry / serverLoader / observable / serialQueue。
 *
 * 所有 per-world 状态都通过 `WorldRuntime` 访问：
 *   const runtime = createWorldRuntime({ worldPath });
 *   runtime.stoneRegistry.rescan();
 *   runtime.observable.enableDebug();
 *
 * object 类型注册不在此聚合：think/exec/render 经全局 builtinRegistry，world stone
 * 的对象类型由渲染期 thinkable/context/object-windows.ts 的 lazy ensure 注册。
 *
 * 过渡期：module-level 默认实例（defaultObservableStore /
 * defaultSerialQueue / defaultServerLoader）继续存在，保持向后兼容。
 */
export { createWorldRuntime } from "./world-runtime.js";
export type { WorldRuntime, WorldRuntimeConfig } from "./world-runtime.js";

export { createObjectRegistry, builtinRegistry, filterMethodsByVisibility } from "./object-registry.js";
export type { ObjectRegistry } from "./object-registry.js";

export { createObservableStore, defaultObservableStore } from "./observable-store.js";
export type {
  ObservableStore,
  LlmObservation,
  LlmLoopHandle,
  ObservableDebugStatus,
  PauseChecker,
  RuntimePermissionDecision,
  RuntimePendingToolCall,
  RuntimePermissionDecider,
  ThreadActivationRef,
  ThreadActivationNotifier,
} from "./observable-store.js";

export { createSerialQueue, defaultSerialQueue } from "./serial-queue.js";
export type { SerialQueue } from "./serial-queue.js";

export { createServerLoader, defaultServerLoader } from "./server-loader.js";
export type { ServerLoader } from "./server-loader.js";

export { createStoneRegistry } from "./stone-registry.js";
export type { StoneRegistry, StoneDefinition, StoneKind, StoneChangedEvent } from "./stone-registry.js";

export { startHotReloadWatcher, parseStoneChange } from "./hot-reload.js";
export type { HotReloadWatcher, HotReloadOptions } from "./hot-reload.js";
