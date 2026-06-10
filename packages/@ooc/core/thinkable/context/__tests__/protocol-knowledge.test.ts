/**
 * Protocol knowledge —— root builtin knowledge（builtins/root/knowledge/*.md）按 activates_on
 * 命中当前 thread 的篇目，经 buildProtocolKnowledgeWindows 注入为 source=protocol 的 KnowledgeWindow。
 *
 * 验证各交互面命中对应切片、互不串台：
 * - object::root（恒在）→ interaction-core / root-methods
 * - super → super-flow（仅 super session）
 * - method::root::end → end-reflection（开 end form 时）
 */
import { describe, expect, it } from "bun:test";
import { buildProtocolKnowledgeWindows } from "../protocol";
import { makeThread } from "../../../__tests__/make-thread";
import type { MethodExecWindow } from "../../../executable/windows/_shared/types";

function paths(windows: { type: string; path?: string }[]): string[] {
  return windows.filter((w) => w.type === "knowledge").map((w) => w.path ?? "");
}

function makeEndForm(): MethodExecWindow {
  return {
    id: "f_end",
    type: "method_exec",
    parentWindowId: "root",
    title: "end",
    status: "open",
    createdAt: 1,
    description: "",
    method: "end",
    accumulatedArgs: {},
    intentPaths: ["end"],
    loadedKnowledgePaths: [],
  } as MethodExecWindow;
}

describe("root builtin knowledge activation", () => {
  it("object::root 恒激活 interaction-core / root-methods（即便无 persistence）", async () => {
    const out = await buildProtocolKnowledgeWindows(makeThread({ id: "t_mem" }));
    const p = paths(out);
    expect(p).toContain("interaction-core");
    expect(p).toContain("root-methods");
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

  it("开 end form 激活 end-reflection；无 form 时不激活", async () => {
    const withEnd = makeThread({
      id: "t_end",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end" },
      extraWindows: [makeEndForm()],
    });
    const noForm = makeThread({
      id: "t_noform",
      persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_noform" },
    });
    expect(paths(await buildProtocolKnowledgeWindows(withEnd))).toContain("end-reflection");
    expect(paths(await buildProtocolKnowledgeWindows(noForm))).not.toContain("end-reflection");
  });

  it("per-type 知识按 object::<type> 激活、不串台（plan/search/feishu_chat/feishu_doc）", async () => {
    const cases: Array<{ type: string; path: string }> = [
      { type: "plan", path: "plan" },
      { type: "search", path: "search" },
      { type: "feishu_chat", path: "feishu-chat" },
      { type: "feishu_doc", path: "feishu-doc" },
    ];
    for (const c of cases) {
      const withWin = makeThread({
        id: `t_${c.type}`,
        extraWindows: [
          { id: `w_${c.type}`, type: c.type, parentWindowId: "root", title: c.type, status: "open", createdAt: 1 } as any,
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
    const core = out.find((w) => (w as { path?: string }).path === "interaction-core");
    expect(core).toBeDefined();
    expect((core as { source?: string }).source).toBe("protocol");
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
    const sf = out.find((w) => (w as { path?: string }).path === "super-flow") as { body?: string };
    expect(sf?.body).toContain("frontmatter");
    expect(sf?.body).toContain("activates_on");
    expect(sf?.body).toContain("evolve_self");
  });

  it("end-reflection 含 super 沉淀引导且是 hint 非 gate", async () => {
    const out = await buildProtocolKnowledgeWindows(
      makeThread({
        id: "t_end2",
        persistence: { baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end2" },
        extraWindows: [makeEndForm()],
      }),
    );
    const er = out.find((w) => (w as { path?: string }).path === "end-reflection") as { body?: string };
    expect(er?.body).toContain("super");
    expect(er?.body).toContain("memory/<slug>.md");
    expect(er?.body).toContain("hint");
  });
});
