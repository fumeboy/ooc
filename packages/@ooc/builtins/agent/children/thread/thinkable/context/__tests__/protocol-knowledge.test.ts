/**
 * Protocol knowledge —— builtin 包 knowledge/*.md 按 activates_on 命中当前 thread 的篇目，
 * 经 buildProtocolKnowledgeWindows 注入为 source=protocol 的 KnowledgeWindow（Wave4：
 * 知识随各 builtin class 包发布，protocol loader 遍历各 builtin 包的 knowledge 目录全量收集）。
 *
 * 验证各交互面命中对应切片、互不串台：
 * - object::root（恒在）→ interaction-core / agency-methods
 * - super → super-flow（仅 super session）
 * - method::_builtin/agent::end → end-reflection（agent self 窗上开 end form 时，经类链匹配）
 *
 * B→A split：context window（OocObjectRef）不持 data——业务 data 在 session 对象表。fixture 窗
 * 经 `setSessionObject(thread, {id,class,data})` 登记 data；输出窗由 makeKnowledgeWindow 自动
 * materialize 进同一 thread 的对象表，故读输出窗 data 须 `objectDataOf(w, getSessionObjectTable(thread))`。
 */
import { describe, expect, it } from "bun:test";
import { buildProtocolKnowledgeWindows } from "../protocol";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import type { ThreadContext } from "../index.js";
import type { ContextWindow } from "@ooc/core/types/context-window.js";
import { objectDataOf, threadWindowIdOf } from "@ooc/core/types/context-window.js";
import { getSessionObjectTable, setSessionObject } from "@ooc/core/runtime/session-object-table.js";
import { THREAD_CLASS_ID, isKnowledgeClass } from "@ooc/core/types/constants.js";

/** fixture 窗规格：ref 视角态 + 要登记进对象表的 data。 */
interface WinSpec {
  id: string;
  class: string;
  data: Record<string, unknown>;
  parentWindowId?: string;
  title?: string;
  status?: ContextWindow["status"];
  createdAt?: number;
}

/** 把 WinSpec 变成 OocObjectRef（不持 data）。 */
function toRef(s: WinSpec): ContextWindow {
  return {
    id: s.id,
    class: s.class,
    parentWindowId: s.parentWindowId,
    title: s.title ?? s.id,
    status: s.status ?? "open",
    createdAt: s.createdAt ?? 1,
  };
}

/**
 * 建 thread + 把 fixture 窗的 data 登记进 session 对象表（production code 经表解析 data）。
 */
function makeThreadWithObjects(
  opts: Parameters<typeof makeThread>[0] & { objectWindows?: WinSpec[] } = {},
): ThreadContext {
  const { objectWindows = [], extraWindows, ...rest } = opts;
  const thread = makeThread({
    ...rest,
    extraWindows: [...(extraWindows ?? []), ...objectWindows.map(toRef)],
  });
  for (const s of objectWindows) {
    setSessionObject(thread, { id: s.id, class: s.class, data: s.data });
  }
  return thread;
}

function paths(thread: ThreadContext, windows: ContextWindow[]): string[] {
  // 合成 knowledge 窗 stored class = KNOWLEDGE_CLASS_ID（裸名 "knowledge" 是 readable 投影名）。
  const table = getSessionObjectTable(thread);
  return windows
    .filter((w) => isKnowledgeClass(w.class))
    .map((w) => (objectDataOf(w, table) as { path?: string }).path ?? "");
}

/** 取 knowledge 窗的业务 data（经 session 对象表解析）。 */
const kdata = (thread: ThreadContext, w: ContextWindow | undefined) =>
  (w ? objectDataOf(w, getSessionObjectTable(thread)) : undefined) as
    | {
        path?: string;
        presentation?: string;
        body?: string;
        source?: string;
      }
    | undefined ?? {};

// agency（end）跑在 agent 的 self 窗上（class=_builtin/agent），end form 挂在它上面。
// end-reflection 的 activates_on 键 `method::_builtin/agent::end` 经父类匹配命中
// （form.parentWindowId → self 窗 class=_builtin/agent → trigger.objectType=_builtin/agent）。
const AGENT_SELF_WIN: WinSpec = {
  id: "self_agent",
  parentWindowId: "root",
  title: "self",
  status: "open",
  createdAt: 1,
  class: "_builtin/agent",
  data: {},
};

function endFormSpec(): WinSpec {
  return {
    id: "f_end",
    parentWindowId: "self_agent",
    title: "end",
    status: "open",
    createdAt: 1,
    class: "method_exec",
    data: { method: "end" },
  };
}

