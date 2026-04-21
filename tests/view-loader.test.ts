/**
 * Phase 3 Task 3.1 — VIEW.md 加载测试
 *
 * 验证 views/ 目录按 kind=view 加载的约定：
 * - loadObjectViews 扫描 {objectDir}/views/*\/VIEW.md
 * - 每个 view 必须与 frontend.tsx 同目录共存（缺 frontend.tsx 报错）
 * - backend.ts 可选：存在则按 ui_methods / llm_methods 双命名导出加载
 * - frontmatter 必须声明 namespace: self、kind: view（loader 内部校验）
 * - 加载结果作为 TraitDefinition 返回，kind === "view"
 *
 * @ref docs/superpowers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.3
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadObjectViews } from "../src/trait/loader.js";

const TEST_DIR = join(import.meta.dir, ".tmp_view_loader_test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadObjectViews", () => {
  test("扫描 views/ 目录加载所有 VIEW.md，返回 kind=view 的 TraitDefinition", async () => {
    const objDir = join(TEST_DIR, "fake-obj");
    const demoDir = join(objDir, "views", "demo");
    mkdirSync(demoDir, { recursive: true });
    writeFileSync(
      join(demoDir, "VIEW.md"),
      `---
namespace: self
name: demo
kind: view
type: how_to_interact
when: never
description: 示例视图
---

demo view`,
      "utf-8",
    );
    writeFileSync(
      join(demoDir, "frontend.tsx"),
      `export default function Demo(){ return null; }`,
      "utf-8",
    );

    const views = await loadObjectViews(objDir);
    expect(views.length).toBe(1);
    expect(views[0]!.kind).toBe("view");
    expect(views[0]!.namespace).toBe("self");
    expect(views[0]!.name).toBe("demo");
  });

  test("缺 frontend.tsx 时抛错（view 必须可渲染）", async () => {
    const objDir = join(TEST_DIR, "broken-obj");
    const bdir = join(objDir, "views", "broken");
    mkdirSync(bdir, { recursive: true });
    writeFileSync(
      join(bdir, "VIEW.md"),
      `---
namespace: self
name: broken
kind: view
when: never
---
no frontend`,
      "utf-8",
    );
    await expect(loadObjectViews(objDir)).rejects.toThrow(/frontend\.tsx/);
  });

  test("backend.ts 的 ui_methods 装入 uiMethods，llm_methods 装入 llmMethods", async () => {
    const objDir = join(TEST_DIR, "form-obj");
    const dir = join(objDir, "views", "form");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "VIEW.md"),
      `---
namespace: self
name: form
kind: view
when: never
---
form view`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "frontend.tsx"),
      `export default function F(){ return null; }`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "backend.ts"),
      `export const ui_methods = {
  submit: { description: "submit", params: [], fn: async () => ({ ok: true }) },
};
export const llm_methods = {
  parse: { description: "parse", params: [], fn: async () => "parsed" },
};`,
      "utf-8",
    );

    const views = await loadObjectViews(objDir);
    expect(views.length).toBe(1);
    expect(Object.keys(views[0]!.uiMethods ?? {})).toContain("submit");
    expect(Object.keys(views[0]!.llmMethods ?? {})).toContain("parse");
  });

  test("没有 views/ 目录时返回空数组（不报错）", async () => {
    const objDir = join(TEST_DIR, "no-views");
    mkdirSync(objDir, { recursive: true });
    const views = await loadObjectViews(objDir);
    expect(views).toEqual([]);
  });

  test("frontmatter 若 kind 不是 view 则自动按 trait 处理（宽容：VIEW.md 默认 kind=view 需显式声明）", async () => {
    /* 设计：loadObjectViews 会把 views/ 下所有 VIEW.md 的 kind 强制置为 "view"
     * 即使用户 frontmatter 忘写 kind: view。防止配置错误 */
    const objDir = join(TEST_DIR, "no-kind-obj");
    const dir = join(objDir, "views", "x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "VIEW.md"),
      `---
namespace: self
name: x
when: never
---
x view`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "frontend.tsx"),
      `export default function X(){return null;}`,
      "utf-8",
    );
    const views = await loadObjectViews(objDir);
    expect(views[0]!.kind).toBe("view");
  });
});
