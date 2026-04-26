/**
 * collectCommandTraits with reverse index + command_binding fallback
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect } from "bun:test";
import { collectCommandTraits } from "../src/thread/hooks.js";
import type { TraitDefinition } from "../src/types/index.js";

function traitOnly(opts: {
  name: string;
  bindings?: string[];
  activates?: string[];
}): TraitDefinition {
  return {
    namespace: "kernel", name: opts.name, kind: "trait", type: "how_to_think",
    version: "1.0.0", when: "never", description: "",
    readme: `# ${opts.name}`, methods: [], deps: [],
    commandBinding: opts.bindings ? { commands: opts.bindings } : undefined,
    activatesOn: opts.activates ? { paths: opts.activates } : undefined,
    dir: `/fake/${opts.name}`,
  };
}

describe("collectCommandTraits prefers activatesOn, falls back to commandBinding", () => {
  test("trait with activatesOn matches via reverse index (prefix-aware)", () => {
    const traits = [traitOnly({ name: "a", activates: ["talk"] })];
    const ids = collectCommandTraits(traits, new Set(["talk.continue"]));
    expect(ids).toEqual(["kernel:a"]);
  });

  test("trait with only commandBinding still matches (back-compat)", () => {
    const traits = [traitOnly({ name: "b", bindings: ["talk"] })];
    const ids = collectCommandTraits(traits, new Set(["talk.continue"]));
    expect(ids).toEqual(["kernel:b"]);
  });

  test("trait with both activates and binding only counted once", () => {
    const traits = [traitOnly({ name: "c", activates: ["talk"], bindings: ["talk"] })];
    const ids = collectCommandTraits(traits, new Set(["talk"]));
    expect(ids).toEqual(["kernel:c"]);
  });

  test("trait with neither activates nor bindings does not match", () => {
    const traits = [traitOnly({ name: "d" })];
    const ids = collectCommandTraits(traits, new Set(["talk"]));
    expect(ids).toEqual([]);
  });

  test("multiple traits: activates and binding mixes counted correctly", () => {
    const traits = [
      traitOnly({ name: "x", activates: ["talk"] }),
      traitOnly({ name: "y", bindings: ["submit"] }),
    ];
    const ids = collectCommandTraits(traits, new Set(["talk.continue", "submit.compact"])).sort();
    expect(ids).toEqual(["kernel:x", "kernel:y"]);
  });
});
