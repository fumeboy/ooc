import { describe, expect, it } from "bun:test";
import { ROOT_COMMANDS, execRootCommand } from "../windows";
import { makeThread } from "../../__tests__/make-thread";

/**
 * 验证 root level command 在 ContextWindow 模型下的副作用。
 *
 * 注：do/todo 都改为产生 window 类型的产物；详见各自专门测试。
 */
describe("command execution side effects", () => {
  it("all commands expose knowledge via CommandTableEntry instead of exported KNOWLEDGE", async () => {
    for (const [command, entry] of Object.entries(ROOT_COMMANDS)) {
      const knowledge = entry.knowledge?.({}, "open");
      expect(knowledge?.[`internal/executable/${command}/basic`]).toBeString();
      expect(knowledge?.[`internal/executable/${command}/basic`].length).toBeGreaterThan(0);
    }

    const modules = await Promise.all([
      import("../windows/root/command.do"),
      import("../windows/root/command.end"),
      import("../windows/root/command.plan"),
      import("../windows/root/command.talk"),
      import("../windows/root/command.todo"),
    ]);
    for (const module of modules) {
      expect("KNOWLEDGE" in module).toBe(false);
    }
  });

  it("plan should create a root plan_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-plan" });
    // 2026-05-26: plan 升格为 plan_window；不再写 thread.plan 字段
    await execRootCommand("plan", {
      thread,
      args: { plan: "完成 thinkloop 真实测试\n\n先打通 tool call 与 command execute" },
    });
    const planWindow = thread.contextWindows.find((w) => w.type === "plan");
    expect(planWindow?.type).toBe("plan");
    expect(planWindow && planWindow.type === "plan" && planWindow.description).toContain(
      "完成 thinkloop 真实测试",
    );
  });

  it("todo should produce a todo_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-todo" });
    await execRootCommand("todo", {
      thread,
      args: {
        content: "补充 thinkloop 集成测试",
        on_command_path: ["program", "exec"],
      },
    });
    const todoWindow = thread.contextWindows.find((w) => w.type === "todo");
    expect(todoWindow?.type).toBe("todo");
    expect(todoWindow && todoWindow.type === "todo" && todoWindow.content).toBe("补充 thinkloop 集成测试");
    expect(
      todoWindow && todoWindow.type === "todo" && todoWindow.onCommandPath,
    ).toEqual(["program", "exec"]);
  });

  it("end should mark thread as done and persist remaining fields", async () => {
    const thread = makeThread({ id: "thread-end" });
    await execRootCommand("end", {
      thread,
      args: { reason: "done", summary: "真实测试可以继续往上叠" },
    });
    expect(thread.status).toBe("done");
    expect(thread.endReason).toBe("done");
    expect(thread.endSummary).toBe("真实测试可以继续往上叠");
  });

  // root cause #1 / sub-task 3：end({result}) 在 creator do_window 上自动 reply + auto-archive
  it("end with result writes to creator do_window transcript and archives the window", async () => {
    // makeThread 默认注入了一个指向 placeholder parent 的 creator do_window；构造一个 fake
    // parent thread 通过 _parentThreadRef 挂上，让 do_window.continue 能找到 child（实际逻辑：
    // continue 从 thread 自身向下找 targetThreadId；这里 creator do_window 的 targetThreadId
    // 是"父 thread id"，所以需要 child = parent.childThreads[child.id] 形态——为简化测试，
    // 直接验证 outbox + creator window status 即可）
    const child = makeThread({ id: "thread-end-with-result", creatorThreadId: "t_parent" });
    // 构造一个 fake parent，让 findChild 找得到 targetThreadId="t_parent" 时返回某 thread；
    // 这里只构造最小：把 child 挂到一个 parent 的 childThreads 上
    const parent = makeThread({ id: "t_parent", skipCreatorWindow: true });
    parent.childThreads = { [child.id]: child };
    // 反向引用：与 do command 中 _parentThreadRef 的 mechanism 一致
    Object.defineProperty(child, "_parentThreadRef", {
      value: parent,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // 把 child 视角下的 creator do_window 改成指向 parent
    const creatorBefore = child.contextWindows.find(
      (w) => w.type === "do" && (w as { isCreatorWindow?: boolean }).isCreatorWindow,
    );
    expect(creatorBefore?.type).toBe("do");
    expect((creatorBefore as { status: string }).status).toBe("running");

    await execRootCommand("end", {
      thread: child,
      args: { reason: "done", result: "已完成：见 memo/x.md" },
    });

    expect(child.status).toBe("done");
    expect(child.endReason).toBe("done");
    // child outbox 应包含 reply 消息
    const out = child.outbox ?? [];
    expect(out.some((m) => m.content === "已完成：见 memo/x.md")).toBe(true);
    // creator do_window 自动 archive
    const creatorAfter = child.contextWindows.find(
      (w) => w.type === "do" && (w as { isCreatorWindow?: boolean }).isCreatorWindow,
    );
    expect((creatorAfter as { status: string }).status).toBe("archived");
  });

  it("end with result but no creator window warns and does not throw", async () => {
    const thread = makeThread({ id: "thread-end-noreply", skipCreatorWindow: true });
    // 没有 creator window；end 应 console.warn + 写 inject event，不抛错
    await execRootCommand("end", {
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

  it("talk(target=user, title) creates a talk_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-talk" });
    const result = await execRootCommand("talk", {
      thread,
      args: { target: "user", title: "发布计划" },
    });
    expect(result).toBeUndefined();
    const talkWindow = thread.contextWindows.find((w) => w.type === "talk");
    expect(talkWindow?.type).toBe("talk");
    expect(talkWindow && talkWindow.type === "talk" && talkWindow.target).toBe("user");
    expect(talkWindow && talkWindow.type === "talk" && talkWindow.title).toBe("发布计划");
  });

  it("talk accepts arbitrary objectId target (cross-object)", async () => {
    const thread = makeThread({ id: "thread-talk-other" });
    const result = await execRootCommand("talk", {
      thread,
      args: { target: "researcher", title: "ask" },
    });
    expect(result).toBeUndefined();
    const talkWindow = thread.contextWindows.find((w) => w.type === "talk");
    expect(talkWindow?.type).toBe("talk");
    expect(talkWindow && talkWindow.type === "talk" && talkWindow.target).toBe("researcher");
  });

  it("talk rejects empty target", async () => {
    const thread = makeThread({ id: "thread-talk-empty" });
    const result = await execRootCommand("talk", {
      thread,
      args: { target: "", title: "x" },
    });
    expect(result).toContain("缺少 target");
    expect(result).toContain("close");
    expect(result).toContain("open");
  });

  it("talk rejects empty title (with close+reopen hint)", async () => {
    const thread = makeThread({ id: "thread-talk-no-title" });
    const result = await execRootCommand("talk", {
      thread,
      args: { target: "user", title: "" },
    });
    expect(result).toContain("缺少 title");
    expect(result).toContain("close");
    expect(result).toContain("open");
  });

  it("todo rejects empty content (with close+reopen hint)", async () => {
    const thread = makeThread({ id: "thread-todo-empty" });
    const result = await execRootCommand("todo", {
      thread,
      args: { content: "" },
    });
    expect(result).toContain("缺少 content");
    expect(result).toContain("close");
    expect(result).toContain("open");
  });
});
