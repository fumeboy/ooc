import { test, expect } from "bun:test";
import { BUILTIN_VISIBLE } from "../builtin-visible-registry";

test("registry covers all renderable builtin types", () => {
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
    "relation",
    "feishu_chat",
    "feishu_doc",
    "do",
    "talk",
    "form_guidance",
  ]) {
    expect(BUILTIN_VISIBLE[t]).toBeDefined();
  }
});

test("supervisor / user are not registered (fall to JSON fallback)", () => {
  expect(BUILTIN_VISIBLE["supervisor"]).toBeUndefined();
  expect(BUILTIN_VISIBLE["user"]).toBeUndefined();
});
