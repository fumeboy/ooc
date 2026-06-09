/**
 * Per-world runtime subsystem.
 *
 * M1 (2026-06-02): 把原 module-level singleton 重构成可实例化的类，按 World 聚合。
 * M2 (2026-06-03): 增加 stoneRegistry。
 * P1 (2026-06-03): 增加 ObjectTypeRegistrar，启动期注册 stone-backed object types。
 *
 * 长期所有 per-world 状态都通过 `WorldRuntime` 访问：
 *   const runtime = await createWorldRuntime({ worldPath });
 *   runtime.objects.registerExecutable(...); // + registerReadable(...) 按维度注册
 *   runtime.observable.enableDebug();
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

export { createObjectTypeRegistrar, ObjectTypeRegistrar } from "./object-type-registrar.js";
export type { ObjectTypeRegistrarDeps } from "./object-type-registrar.js";
