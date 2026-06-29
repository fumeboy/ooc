import { test, expect } from "bun:test";
import { BUILTIN_VISIBLE, PlaceholderWindowDetail } from "../builtin-visible-registry";

/**
 * P1 (2026-06-29):
 * - 13 个 builtin window type 都已实装真组件(file/knowledge/todo/search/skill_index/plan/
 *   program/root/method_exec/feishu_chat/feishu_doc/talk);"do" 已退役(合并入 talk)。
 * - PlaceholderWindowDetail 现在 export 出来作为新 builtin 临时兜底用,不再默认装配。
 */

test("registry covers all 12 active builtin types", () => {
  for (const t of [
    "file",
    "knowledge",
    "todo",
    "search",
    "skill_index",
    "plan",
    "program",
    "root",
    "method_exec",
    "feishu_chat",
    "feishu_doc",
    "talk",
  ]) {
    expect(BUILTIN_VISIBLE[t]).toBeDefined();
  }
});

test("retired 'do' window type is not registered (merged into talk)", () => {
  expect(BUILTIN_VISIBLE["do"]).toBeUndefined();
});

test("supervisor / user are not registered (fall to JSON / readable fallback)", () => {
  expect(BUILTIN_VISIBLE["supervisor"]).toBeUndefined();
  expect(BUILTIN_VISIBLE["user"]).toBeUndefined();
});

test("PlaceholderWindowDetail still exported for future fallback use", () => {
  expect(PlaceholderWindowDetail).toBeDefined();
  expect(typeof PlaceholderWindowDetail).toBe("function");
});

test("P1 builtin types no longer point to PlaceholderWindowDetail", () => {
  const p1Types = ["file", "knowledge", "todo", "search", "skill_index", "plan", "program", "root"];
  for (const t of p1Types) {
    // 关键不变式: 不应再指向 Placeholder — P1 已实装真组件
    expect(BUILTIN_VISIBLE[t]).not.toBe(PlaceholderWindowDetail);
  }
});
