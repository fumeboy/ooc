/**
 * L4 — Collaborable（talk peer / talk fork / Issue / relation）。
 * Object 间通过 talk_window（peer 会话 + fork 子线程两形态）/ Issue 协作。
 * 真正的「agent 主动 talk/evolve 越界」需 worker → skip 归 Tier B；此处断结构通道。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { postJson, getJson } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";
import { normalizeClassId } from "@ooc/core/runtime/object-registry";

async function seed(app: any, target: string, sid: string, msg = "hi") {
  await postJson(app, "/api/stones", { objectId: target, self: `# ${target}` });
  const r = await postJson(app, "/api/sessions", { sessionId: sid, targetObjectId: target, initialMessage: msg });
  return { threadId: r.json?.targetThreadId as string | undefined, status: r.status };
}

export const L4_STORIES: Story[] = [
  story({
    id: "L4-USER-TALK",
    layer: "collaborable",
    expectation: "seedSession 在 user 线程上建对 target 的会话窗（stored class=_builtin/agent/thread）",
    design: "collaborable：跨对象会话经会话窗投递。windows stored class = thread stone objectId（projection-class.ts 投影 talk）",
    run: async ({ app, baseDir }) => {
      const sid = "sb-c-talk";
      await seed(app, "obj_talk", sid);
      const threads = await getJson(app, `/api/flows/${sid}/threads`);
      const userT = (threads.json?.items ?? []).find((t: any) => t.objectId === "user");
      check(!!userT, `user 线程缺位：${JSON.stringify(threads.json?.items)}`);
      const p = join(baseDir, "flows", sid, "objects", "user", "threads", userT.threadId, "thread-context.json");
      check(existsSync(p), `user thread-context.json 不存在`);
      const ctx = JSON.parse(readFileSync(p, "utf8"));
      // Wave4 对象模型：会话窗 stored class = thread 的 stone objectId "_builtin/agent/thread"
      //（"talk" 是 readable computeProjectionClass 按 POV 算的投影 class，不落盘）。
      // 会话窗是 inline 持久化（thread persistable.mode=inline）：整窗 inline 进 user thread-context
      // entry，data.target 直接可读（不写独立 data.json）。
      const entries = (ctx.contextWindows ?? []) as any[];
      const sessionEntry = entries.find((w) => normalizeClassId(w.class ?? "") === "agent/thread");
      check(
        !!sessionEntry,
        `user 线程无会话窗 entry（stored class=_builtin/agent/thread）：${JSON.stringify(entries.map((w: any) => ({ id: w.id, class: w.class })))}`,
      );
      check(
        sessionEntry.data?.target === "obj_talk",
        `会话窗未指向 obj_talk：data=${JSON.stringify(sessionEntry.data)}`,
      );
    },
  }),

  story({
    id: "L4-DELIVER-INBOX",
    layer: "collaborable",
    expectation: "初始消息投递到 callee 线程的 inbox（inbox/msg_*.json）",
    design: "collaborable：消息以 per-message append-only 落 callee inbox。persistable inbox",
    run: async ({ app, baseDir }) => {
      const sid = "sb-c-inbox";
      const target = "obj_inbox";
      const s = await seed(app, target, sid, "你好");
      const inbox = join(baseDir, "flows", sid, "objects", target, "threads", s.threadId!, "inbox");
      check(existsSync(inbox), `callee inbox 目录不存在：${inbox}`);
      const msgs = readdirSync(inbox).filter((f) => f.endsWith(".json"));
      check(msgs.length >= 1, `callee inbox 无消息文件：${JSON.stringify(readdirSync(inbox))}`);
    },
  }),

  story({
    id: "L4-TALK-INLINE-PERSISTED",
    layer: "collaborable",
    expectation: "会话窗 class（_builtin/agent/thread）是 inline 持久化（persistable.mode=inline）",
    design: "collaborable：会话窗（peer + fork 两形态）是 thread 实例，整窗随 thread-context inline 落盘。thread persistable mode:inline；isBuiltinFeature 标志已退役 → isInlinePersisted",
    run: async () => {
      await import("@ooc/core/runtime/register-builtins.js");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      // Wave4：旧 isBuiltinFeature 标志 + getObjectDefinition 已退役。会话窗的「inline 持久化」
      // 现由 thread class 自己的 persistable.mode="inline" 声明，经 isInlinePersisted 解析。
      // "talk" 不再是注册 class（它是 readable 投影 class），故查 stored class _builtin/agent/thread。
      check(
        builtinRegistry.isInlinePersisted("_builtin/agent/thread") === true,
        "_builtin/agent/thread 非 inline 持久化（persistable.mode 应为 inline）",
      );
    },
  }),

  story({
    id: "L4-CROSS-OBJECT-TALK",
    layer: "collaborable",
    expectation: "agent 主动 talk 别的对象 → 双方各落 thread（需 worker）",
    design: "collaborable：peer 平等轴经 talk 协作。需真 LLM 主动行动，归 Tier B。",
    run: async () => skip("agent 主动 talk 需 worker/LLM thinkloop，控制面不可确定性验证（Tier B）"),
  }),

  story({
    id: "L4-PR-ISSUE-FILE",
    layer: "collaborable",
    expectation: "cross-scope evolve 越界 → flows/super/issues/issue-<id>.json 出现",
    design: "collaborable：越自治区改动开 PR-Issue 待 Supervisor 评审。persistable/pr-issue.ts",
    run: async () => skip("PR-Issue 由 super flow create_pr_and_invite_reviewers cross-scope 触发，需 worker 编排（Tier B/e2e）"),
  }),

  story({
    id: "L4-RELATION-POOL",
    layer: "collaborable",
    expectation: "relation 落 pools/<id>/knowledge/relations/<peer>.md",
    design: "collaborable：对象关系沉淀进 pool relations。pool relations",
    run: async () => skip("relation 沉淀由 collaborable 运行流触发，需 worker（Tier B）"),
  }),
];
