/**
 * Protocol knowledge —— builtin 包 knowledge/*.md 按 activates_on 命中当前 thread 的篇目，
 * 经 buildProtocolKnowledgeWindows 注入为 source=protocol 的 KnowledgeWindow（Wave4：
 * 知识随各 builtin class 包发布，protocol loader 遍历各 builtin 包的 knowledge 目录全量收集）。
 *
 * 验证各交互面命中对应切片、互不串台：
 * - object::root（恒在）→ interaction-core / agency-methods
 * - super → super-flow（仅 super session）
 * - method::_builtin/agent::end → end-reflection（agent self 窗上开 end form 时，经类链匹配）
 */
import { describe, expect, it } from "bun:test";
import { buildProtocolKnowledgeWindows } from "../protocol";
import { makeThread } from "../../../__tests__/make-thread";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";
import { creatorWindowIdOf } from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID, isKnowledgeClass } from "@ooc/core/_shared/types/constants.js";

function paths(windows: { class: string; data?: { path?: string } }[]): string[] {
  // 合成 knowledge 窗 stored class = KNOWLEDGE_CLASS_ID（裸名 "knowledge" 是 readable 投影名）。
  return windows.filter((w) => isKnowledgeClass(w.class)).map((w) => w.data?.path ?? "");
}

// agency（end）跑在 agent 的 self 窗上（class=_builtin/agent），end form 挂在它上面。
// end-reflection 的 activates_on 键 `method::_builtin/agent::end` 经父类匹配命中
// （form.parentObjectId → self 窗 class=_builtin/agent → trigger.objectType=_builtin/agent）。
const AGENT_SELF_WIN: ContextWindow = {
  id: "self_agent",
  class: "_builtin/agent",
  parentObjectId: "root",
  title: "self",
  status: "open",
  createdAt: 1,
  data: {},
};

function makeEndForm(): ContextWindow {
  return {
    id: "f_end",
    class: "method_exec",
    parentObjectId: "self_agent",
    title: "end",
    status: "open",
    createdAt: 1,
    data: { method: "end" },
  };
}

describe("root builtin knowledge activation", () => {
  it("object::root 恒激活 interaction-core / agency-methods（即便无 persistence）", async () => {
    const out = await buildProtocolKnowledgeWindows(makeThread({ id: "t_mem" }));
    const p = paths(out);
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
    expect(paths(await buildProtocolKnowledgeWindows(superThread))).toContain("super-flow");
    expect(paths(await buildProtocolKnowledgeWindows(normalThread))).not.toContain("super-flow");
  });

  it("开 end form → end-reflection full content；无 form 时仅 summary（object::root 恒在 hint）", async () => {
    // end-reflection.md 双键：object::root → show_description（恒在摘要 hint），
    // method::_builtin/agent::end → show_content（开 end form 时升格全文）。
    const withEnd = makeThread({
      id: "t_end",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end" },
      extraWindows: [AGENT_SELF_WIN, makeEndForm()],
    });
    const noForm = makeThread({
      id: "t_noform",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_noform" },
    });
    const findEnd = (out: Awaited<ReturnType<typeof buildProtocolKnowledgeWindows>>) =>
      out.find((w) => w.data?.path === "end-reflection");
    // 开 end form：升格 full content（body 非空）。
    const withEndWin = findEnd(await buildProtocolKnowledgeWindows(withEnd));
    expect(withEndWin?.data?.presentation).toBe("full");
    expect(withEndWin?.data?.body).not.toBe("");
    // 无 form：仅 summary（hint），body 空、不铺开全文。
    const noFormWin = findEnd(await buildProtocolKnowledgeWindows(noForm));
    expect(noFormWin?.data?.presentation).toBe("summary");
    expect(noFormWin?.data?.body).toBe("");
  });

  it("per-type 知识按 object::<type> 激活、不串台（plan/search/feishu_chat/feishu_doc）", async () => {
    const cases: Array<{ class: string; path: string }> = [
      { class: "plan", path: "plan" },
      { class: "search", path: "search" },
      { class: "feishu_chat", path: "feishu-chat" },
      { class: "feishu_doc", path: "feishu-doc" },
    ];
    for (const c of cases) {
      const withWin = makeThread({
        id: `t_`,
        extraWindows: [
          { id: `w_`, class: c.class, parentObjectId: "root", title: c.class, status: "open", createdAt: 1, data: {} } as ContextWindow,
        ],
      });
      const p = paths(await buildProtocolKnowledgeWindows(withWin));
      expect(p).toContain(c.path);
      // 不串台：纯 root thread（无该 window）不应激活
      expect(paths(await buildProtocolKnowledgeWindows(makeThread({ id: "t_bare" })))).not.toContain(c.path);
    }
  });

  it("注入的 window source=protocol", async () => {
    const out = await buildProtocolKnowledgeWindows(makeThread({ id: "t_src" }));
    const core = out.find((w) => w.data?.path === "interaction-core");
    expect(core).toBeDefined();
    expect(core?.data?.source).toBe("protocol");
  });
});

