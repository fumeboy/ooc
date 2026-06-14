import { test, expect } from "bun:test";
// 全量 boot builtin registry（避免模块求值期 assert 顺序坑，见线 B 报告偏离点 #1）
import "@ooc/core/executable/windows/index.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { computeVisibleMethodSet } from "../xml.js";

/**
 * computeVisibleMethodSet —— 算某 window class 的可见方法集（class 声明层用它声明一次）。
 * 这些行为断言是从旧 renderMethodsNode 迁移来的资产：methods 已从实例搬去 <window_classes>，
 * 但「set_viewport 仍可见 / 必填 arg eager / for_reflectable 门控」的契约不变，须继续守。
 */

test("window method (set_viewport) + object method (reload) both in file class method set", () => {
  const set = computeVisibleMethodSet({ id: "f1", class: "file" } as any, {} as any, builtinRegistry);
  expect(set).not.toBeNull();
  expect(set!.methodNames).toContain("set_viewport"); // window method（控展示）
  expect(set!.methodNames).toContain("reload");        // object method 仍在
});

test("talk class includes talk window method (set_transcript_window)", () => {
  const set = computeVisibleMethodSet({ id: "t1", class: "talk" } as any, {} as any, builtinRegistry);
  expect(set!.methodNames).toContain("set_transcript_window");
});

/**
 * S1（公理「窗须投影它的 Object 实际拥有的面」）：computeVisibleMethodSet 沿 parentClass 链合并方法。
 * self 窗 class=objectId、自身无 methods、agency 继承自 _builtin/agent —— 必须 surface 出来。
 */
test("S1: agent 类窗沿链 surface 继承的 agency（_builtin/agent → root）", () => {
  const agentWin = computeVisibleMethodSet({ id: "supervisor", class: "_builtin/agent" } as any, {} as any, builtinRegistry);
  expect(agentWin).not.toBeNull();
  for (const m of ["talk", "plan", "todo", "end"]) {
    expect(agentWin!.methodNames).toContain(m); // agency 在 _builtin/agent（talk 统一 peer + fork）
  }
  expect(agentWin!.methodNames).toContain("example"); // root misc 经 _builtin/agent → root 链

  // 具体 agent 子类（parentClass=_builtin/agent，对应 self 窗 class=objectId 的情形）同样 surface agency
  const t = `__test_agent_self_${Date.now()}`;
  builtinRegistry.registerNewObjectType(t as never, { methods: {}, parentClass: "_builtin/agent", readable: () => [] });
  const selfWin = computeVisibleMethodSet({ id: t, class: t } as any, {} as any, builtinRegistry);
  expect(selfWin!.methodNames).toContain("talk");
  expect(selfWin!.methodNames).toContain("end");
});

test("S1 边界: tool-object 成员(parentClass=null) 不继承 agency；窗类型不继承 root misc", () => {
  // filesystem 有自己的工具方法，但无 agency、不继承 root misc —— 它不是 Agent
  const fsWin = computeVisibleMethodSet({ id: "filesystem", class: "filesystem" } as any, {} as any, builtinRegistry);
  expect(fsWin!.methodNames).toContain("grep");
  expect(fsWin!.methodNames).not.toContain("talk");
  expect(fsWin!.methodNames).not.toContain("example");
  // 窗类型（talk/file）parentClass:null —— 不被 root 的 example/feishu 污染
  const talkWin = computeVisibleMethodSet({ id: "t1", class: "talk" } as any, {} as any, builtinRegistry);
  expect(talkWin!.methodNames).not.toContain("example");
  expect(talkWin!.methodNames).not.toContain("open_feishu_chat");
});

/**
 * eager 必填参数契约：method 的必填参数渲染为 <arg name type required> 子节点，治 LLM 猜 key。
 * say 的 msg 必填 → 出现；wait 可选 → 不进 eager（只在 form tip 出现）。
 */
test("required args rendered as <arg> under <method> (say.msg eager, wait optional excluded)", () => {
  const set = computeVisibleMethodSet({ id: "t1", class: "talk" } as any, {} as any, builtinRegistry);
  expect(set).not.toBeNull();
  // 找到 say 这个 method 节点
  const sayMethod = set!.methodNodes.find(
    (c: any) => c.kind === "element" && c.tag === "method" && c.attrs?.name === "say",
  );
  expect(sayMethod).toBeDefined();
  const argNodes = ((sayMethod as any).children ?? []).filter(
    (c: any) => c.kind === "element" && c.tag === "arg",
  );
  // 必填 msg 进 eager
  const msgArg = argNodes.find((a: any) => a.attrs?.name === "msg");
  expect(msgArg).toBeDefined();
  expect(msgArg.attrs.type).toBe("string");
  expect(msgArg.attrs.required).toBe("true");
  // 可选 wait 不进 eager
  expect(argNodes.find((a: any) => a.attrs?.name === "wait")).toBeUndefined();
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
  const biz = computeVisibleMethodSet(rr, { persistence: { sessionId: "biz-123" } } as any, builtinRegistry);
  expect(biz!.methodNames).toContain("say"); // 复用 talk 会话 method
  expect(biz!.methodNames).not.toContain("new_feat_branch");
  expect(biz!.methodNames).not.toContain("create_pr_and_invite_reviewers");

  // super flow：for_reflectable 沉淀 method 出现
  const sup = computeVisibleMethodSet(rr, { persistence: { sessionId: "super" } } as any, builtinRegistry);
  expect(sup!.methodNames).toContain("say");
  expect(sup!.methodNames).toContain("new_feat_branch");
  expect(sup!.methodNames).toContain("create_pr_and_invite_reviewers");
});
