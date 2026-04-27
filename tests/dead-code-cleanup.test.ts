import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf-8");
}

describe("dead code cleanup", () => {
  test("old TOML context parser/renderer files are removed", () => {
    expect(existsSync(join(root, "src/toml/parser.ts"))).toBe(false);
    expect(existsSync(join(root, "src/toml/renderer.ts"))).toBe(false);
    expect(read("package.json")).not.toContain("smol-toml");
  });

  test("context and process compatibility types expose only live fields", () => {
    const contextTypes = read("src/types/context.ts");
    const processTypes = read("src/types/process.ts");
    const typeIndex = read("src/types/index.ts");

    expect(contextTypes).not.toContain("export interface WindowConfig");
    expect(contextTypes).not.toContain("export interface Context {");
    expect(typeIndex).not.toContain("WindowConfig");
    expect(typeIndex).not.toContain("Context,");
    expect(read("src/types/trait.ts")).not.toContain("when?:");
    expect(read("src/types/trait.ts")).not.toContain("methods: TraitMethod[]");

    for (const symbol of ["TodoItem", "Signal", "ThreadState", "HookTime", "HookType", "FrameHook", "NodeType"]) {
      expect(processTypes).not.toContain(symbol);
      expect(typeIndex).not.toContain(symbol);
    }
  });

  test("legacy context and process implementation directories are removed", () => {
    expect(existsSync(join(root, "src/context"))).toBe(false);
    expect(existsSync(join(root, "src/process"))).toBe(false);
    expect(read("src/persistence/process-compat.ts")).toContain("FlowData process compatibility helpers");
  });

  test("low-risk thread/server dead symbols are gone", () => {
    expect(existsSync(join(root, "src/thread/world-adapter.ts"))).toBe(false);
    expect(existsSync(join(root, "src/thread/index.ts"))).toBe(false);
    expect(read("src/executable/tools/schema.ts")).not.toContain("FORM_PARAM");
    expect(read("src/executable/tools/index.ts")).not.toContain("FORM_PARAM");
    expect(read("src/observable/debug/debug.ts")).not.toContain("extractDirectiveTypes");
    expect(read("src/thread/relation.ts")).not.toContain("export function renderRelationsIndexInner");
    expect(read("src/server/server.ts")).not.toContain("hasSupervisorStone");
    expect(read("src/server/server.ts")).not.toContain("_notifySupervisor");
  });

  test("knowledge and library deprecated helpers are removed", () => {
    expect(read("src/extendable/knowledge/reverse-index.ts")).not.toContain("lookupTraitsByPaths");
    expect(read("src/extendable/knowledge/activator.ts")).not.toContain("getChildTraits");
    expect(read("src/extendable/knowledge/index.ts")).not.toContain("getChildTraits");
    expect(read("src/extendable/knowledge/index.ts")).not.toContain("lookupTraitsByPaths");
    expect(read("src/extendable/trait/registry.ts")).not.toContain("getParamDefinition");
    expect(read("src/extendable/trait/registry.ts")).not.toContain("trait.methods");
    expect(read("src/extendable/trait/loader.ts")).not.toContain("legacyMethods");
    expect(read("src/extendable/trait/loader.ts")).not.toContain("loadMethodsFromStructured");
    expect(read("traits/library_index/index.ts")).not.toContain("listLibrarySkills");
    expect(read("traits/library_index/index.ts")).not.toContain("readLibrarySkill");
  });
});
