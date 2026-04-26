/**
 * Frontmatter `activates_on.paths` 解析测试
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrait } from "../src/trait/loader.js";

describe("loader parses activates_on.paths", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "act-on-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("trait with activates_on.paths is parsed", async () => {
    const traitDir = join(dir, "talkable");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: kernel
name: talkable
type: how_to_interact
version: 1.0.0
when: never
activates_on:
  paths: ["talk", "submit.talk"]
description: test
deps: []
---

# talkable
`);
    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.activatesOn?.paths).toEqual(["talk", "submit.talk"]);
  });

  test("trait without activates_on has activatesOn === undefined", async () => {
    const traitDir = join(dir, "plain");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: kernel
name: plain
type: how_to_interact
version: 1.0.0
when: never
description: test
deps: []
---

# plain
`);
    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.activatesOn).toBeUndefined();
  });

  test("malformed activates_on (e.g. paths missing) yields undefined", async () => {
    const traitDir = join(dir, "bad");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: kernel
name: bad
type: how_to_interact
version: 1.0.0
when: never
activates_on:
  not_paths: ["talk"]
description: test
deps: []
---

# bad
`);
    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.activatesOn).toBeUndefined();
  });
});
