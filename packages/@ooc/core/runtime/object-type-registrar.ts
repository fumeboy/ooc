/**
 * ObjectTypeRegistrar — startup-time registration of stone-backed object types.
 *
 * P1 (2026-06-03): bridges the gap between stoneRegistry (discovers stones) and
 * ObjectRegistry (holds type definitions). Scans all known stones, loads their
 * executable/readable definitions via ServerLoader, and registers them into the
 * per-world ObjectRegistry — so render-time lazy registration
 * (ensureSelfObjectTypeRegistered / derivePeerObjectWindows in synthesizer.ts)
 * becomes a fallback instead of the primary path.
 *
 * Async design: start() kicks off the registration scan in the background and
 * returns a ready Promise. Callers who want to block can await it; callers who
 * don't (the default server startup path) proceed immediately and the registry
 * fills in concurrently. Render paths already handle unregistered types gracefully.
 *
 * Fail-soft everywhere: a single stone failing to load/register never aborts the
 * world startup — we warn and continue.
 */
import type { ServerLoader } from "./server-loader.js";
import type { StoneDefinition, StoneRegistry } from "./stone-registry.js";
import type { ObjectRegistry } from "./object-registry.js";
import type { StoneObjectDeclaration, StoneObjectRef } from "../executable/object/types.js";

export interface ObjectTypeRegistrarDeps {
  readonly worldPath: string;
  readonly registry: ObjectRegistry;
  readonly loader: ServerLoader;
  readonly stones: StoneRegistry;
}

export class ObjectTypeRegistrar {
  private ready: Promise<void> | null = null;

  constructor(private readonly deps: ObjectTypeRegistrarDeps) {}

  /**
   * Kick off background registration of all known stones.
   * Returns a Promise that resolves when registration finishes.
   * Idempotent — calling start() multiple times returns the same Promise.
   */
  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.run().catch((err) => {
      console.warn("[ObjectTypeRegistrar] run failed:", err);
    });
    return this.ready;
  }

  /** Resolves when the initial registration pass is done. */
  get done(): Promise<void> {
    return this.ready ?? Promise.resolve();
  }

  /**
   * Register a single stone by objectId. Used by hot-reload on stone:changed,
   * and as the unit-of-work inside run().
   */
  async registerStone(objectId: string): Promise<void> {
    const def = this.deps.stones.getDef(objectId);
    if (!def) return;
    // user is a passive object with no executable; don't try to load it
    if (objectId === "user") return;

    const stoneRef: StoneObjectRef = { baseDir: this.deps.worldPath, objectId };
    try {
      const windowDef = await this.deps.loader.loadObjectWindow(stoneRef);
      const parentClass = this.resolveParentClass(windowDef, def);
      // `_builtin/<id>` 框架 class（如 supervisor）无 world executable —— 注册为空 methods
      // 隐式继承 root，让 instance 的 parentClass 链不断在未注册的 class 上。
      if (
        typeof parentClass === "string" &&
        parentClass.startsWith("_builtin/") &&
        !this.deps.registry.has(parentClass)
      ) {
        this.deps.registry.registerNewObjectType(parentClass as any, { methods: {} });
      }

      // 已存在 type → 按维度分别 merge（executable / readable）；新 type → registerNewObjectType 一次创建。
      const mergedMethods = { ...(windowDef?.methods ?? {}) };
      if (this.deps.registry.has(objectId)) {
        this.deps.registry.registerExecutable(objectId as any, {
          methods: mergedMethods,
          parentClass,
        });
        this.deps.registry.registerReadable(objectId as any, {
          renderXml: windowDef?.renderXml,
          readable: windowDef?.readable,
          onClose: windowDef?.onClose,
          basicKnowledge:
            typeof windowDef?.basicKnowledge === "string"
              ? windowDef.basicKnowledge
              : undefined,
        });
      } else {
        this.deps.registry.registerNewObjectType(objectId as any, {
          methods: mergedMethods,
          renderXml: windowDef?.renderXml,
          readable: windowDef?.readable,
          onClose: windowDef?.onClose,
          basicKnowledge:
            typeof windowDef?.basicKnowledge === "string"
              ? windowDef.basicKnowledge
              : undefined,
          parentClass,
        });
      }
    } catch (err) {
      console.debug(
        `[ObjectTypeRegistrar] stone=${objectId} register error: ${
          (err as Error).message
        }`,
      );
      // Fail-soft: register minimal placeholder so render doesn't throw
      if (!this.deps.registry.has(objectId)) {
        try {
          this.deps.registry.registerNewObjectType(objectId as any, {
            methods: {},
          });
        } catch {
          // Already registered by a concurrent pass — ignore
        }
      }
    }
  }

  // ── private ────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    // Ensure stoneRegistry has done its initial scan. rescan() is idempotent.
    await this.deps.stones.rescan();

    const stones = this.deps.stones.list();
    if (stones.length === 0) {
      return;
    }

    // Register concurrently — stones are independent
    await Promise.all(
      stones.map((s) => this.registerStone(s.objectId)),
    );
  }

  /**
   * Resolve parentClass：executable `export const window` 的 `parentClass` 覆盖优先，
   * 否则取 stone `package.json` 的权威继承声明 `ooc.class`。缺省 undefined → 隐式继承 root。
   */
  private resolveParentClass(
    windowDef: StoneObjectDeclaration | undefined,
    def: StoneDefinition,
  ): string | null | undefined {
    if (windowDef?.parentClass !== undefined) return windowDef.parentClass;
    return def.oocMetadata?.class;
  }
}

export function createObjectTypeRegistrar(
  deps: ObjectTypeRegistrarDeps,
): ObjectTypeRegistrar {
  return new ObjectTypeRegistrar(deps);
}