describe("root builtin knowledge content（砍机制留协议后的关键协议仍在）", () => {
  it("super-flow 含 sediment frontmatter 写作协议", async () => {
    const out = await buildProtocolKnowledgeWindows(
      makeThread({
        id: "t_super2",
        persistence: { baseDir: "/tmp/test", sessionId: "super", objectId: "alice", threadId: "t_super2" },
      }),
    );
    const sf = out.find((w) => w.data?.path === "super-flow");
    expect(sf?.data?.body).toContain("frontmatter");
    expect(sf?.data?.body).toContain("activates_on");
    expect(sf?.data?.body).toContain("create_pr_and_invite_reviewers");
  });

  // creator-reply 协议按 creator 窗 data.isForkWindow 区分 fork（父线程）/ peer（对端 thread）措辞。
  // 字段在 inst.data（见 init.ts），故 buildCreatorReplyKnowledge 必须读 data 而非信封顶层。
  function makeCreatorReplyThread(isFork: boolean): Parameters<typeof buildProtocolKnowledgeWindows>[0] {
    const threadId = isFork ? "t_fork" : "t_peer";
    const creatorId = creatorWindowIdOf(threadId);
    return makeThread({
      id: threadId,
      skipCreatorWindow: true,
      extraWindows: [
        {
          id: creatorId,
          class: THREAD_CLASS_ID,
          parentObjectId: "root",
          title: "creator",
          status: "open",
          createdAt: 1,
          data: isFork
            ? { target: "self", targetThreadId: "t_up", isForkWindow: true }
            : { target: "alice", targetThreadId: "t_up" },
        } as ContextWindow,
      ],
    });
  }

  it("creator-reply: fork 窗 → 父线程 / fork 子线程窗 措辞", async () => {
    const out = await buildProtocolKnowledgeWindows(makeCreatorReplyThread(true));
    const cr = out.find((w) => (w.data?.path ?? "").includes("creator-reply"));
    expect(cr?.data?.body).toContain("父线程");
    expect(cr?.data?.body).toContain("fork 子线程窗");
  });

  it("creator-reply: peer 窗 → 对端 thread / peer 会话窗 措辞", async () => {
    const out = await buildProtocolKnowledgeWindows(makeCreatorReplyThread(false));
    const cr = out.find((w) => (w.data?.path ?? "").includes("creator-reply"));
    expect(cr?.data?.body).toContain("对端 thread");
    expect(cr?.data?.body).toContain("peer 会话窗");
  });

  it("end-reflection 含 super 沉淀引导且是 hint 非 gate", async () => {
    const out = await buildProtocolKnowledgeWindows(
      makeThread({
        id: "t_end2",
        persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end2" },
        extraWindows: [AGENT_SELF_WIN, makeEndForm()],
      }),
    );
    const er = out.find((w) => w.data?.path === "end-reflection");
    expect(er?.data?.body).toContain("super");
    // end-reflection 引导「长期记忆走 super flow」（具体 memory 路径细节在 super-flow.md，
    // 不在 end hint 里铺开）。
    expect(er?.data?.body).toContain("长期记忆");
    expect(er?.data?.body).toContain("hint");
  });
});
