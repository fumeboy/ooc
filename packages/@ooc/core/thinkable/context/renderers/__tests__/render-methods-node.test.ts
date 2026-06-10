import { test, expect } from "bun:test";
// 全量 boot builtin registry（避免模块求值期 assert 顺序坑，见线 B 报告偏离点 #1）
import "@ooc/core/executable/windows/index.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { renderMethodsNode } from "../xml.js";

/**
 * 回归守卫：window method（控制展示，归 readable 的 windowMethods）迁出 methods 后，
 * 必须仍出现在给 LLM 的 <methods> 节点，否则 LLM 看不到 set_viewport（功能消失）。
 * 这是「测试全绿但功能没了」的盲区——迁移前后都缺此覆盖。
 */
test("window method (set_viewport) still rendered in <commands> for file window", () => {
  const node = renderMethodsNode({ id: "f1", class: "file" } as any, builtinRegistry);
  expect(node).not.toBeNull();
  const serialized = JSON.stringify(node);
  expect(serialized).toContain("set_viewport"); // window method
  expect(serialized).toContain("reload");        // object method 仍在
});

test("talk window method (set_transcript_window) rendered in <commands>", () => {
  const node = renderMethodsNode({ id: "t1", class: "talk" } as any, builtinRegistry);
  expect(JSON.stringify(node)).toContain("set_transcript_window");
});
