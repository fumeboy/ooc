/**
 * Phase 2 loader 加载 llm_methods / ui_methods 双导出的测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTrait } from "../src/trait/loader.js";

const TEST_DIR = join(import.meta.dir, ".tmp_loader_methods_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loader 加载 llm_methods / ui_methods", () => {
  test("llm_methods 装入 trait.llmMethods", async () => {
    const dir = join(TEST_DIR, "llm_only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TRAIT.md"),
      `---
namespace: self
name: llm_only
type: how_to_think
---
x`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "index.ts"),
      `export const llm_methods = {
  foo: {
    description: "parse foo",
    params: [{ name: "path", type: "string", description: "", required: true }],
    fn: async (_ctx, { path }) => \`read \${path}\`,
  },
};`,
      "utf-8",
    );
    const trait = await loadTrait(dir, "self");
    expect(trait).not.toBeNull();
    expect(Object.keys(trait!.llmMethods ?? {})).toContain("foo");
    expect(trait!.uiMethods ?? {}).toEqual({});
  });

  test("ui_methods 装入 trait.uiMethods", async () => {
    const dir = join(TEST_DIR, "ui_only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TRAIT.md"),
      `---
namespace: self
name: ui_only
kind: view
type: how_to_interact
---
y`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "backend.ts"),
      `export const ui_methods = {
  submit: {
    description: "submit form",
    params: [],
    fn: async (_ctx, args) => ({ ok: true, args }),
  },
};`,
      "utf-8",
    );
    const trait = await loadTrait(dir, "self");
    expect(trait).not.toBeNull();
    expect(Object.keys(trait!.uiMethods ?? {})).toContain("submit");
    expect(trait!.llmMethods ?? {}).toEqual({});
  });

  test("llm_methods + ui_methods 同时存在时分别装入", async () => {
    const dir = join(TEST_DIR, "both");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TRAIT.md"),
      `---
namespace: self
name: both
kind: view
type: how_to_interact
---
z`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "backend.ts"),
      `export const llm_methods = {
  parse: { description: "", params: [], fn: async () => "parsed" },
};
export const ui_methods = {
  submit: { description: "", params: [], fn: async () => "submitted" },
};`,
      "utf-8",
    );
    const trait = await loadTrait(dir, "self");
    expect(Object.keys(trait!.llmMethods ?? {})).toContain("parse");
    expect(Object.keys(trait!.uiMethods ?? {})).toContain("submit");
  });

  test("旧 export const methods 不再被当作可调用方法加载", async () => {
    const dir = join(TEST_DIR, "legacy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "TRAIT.md"),
      `---
namespace: kernel
name: legacy
type: how_to_think
---
l`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "index.ts"),
      `export const methods = {
  add: {
    description: "加法",
    params: [],
    fn: async (_ctx, a, b) => a + b,
  },
};`,
      "utf-8",
    );
    const trait = await loadTrait(dir, "kernel");
    expect(trait!.llmMethods ?? {}).toEqual({});
    expect(trait!.uiMethods ?? {}).toEqual({});
  });
});
