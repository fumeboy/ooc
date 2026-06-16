import { describe, expect, it } from "bun:test";
import { ROOT_METHODS, execRootMethod } from "@ooc/core/executable/manager.js";
import { makeThread } from "../../__tests__/make-thread";
import { type ContextWindow, isCreatorWindowId } from "@ooc/core/_shared/types/context-window.js";

/**
 * 验证 root level method 在 ContextWindow 模型下的副作用。
 *
 * 注：talk(fork)/todo 都改为产生 window 类型的产物；详见各自专门测试。
 */
describe("method execution side effects", () => {
  it("all methods expose a description (LLM-facing)", async () => {
    for (const [, entry] of Object.entries(ROOT_METHODS)) {
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(5);
    }

    const modules = await Promise.all([
      import("@ooc/builtins/root/executable/method.end"),
      import("@ooc/builtins/root/executable/method.plan"),
      import("@ooc/builtins/root/executable/method.talk"),
      import("@ooc/builtins/root/executable/method.todo"),
    ]);
    for (const module of modules) {
      expect("KNOWLEDGE" in module).toBe(false);
    }
  });

  it("plan should create a root plan_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-plan" });
    await execRootMethod("plan", {
      thread,
      args: { plan: "完成 thinkloop 真实测试\n\n先打通 tool call 与 command execute" },
    });
    const planWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "plan");
    expect(planWindow?.class).toBe("plan");
    expect(planWindow && planWindow.class === "plan" && planWindow.description).toContain(
      "完成 thinkloop 真实测试",
    );
  });

  it("todo should produce a todo_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-todo" });
    await execRootMethod("todo", {
      thread,
      args: {
        content: "补充 thinkloop 集成测试",
        activates_on: ["program", "exec"],
      },
    });
    const todoWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.class === "todo");
    expect(todoWindow?.class).toBe("todo");
    expect(todoWindow && todoWindow.class === "todo" && todoWindow.content).toBe("补充 thinkloop 集成测试");
    expect(
      todoWindow && todoWindow.class === "todo" && todoWindow.activatesOn,
    ).toEqual(["program", "exec"]);
  });

  it("end should mark thread as done and persist remaining fields", async () => {
    const thread = makeThread({ id: "thread-end" });
    await execRootMethod("end", {
      thread,
      args: { reason: "done", summary: "真实测试可以继续往上叠" },
    });
    expect(thread.status).toBe("done");
    expect(thread.endReason).toBe("done");
    expect(thread.endSummary).toBe("真实测试可以继续往上叠");
  });

  it("end with result writes to creator fork talk_window transcript", async () => {
    const child = makeThread({ id: "thread-end-with-result", creatorThreadId: "t_parent" });
    const parent = makeThread({ id: "t_parent", skipCreatorWindow: true });
    parent.childThreads = { [child.id]: child };
    Object.defineProperty(child, "_parentThreadRef", {
      value: parent,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const creatorBefore = child.contextWindows.find(
      (w) => w.class === "talk" && isCreatorWindowId(w.id),
    );
    expect(creatorBefore?.class).toBe("talk");
    expect((creatorBefore as { isForkWindow?: boolean }).isForkWindow).toBe(true);
    expect((creatorBefore as { status: string }).status).toBe("open");

    await execRootMethod("end", {
      thread: child,
      args: { reason: "done", result: "已完成：见 memo/x.md" },
    });

    expect(child.status).toBe("done");
    expect(child.endReason).toBe("done");
    const out = child.outbox ?? [];
    expect(out.some((m) => m.content === "已完成：见 memo/x.md")).toBe(true);
    // 父收到回报
    expect((parent.inbox ?? []).some((m) => m.content === "已完成：见 memo/x.md")).toBe(true);
  });

  it("end with result but no creator window warns and does not throw", async () => {
    const thread = makeThread({ id: "thread-end-noreply", skipCreatorWindow: true });
    await execRootMethod("end", {
      thread,
      args: { result: "孤立结果，应当被记一笔" },
    });
    expect(thread.status).toBe("done");
    const injected = thread.events.find(
      (e) =>
        e.category === "context_change" &&
        e.kind === "inject" &&
        typeof (e as { text?: string }).text === "string" &&
        (e as { text: string }).text.includes("[end.result]"),
    );
    expect(injected).toBeDefined();
  });

  // peer 会话窗：class=talk, 非 creator、非 fork（区别于 makeThread 默认注入的 creator fork 窗）。
  const findPeerTalk = (windows: ContextWindow[]) =>
    windows.find(
      (w) =>
        w.class === "talk" &&
        !isCreatorWindowId(w.id) &&
        !(w as { isForkWindow?: boolean }).isForkWindow,
    );

  it("talk(target=user, title) creates a peer talk_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-talk" });
    await execRootMethod("talk", {
      thread,
      args: { target: "user", title: "发布计划" },
    });
    const talkWindow = findPeerTalk(thread.contextWindows as ContextWindow[]);
    expect(talkWindow?.class).toBe("talk");
    expect(talkWindow && talkWindow.class === "talk" && talkWindow.target).toBe("user");
    expect(talkWindow && talkWindow.class === "talk" && talkWindow.title).toBe("发布计划");
  });

  it("talk accepts arbitrary objectId target (cross-object)", async () => {
    const thread = makeThread({ id: "thread-talk-other" });
    await execRootMethod("talk", {
      thread,
      args: { target: "researcher", title: "ask" },
    });
    const talkWindow = findPeerTalk(thread.contextWindows as ContextWindow[]);
    expect(talkWindow?.class).toBe("talk");
    expect(talkWindow && talkWindow.class === "talk" && talkWindow.target).toBe("researcher");
  });

  it("talk rejects empty target", async () => {
    const thread = makeThread({ id: "thread-talk-empty" });
    const result = await execRootMethod("talk", {
      thread,
      args: { target: "", title: "x" },
    });
    expect(result).toContain("缺少 target");
  });

  it("talk rejects empty title", async () => {
    const thread = makeThread({ id: "thread-talk-no-title" });
    const result = await execRootMethod("talk", {
      thread,
      args: { target: "user", title: "" },
    });
    expect(result).toContain("缺少 title");
  });

  it("todo rejects empty content", async () => {
    const thread = makeThread({ id: "thread-todo-empty" });
    const result = await execRootMethod("todo", {
      thread,
      args: { content: "" },
    });
    expect(result).toContain("缺少 content");
  });
});
