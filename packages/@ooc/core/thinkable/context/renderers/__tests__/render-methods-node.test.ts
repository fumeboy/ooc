import { test, expect } from "bun:test";
// 全量 boot builtin registry（避免模块求值期 assert 顺序坑）
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry, createObjectRegistry } from "@ooc/core/runtime/object-registry.js";
import { computeVisibleMethodSet } from "../xml.js";

/**
 * computeVisibleMethodSet(ownerClass, projectionClass, thread, registry)
 * —— 算某**投影窗 class** 的可见方法集（class 声明层用它声明一次）。
 *
 * 新对象模型：ownerClass 是 object 的 class（如 filesystem/file、_builtin/agent/thread），
 * projectionClass 是 readable 投影出的 window class（file / talk / reflect_request）。
 * 这些行为断言守的契约：object_methods 引用 + window_methods 合并、必填 arg eager、
 * for_reflectable 仅 super flow surface。
 */

const bizThread = { persistence: { sessionId: "biz-123" } } as any;
const superThread = { persistence: { sessionId: "super" } } as any;

test("file 投影窗合并 object method (reload) + window method (set_viewport)", () => {
  const set = computeVisibleMethodSet("filesystem/file", "file", bizThread, builtinRegistry);
  expect(set).not.toBeNull();
  expect(set!.methodNames).toContain("set_viewport"); // window method（控展示）
  expect(set!.methodNames).toContain("reload"); // object method 仍在
});

test("talk 投影窗含 talk window method (set_transcript_window) + 会话 method (reply)", () => {
  const set = computeVisibleMethodSet("_builtin/agent/thread", "talk", bizThread, builtinRegistry);
  expect(set).not.toBeNull();
  expect(set!.methodNames).toContain("set_transcript_window");
  // creator-view（talk）窗 surface `reply`（say/reply 按视角分名）
  expect(set!.methodNames).toContain("reply");
});

/**
 * tool-object（filesystem）有自己的工具方法、无 agency —— 它不是 Agent，单跳无父、无 root 回退。
 * filesystem 自身亦无投影 window class（成员窗经各自投影），此处验证其工具 object method 沿
 * filesystem 投影窗 surface，且不含会话 method。
 */
test("S1 边界: tool-object(filesystem) 的工具方法 surface、无 agency 会话 method", () => {
  const set = computeVisibleMethodSet("filesystem", "filesystem", bizThread, builtinRegistry);
  expect(set).not.toBeNull();
  expect(set!.methodNames).toContain("grep");
  expect(set!.methodNames).not.toContain("say");
  expect(set!.methodNames).not.toContain("talk");
});

/**
 * eager 必填参数契约：method 的必填参数渲染为 <arg name type required> 子节点，治 LLM 猜 key。
 * creator-view（talk）窗 surface `reply`（say/reply 按视角分名，见 thread-say-inbox-outbox issue）；
 * reply 的 msg 必填 → 出现为 <arg>；reply 无其它参数 → 不混入无关 arg。
 */
test("required args rendered as <arg> under <method> (reply.msg eager required)", () => {
  const set = computeVisibleMethodSet("_builtin/agent/thread", "talk", bizThread, builtinRegistry);
  expect(set).not.toBeNull();
  // 找到 reply 这个 method 节点（creator-view talk 窗的会话 method）
  const replyMethod = set!.methodNodes.find(
    (c: any) => c.kind === "element" && c.tag === "method" && c.attrs?.name === "reply",
  );
  expect(replyMethod).toBeDefined();
  const argNodes = ((replyMethod as any).children ?? []).filter(
    (c: any) => c.kind === "element" && c.tag === "arg",
  );
  // 必填 msg 进 eager
  const msgArg = argNodes.find((a: any) => a.attrs?.name === "msg");
  expect(msgArg).toBeDefined();
  expect(msgArg.attrs.type).toBe("string");
  expect(msgArg.attrs.required).toBe("true");
});

/**
 * reflect_request（super flow 反思会话面）：复用 thread 的会话 method（say）+ 挂 reflectable
 * 沉淀 method（new_feat_branch / create_pr_and_invite_reviewers，标 for_reflectable）。
 * for_reflectable 门控：沉淀 method **仅在 super flow 下 surface**，业务 session 菜单不出现。
 */
test("reflect_request: for_reflectable methods gated to super flow; talk methods always shown", () => {
  // 业务 session：reflectable 沉淀 method 被隐藏；普通会话 method（say）仍在
  const biz = computeVisibleMethodSet("_builtin/agent/thread", "reflect_request", bizThread, builtinRegistry);
  expect(biz!.methodNames).toContain("say"); // 复用 thread 会话 method
  expect(biz!.methodNames).not.toContain("new_feat_branch");
  expect(biz!.methodNames).not.toContain("create_pr_and_invite_reviewers");

  // super flow：for_reflectable 沉淀 method 出现
  const sup = computeVisibleMethodSet("_builtin/agent/thread", "reflect_request", superThread, builtinRegistry);
  expect(sup!.methodNames).toContain("say");
  expect(sup!.methodNames).toContain("new_feat_branch");
  expect(sup!.methodNames).toContain("create_pr_and_invite_reviewers");
});

/**
 * self 窗自有方法可发现性：self 窗是对象自己的命令面，应 surface 其全部自有 object method，
 * 无需在 readable 里冗余声明 WindowClassDecl。非 self 窗（member/peer）仍按 decl 门控。
 */
test("self 窗 surface 自有 object method（无 readable decl 也上屏）；非 self 仍门控", () => {
  const reg = createObjectRegistry();
  reg.register("test_self_obj", {
    executable: {
      methods: [{ name: "DoThing", description: "do a thing", exec: () => "ok" }],
    },
  });

  // 非 self：无 readable WindowClassDecl → 门控不变，返回 null
  const notSelf = computeVisibleMethodSet("test_self_obj", "test_self_obj", bizThread, reg, false);
  expect(notSelf).toBeNull();

  // self：surface 自有方法，即便没有 readable decl
  const asSelf = computeVisibleMethodSet("test_self_obj", "test_self_obj", bizThread, reg, true);
  expect(asSelf).not.toBeNull();
  expect(asSelf!.methodNames).toContain("DoThing");
});
