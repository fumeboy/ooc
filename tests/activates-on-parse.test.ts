/**
 * Frontmatter `activates_on.show_*_when` 解析测试
 *
 * @ref docs/superpowers/specs/2026-04-26-refine-tool-and-knowledge-activator.md
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrait } from "../src/extendable/trait/loader.js";

describe("loader parses activates_on.show_*_when", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "act-on-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("trait with show_description_when and show_content_when is parsed", async () => {
    const traitDir = join(dir, "talkable");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: kernel
name: talkable
type: how_to_interact
version: 1.0.0
activates_on:
  show_description_when: ["talk"]
  show_content_when: ["submit.talk"]
description: test
deps: []
---

# talkable
`);
    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.activatesOn?.showDescriptionWhen).toEqual(["talk"]);
    expect(trait!.activatesOn?.showContentWhen).toEqual(["submit.talk"]);
  });

  test("trait without activates_on has activatesOn === undefined", async () => {
    const traitDir = join(dir, "plain");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: kernel
name: plain
type: how_to_interact
version: 1.0.0
description: test
deps: []
---

# plain
`);
    const trait = await loadTrait(traitDir, "kernel");
    expect(trait).not.toBeNull();
    expect(trait!.activatesOn).toBeUndefined();
  });

  test("legacy activates_on.paths yields undefined", async () => {
    const traitDir = join(dir, "bad");
    mkdirSync(traitDir, { recursive: true });
    writeFileSync(join(traitDir, "TRAIT.md"), `---
namespace: kernel
name: bad
type: how_to_interact
version: 1.0.0
activates_on:
  paths: ["talk"]
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