describe("root builtin knowledge activation", () => {
  it("object::root 恒激活 interaction-core / agency-methods（即便无 persistence）", async () => {
    const thread = makeThread({ id: "t_mem" });
    const out = await buildProtocolKnowledgeWindows(thread);
    const p = paths(thread, out);
    expect(p).toContain("interaction-core");
    expect(p).toContain("agency-methods");
  });

  it("super session 激活 super-flow；普通 session 不激活", async () => {
    const superThread = makeThread({
      id: "t_super",
      persistence: { baseDir: "/tmp/test", sessionId: "super", objectId: "alice", threadId: "t_super" },
    });
    const normalThread = makeThread({
      id: "t_normal",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_normal" },
    });
    expect(paths(superThread, await buildProtocolKnowledgeWindows(superThread))).toContain("super-flow");
    expect(paths(normalThread, await buildProtocolKnowledgeWindows(normalThread))).not.toContain("super-flow");
  });

  it("开 end form → end-reflection full content；无 form 时仅 summary（object::root 恒在 hint）", async () => {
    // end-reflection.md 双键：object::root → show_description（恒在摘要 hint），
    // method::_builtin/agent::end → show_content（开 end form 时升格全文）。
    const withEnd = makeThreadWithObjects({
      id: "t_end",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end" },
      objectWindows: [AGENT_SELF_WIN, endFormSpec()],
    });
    const noForm = makeThread({
      id: "t_noform",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_noform" },
    });
    const findEnd = (thread: ThreadContext, out: Awaited<ReturnType<typeof buildProtocolKnowledgeWindows>>) =>
      out.find((w) => kdata(thread, w).path === "end-reflection");
    // 开 end form：升格 full content（body 非空）。
    const withEndOut = await buildProtocolKnowledgeWindows(withEnd);
    const withEndWin = findEnd(withEnd, withEndOut);
    expect(kdata(withEnd, withEndWin).presentation).toBe("full");
    expect(kdata(withEnd, withEndWin).body).not.toBe("");
    // 无 form：仅 summary（hint），body 空、不铺开全文。
    const noFormOut = await buildProtocolKnowledgeWindows(noForm);
    const noFormWin = findEnd(noForm, noFormOut);
    expect(kdata(noForm, noFormWin).presentation).toBe("summary");
    expect(kdata(noForm, noFormWin).body).toBe("");
  });

  it("per-type 知识按 object::<type> 激活、不串台（plan/search/feishu_chat/feishu_doc）", async () => {
    const cases: Array<{ class: string; path: string }> = [
      { class: "plan", path: "plan" },
      { class: "search", path: "search" },
      { class: "feishu_chat", path: "feishu-chat" },
      { class: "feishu_doc", path: "feishu-doc" },
    ];
    for (const c of cases) {
      const withWin = makeThreadWithObjects({
        id: `t_`,
        objectWindows: [
          { id: `w_`, parentWindowId: "root", title: c.class, status: "open", createdAt: 1, class: c.class, data: {} },
        ],
      });
      const p = paths(withWin, await buildProtocolKnowledgeWindows(withWin));
      expect(p).toContain(c.path);
      // 不串台：纯 root thread（无该 window）不应激活
      const bare = makeThread({ id: "t_bare" });
      expect(paths(bare, await buildProtocolKnowledgeWindows(bare))).not.toContain(c.path);
    }
  });

  it("注入的 window source=protocol", async () => {
    const thread = makeThread({ id: "t_src" });
    const out = await buildProtocolKnowledgeWindows(thread);
    const core = out.find((w) => kdata(thread, w).path === "interaction-core");
    expect(core).toBeDefined();
    expect(kdata(thread, core).source).toBe("protocol");
  });
});

describe("root builtin knowledge content（砍机制留协议后的关键协议仍在）", () => {
  it("super-flow 含 sediment frontmatter 写作协议", async () => {
    const thread = makeThread({
      id: "t_super2",
      persistence: { baseDir: "/tmp/test", sessionId: "super", objectId: "alice", threadId: "t_super2" },
    });
    const out = await buildProtocolKnowledgeWindows(thread);
    const sf = out.find((w) => kdata(thread, w).path === "super-flow");
    expect(kdata(thread, sf).body).toContain("frontmatter");
    expect(kdata(thread, sf).body).toContain("activates_on");
    expect(kdata(thread, sf).body).toContain("create_pr_and_invite_reviewers");
  });

  // creator-reply 协议按 creator 窗 data.isForkWindow 区分 fork（父线程）/ peer（对端 thread）措辞。
  // 字段在 inst.data（见 init.ts），故 buildCreatorReplyKnowledge 必须读 data 而非实例顶层。
  function makeCreatorReplyThread(isFork: boolean): ThreadContext {
    const threadId = isFork ? "t_fork" : "t_peer";
    const creatorId = threadWindowIdOf(threadId);
    return makeThreadWithObjects({
      id: threadId,
      skipCreatorWindow: true,
      objectWindows: [
        {
          id: creatorId,
          parentWindowId: "root",
          title: "creator",
          status: "open",
          createdAt: 1,
          class: THREAD_CLASS_ID,
          data: isFork
            ? { target: "self", targetThreadId: "t_up", isForkWindow: true }
            : { target: "alice", targetThreadId: "t_up" },
        },
      ],
    });
  }

  it("creator-reply: fork 窗 → 父线程 / fork 子线程窗 措辞", async () => {
    const thread = makeCreatorReplyThread(true);
    const out = await buildProtocolKnowledgeWindows(thread);
    const cr = out.find((w) => (kdata(thread, w).path ?? "").includes("creator-reply"));
    expect(kdata(thread, cr).body).toContain("父线程");
    expect(kdata(thread, cr).body).toContain("fork 子线程窗");
  });

  it("creator-reply: peer 窗 → 对端 thread / peer 会话窗 措辞", async () => {
    const thread = makeCreatorReplyThread(false);
    const out = await buildProtocolKnowledgeWindows(thread);
    const cr = out.find((w) => (kdata(thread, w).path ?? "").includes("creator-reply"));
    expect(kdata(thread, cr).body).toContain("对端 thread");
    expect(kdata(thread, cr).body).toContain("peer 会话窗");
  });

  it("end-reflection 含 super 沉淀引导且是 hint 非 gate", async () => {
    const thread = makeThreadWithObjects({
      id: "t_end2",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end2" },
      objectWindows: [AGENT_SELF_WIN, endFormSpec()],
    });
    const out = await buildProtocolKnowledgeWindows(thread);
    const er = out.find((w) => kdata(thread, w).path === "end-reflection");
    expect(kdata(thread, er).body).toContain("super");
    // end-reflection 引导「长期记忆走 super flow」（具体 memory 路径细节在 super-flow.md，
    // 不在 end hint 里铺开）。
    expect(kdata(thread, er).body).toContain("长期记忆");
    expect(kdata(thread, er).body).toContain("hint");
  });
});
