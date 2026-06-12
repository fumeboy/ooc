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
  const node = renderMethodsNode({ id: "f1", class: "file" } as any, {} as any, builtinRegistry);
  expect(node).not.toBeNull();
  const serialized = JSON.stringify(node);
  expect(serialized).toContain("set_viewport"); // window method
  expect(serialized).toContain("reload");        // object method 仍在
});

test("talk window method (set_transcript_window) rendered in <commands>", () => {
  const node = renderMethodsNode({ id: "t1", class: "talk" } as any, {} as any, builtinRegistry);
  expect(JSON.stringify(node)).toContain("set_transcript_window");
});

/**
 * reflect_request（super flow 反思会话面）：复用 talk 的会话 method（say）+ 挂 reflectable
 * 沉淀 method（new_feat_branch / create_pr_and_invite_reviewers，标 for_reflectable）。
 * for_reflectable 门控：沉淀 method **仅在 super flow 下 surface**，业务 session 菜单不出现
 * （取代旧的 root method「存在即有效」+ exec 内 isSuperSessionId 命令式拒绝）。
 */
test("reflect_request: for_reflectable methods gated to super flow; talk methods always shown", () => {
  const rr = { id: "rr1", class: "reflect_request" } as any;

  // 业务 session：reflectable 沉淀 method 被隐藏；普通会话 method（say）仍在
  const biz = JSON.stringify(
    renderMethodsNode(rr, { persistence: { sessionId: "biz-123" } } as any, builtinRegistry),
  );
  expect(biz).toContain("say"); // 复用 talk 会话 method
  expect(biz).not.toContain("new_feat_branch");
  expect(biz).not.toContain("create_pr_and_invite_reviewers");

  // super flow：for_reflectable 沉淀 method 出现
  const sup = JSON.stringify(
    renderMethodsNode(rr, { persistence: { sessionId: "super" } } as any, builtinRegistry),
  );
  expect(sup).toContain("say");
  expect(sup).toContain("new_feat_branch");
  expect(sup).toContain("create_pr_and_invite_reviewers");
});
