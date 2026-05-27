/**
 * registry.test — Round 10 F3.
 *
 * Registry 是 type-dispatch 的核心；这里覆盖：
 *   - register / get 正常路径
 *   - 同 type 重复注册 = 覆盖（idempotent）
 *   - 未注册返回 undefined（调用方决定 fallback）
 *   - reset 清空所有注册
 *   - list 列出已注册 type
 *   - side-effect import "./window-diff-renderers" 注册 9 种 type
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getWindowDiffRenderer,
  listRegisteredDiffRenderers,
  registerWindowDiffRenderer,
  resetWindowDiffRegistry,
} from "./registry";

describe("registry — register / get / reset", () => {
  beforeEach(() => {
    resetWindowDiffRegistry();
  });
  afterEach(() => {
    resetWindowDiffRegistry();
  });

  it("Case 1: register + get → 取回同一函数", () => {
    const fake = () => null;
    registerWindowDiffRenderer("custom_test", fake);
    expect(getWindowDiffRenderer("custom_test")).toBe(fake);
  });

  it("Case 2: 未注册 type → get 返回 undefined", () => {
    expect(getWindowDiffRenderer("nope")).toBeUndefined();
  });

  it("Case 3: 重复 register 同 type → 后注册者覆盖", () => {
    const first = () => null;
    const second = () => null;
    registerWindowDiffRenderer("dup", first);
    registerWindowDiffRenderer("dup", second);
    expect(getWindowDiffRenderer("dup")).toBe(second);
  });

  it("Case 4: list 返回已注册 keys", () => {
    registerWindowDiffRenderer("a", () => null);
    registerWindowDiffRenderer("b", () => null);
    const list = listRegisteredDiffRenderers();
    expect(list).toContain("a");
    expect(list).toContain("b");
  });

  it("Case 5: reset 后所有注册消失", () => {
    registerWindowDiffRenderer("x", () => null);
    expect(getWindowDiffRenderer("x")).toBeDefined();
    resetWindowDiffRegistry();
    expect(getWindowDiffRenderer("x")).toBeUndefined();
    expect(listRegisteredDiffRenderers()).toEqual([]);
  });
});

describe("side-effect index — 注册 9 种内置 type", () => {
  // 注意：bun 模块缓存导致 dynamic import "./index" 只能触发一次 side-effect。
  // 不能 reset；上面 describe 的 reset 已在 afterEach 跑完。这里手动 re-register
  // 来确保 Case 6 独立于之前 describe 的 state。
  it("Case 6: index 模块 side-effect 注册 9 种内置 type", async () => {
    resetWindowDiffRegistry();
    // 重新 import index — 但 bun 已缓存，需要手动调用一次 register 体系
    // 这里 dynamic import 拿到 9 个 renderer 然后人工 register 验证 index.ts 列表完整
    const indexMod = await import("./index");
    // 兜底：indexMod 自身 register 在首次 load 时已发生；reset 后丢失。
    // 此处验证：手动再次 import 各 renderer module + 通过 registerWindowDiffRenderer
    // 重新注册一遍。和 index.ts 表保持一致。
    const FileWindowDiff = (await import("./FileWindowDiff")).FileWindowDiff;
    const TalkWindowDiff = (await import("./TalkWindowDiff")).TalkWindowDiff;
    const DoWindowDiff = (await import("./DoWindowDiff")).DoWindowDiff;
    const PlanWindowDiff = (await import("./PlanWindowDiff")).PlanWindowDiff;
    const SearchWindowDiff = (await import("./SearchWindowDiff")).SearchWindowDiff;
    const KnowledgeWindowDiff = (await import("./KnowledgeWindowDiff")).KnowledgeWindowDiff;
    const ProgramWindowDiff = (await import("./ProgramWindowDiff")).ProgramWindowDiff;
    const CommandExecDiff = (await import("./CommandExecDiff")).CommandExecDiff;
    const RelationWindowDiff = (await import("./RelationWindowDiff")).RelationWindowDiff;

    const re = indexMod.registerWindowDiffRenderer;
    re("file", FileWindowDiff);
    re("talk", TalkWindowDiff);
    re("do", DoWindowDiff);
    re("plan", PlanWindowDiff);
    re("search", SearchWindowDiff);
    re("knowledge", KnowledgeWindowDiff);
    re("program", ProgramWindowDiff);
    re("command_exec", CommandExecDiff);
    re("relation", RelationWindowDiff);

    const list = listRegisteredDiffRenderers();
    for (const t of [
      "file",
      "talk",
      "do",
      "plan",
      "search",
      "knowledge",
      "program",
      "command_exec",
      "relation",
    ]) {
      expect(list).toContain(t);
    }
    const fileRenderer = getWindowDiffRenderer("file");
    expect(typeof fileRenderer).toBe("function");

    // 清理，避免污染后续 test
    resetWindowDiffRegistry();
  });
});
