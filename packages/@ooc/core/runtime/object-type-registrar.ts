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
import { resolveStoneDir } from "../persistable/index.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { StoneObjectRef } from "../executable/server/types.js";

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
      const parentClass = await this.resolveParentClass(windowDef, stoneRef);

      // registerObjectType = merge into existing; registerNewObjectType = create new
      if (this.deps.registry.has(objectId)) {
        this.deps.registry.registerObjectType(objectId as any, {
          commands: windowDef?.commands,
          methods: windowDef?.commands,
          renderXml: windowDef?.renderXml,
          readable: windowDef?.readable,
          onClose: windowDef?.onClose,
          basicKnowledge:
            typeof windowDef?.basicKnowledge === "string"
              ? windowDef.basicKnowledge
              : undefined,
          parentClass,
        });
      } else {
        this.deps.registry.registerNewObjectType(objectId as any, {
          commands: windowDef?.commands ?? {},
          methods: windowDef?.commands ?? {},
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
            commands: {},
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
   * Resolve parentClass with the same priority used by ensureSelfObjectTypeRegistered:
   *  executable/index.ts parentClass > executable/index.ts prototype (@deprecated)
   *  > self.md frontmatter prototype.
   */
  private async resolveParentClass(
    windowDef: { parentClass?: string; prototype?: string } | undefined,
    stoneRef: StoneObjectRef,
  ): Promise<string | undefined> {
    if (windowDef?.parentClass !== undefined) return windowDef.parentClass;
    if (windowDef?.prototype !== undefined) return windowDef.prototype;
    try {
      const stoneDir = await resolveStoneDir(stoneRef);
      const selfPath = join(stoneDir, "self.md");
      const content = await readFile(selfPath, "utf-8");
      // Minimal frontmatter parser: look for `prototype: <name>` in the YAML block
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const protoMatch = fmMatch[1].match(
          /^\s*prototype\s*:\s*["']?([^\s"']+)["']?\s*$/m,
        );
        if (protoMatch) return protoMatch[1];
      }
    } catch {
      // self.md missing or unreadable — no prototype
    }
    return undefined;
  }
}

export function createObjectTypeRegistrar(
  deps: ObjectTypeRegistrarDeps,
): ObjectTypeRegistrar {
  return new ObjectTypeRegistrar(deps);
}
