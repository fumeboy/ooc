/**
 * L4 — Collaborable（talk / do / Issue / relation）。
 * Object 间通过 talk_window / do_window / Issue 协作。
 * 真正的「agent 主动 talk/do/evolve 越界」需 worker → skip 归 Tier B；此处断结构通道。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { postJson, getJson } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";

async function seed(app: any, target: string, sid: string, msg = "hi") {
  await postJson(app, "/api/stones", { objectId: target, self: `# ${target}` });
  const r = await postJson(app, "/api/sessions", { sessionId: sid, targetObjectId: target, initialMessage: msg });
  return { threadId: r.json?.targetThreadId as string | undefined, status: r.status };
}

export const L4_STORIES: Story[] = [
  story({
    id: "L4-USER-TALK",
    layer: "collaborable",
    expectation: "seedSession 在 user 线程上建对 target 的 talk_window",
    design: "collaborable：跨对象会话经 talk_window 投递。modules/flows/api.seed-session + windows/talk",
    run: async ({ app, baseDir }) => {
      const sid = "sb-c-talk";
      await seed(app, "obj_talk", sid);
      const threads = await getJson(app, `/api/flows/${sid}/threads`);
      const userT = (threads.json?.items ?? []).find((t: any) => t.objectId === "user");
      check(!!userT, `user 线程缺位：${JSON.stringify(threads.json?.items)}`);
      const p = join(baseDir, "flows", sid, "objects", "user", "threads", userT.threadId, "thread-context.json");
      check(existsSync(p), `user thread-context.json 不存在`);
      const ctx = JSON.parse(readFileSync(p, "utf8"));
      const hasTalk = (ctx.contextWindows ?? []).some((w: any) => w.type === "talk");
      check(hasTalk, `user 线程无 talk_window：${JSON.stringify((ctx.contextWindows ?? []).map((w: any) => w.type))}`);
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
    id: "L4-TALK-BUILTIN-FEATURE",
    layer: "collaborable",
    expectation: "talk window 是 isBuiltinFeature（inline 进 thread-context，不写独立 dir）",
    design: "collaborable：talk/do 是 Object 内置特性，状态 inline。windows/talk registerExecutable isBuiltinFeature",
    run: async () => {
      await import("@ooc/core/executable/windows/index.js");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      check(builtinRegistry.getObjectDefinition("talk").isBuiltinFeature === true, "talk 非 isBuiltinFeature");
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
    run: async () => skip("PR-Issue 由 super flow evolve_self cross-scope 触发，需 worker 编排（Tier B/e2e）"),
  }),

  story({
    id: "L4-RELATION-POOL",
    layer: "collaborable",
    expectation: "relation 落 pools/<id>/knowledge/relations/<peer>.md",
    design: "collaborable：对象关系沉淀进 pool relations。pool relations",
    run: async () => skip("relation 沉淀由 collaborable 运行流触发，需 worker（Tier B）"),
  }),
];
