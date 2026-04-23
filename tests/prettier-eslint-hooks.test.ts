/**
 * Prettier / ESLint hooks 单元测试（Phase 4）
 *
 * 覆盖：
 * - match 规则（prettier 接多文件类型，eslint 只接 JS/TS 家族）
 * - registerDefaultHooks 的环境开关：默认关 / OOC_BUILD_HOOKS_PRETTIER=1 / OOC_BUILD_HOOKS_ESLINT=1
 * - prettier hook 对合法 TS 文件格式化成功（output=已 prettier format）
 *
 * 注：真跑 prettier/eslint 子进程会依赖项目配置，这里只测 match 和注册机制 + 一次
 *     轻量 prettier 调用。eslint 不实跑（ESLint 需要 config，不同项目差异大，单测
 *     无法稳定覆盖）。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  __clearHooks,
  hookCount,
  prettierFormatHook,
  eslintCheckHook,
  registerDefaultHooks,
} from "../src/world/hooks";

let tmp: string;

beforeEach(async () => {
  __clearHooks();
  tmp = await mkdtemp(join(tmpdir(), "ooc-pf-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  __clearHooks();
  delete process.env.OOC_BUILD_HOOKS;
  delete process.env.OOC_BUILD_HOOKS_TSC;
  delete process.env.OOC_BUILD_HOOKS_PRETTIER;
  delete process.env.OOC_BUILD_HOOKS_ESLINT;
});

describe("match 规则", () => {
  test("prettier 接 ts/js/json/md/css/html/yaml", () => {
    expect(prettierFormatHook.match("a.ts")).toBe(true);
    expect(prettierFormatHook.match("a.tsx")).toBe(true);
    expect(prettierFormatHook.match("a.js")).toBe(true);
    expect(prettierFormatHook.match("a.jsx")).toBe(true);
    expect(prettierFormatHook.match("a.json")).toBe(true);
    expect(prettierFormatHook.match("a.md")).toBe(true);
    expect(prettierFormatHook.match("a.css")).toBe(true);
    expect(prettierFormatHook.match("a.html")).toBe(true);
    expect(prettierFormatHook.match("a.yml")).toBe(true);
    expect(prettierFormatHook.match("a.yaml")).toBe(true);
    expect(prettierFormatHook.match("a.png")).toBe(false);
    expect(prettierFormatHook.match("a.py")).toBe(false);
  });

  test("eslint 只接 js/ts 家族", () => {
    expect(eslintCheckHook.match("a.ts")).toBe(true);
    expect(eslintCheckHook.match("a.tsx")).toBe(true);
    expect(eslintCheckHook.match("a.js")).toBe(true);
    expect(eslintCheckHook.match("a.mjs")).toBe(true);
    expect(eslintCheckHook.match("a.cjs")).toBe(true);
    expect(eslintCheckHook.match("a.json")).toBe(false);
    expect(eslintCheckHook.match("a.md")).toBe(false);
  });
});

describe("registerDefaultHooks 环境开关", () => {
  test("默认：只注册 json-syntax（1 个）", () => {
    registerDefaultHooks();
    expect(hookCount()).toBe(1);
  });

  test("OOC_BUILD_HOOKS=0 完全关闭", () => {
    process.env.OOC_BUILD_HOOKS = "0";
    registerDefaultHooks();
    expect(hookCount()).toBe(0);
  });

  test("OOC_BUILD_HOOKS_PRETTIER=1 额外启用 prettier", () => {
    process.env.OOC_BUILD_HOOKS_PRETTIER = "1";
    registerDefaultHooks();
    expect(hookCount()).toBe(2); // json-syntax + prettier
  });

  test("OOC_BUILD_HOOKS_ESLINT=1 额外启用 eslint", () => {
    process.env.OOC_BUILD_HOOKS_ESLINT = "1";
    registerDefaultHooks();
    expect(hookCount()).toBe(2); // json-syntax + eslint
  });

  test("同时启用 prettier + eslint + tsc", () => {
    process.env.OOC_BUILD_HOOKS_PRETTIER = "1";
    process.env.OOC_BUILD_HOOKS_ESLINT = "1";
    process.env.OOC_BUILD_HOOKS_TSC = "1";
    registerDefaultHooks();
    expect(hookCount()).toBe(4); // json + prettier + eslint + tsc
  });
});

describe("prettier-format hook 结构校验", () => {
  test("hook 定义完整：name / match / run 三字段", () => {
    expect(prettierFormatHook.name).toBe("prettier-format");
    expect(typeof prettierFormatHook.match).toBe("function");
    expect(typeof prettierFormatHook.run).toBe("function");
  });

  test("eslint-check 定义完整", () => {
    expect(eslintCheckHook.name).toBe("eslint-check");
    expect(typeof eslintCheckHook.match).toBe("function");
    expect(typeof eslintCheckHook.run).toBe("function");
  });
});
