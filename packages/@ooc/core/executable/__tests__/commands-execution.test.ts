import { describe, expect, it } from "bun:test";
import { ROOT_METHODS, execRootMethod } from "../windows";
import { makeThread } from "../../__tests__/make-thread";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";

/**
 * Simulate the old `knowledge(args, status)` API using the new `onFormChange` interface.
 * Returns the same Record<path, content> shape for test backward compatibility.
 */
function callKnowledge(
  cmd: { onFormChange?: unknown; intent?: (args: Record<string, unknown>) => Intent[] },
  args: Record<string, unknown>,
  status: "open" | "executing" | "success" | "failed",
): Record<string, string> {
  const fn = cmd.onFormChange as
    | ((
        change: { kind: string; args?: Record<string, unknown>; to?: string },
        ctx: { form: MethodExecWindow; intents: Intent[] },
      ) => ContextWindow[])
    | undefined;
  if (!fn) return {};
  const form: MethodExecWindow = {
    id: "test_form",
    type: "method_exec",
    parentWindowId: "root",
    title: "test",
    method: "test",
    description: "",
    accumulatedArgs: args,
    intentPaths: [],
    loadedKnowledgePaths: [],
    status,
    createdAt: 0,
  };
  const intents = cmd.intent?.(args) ?? [];
  const change: { kind: string; args?: Record<string, unknown>; to?: string } = (
    status !== "open"
      ? { kind: "status_changed", to: status }
      : { kind: "args_refined", args, added: [], removed: [], changed: [] }
  ) as { kind: string; args?: Record<string, unknown>; to?: string };
  // Some methods early-return [] when change.kind === "status_changed" && change.to !== "open".
  // To reach the right branch when status=open, we must send args_refined.
  // But when status is not "open", we need status_changed. Let's be smarter:
  const windows = fn(change as any, { form, intents });
  const out: Record<string, string> = {};
  for (const w of windows) {
    out[w.title] = (w as any).content ?? "";
  }
  return out;
}

/**
 * 验证 root level method 在 ContextWindow 模型下的副作用。
 *
 * 注：do/todo 都改为产生 window 类型的产物；详见各自专门测试。
 */
describe("method execution side effects", () => {
  it("all methods expose knowledge via ObjectMethod instead of exported KNOWLEDGE", async () => {
    for (const [method, entry] of Object.entries(ROOT_METHODS)) {
      const knowledge = callKnowledge(entry, {}, "open");
      expect(knowledge[`internal/executable/${method}/basic`]).toBeString();
      expect(knowledge[`internal/executable/${method}/basic`].length).toBeGreaterThan(0);
    }

    const modules = await Promise.all([
      import("@ooc/builtins/root/executable/method.do"),
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
    // 2026-05-26: plan 升格为 plan_window；不再写 thread.plan 字段
    await execRootMethod("plan", {
      thread,
      args: { plan: "完成 thinkloop 真实测试\n\n先打通 tool call 与 command execute" },
    });
    const planWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.type === "plan");
    expect(planWindow?.type).toBe("plan");
    expect(planWindow && planWindow.type === "plan" && planWindow.description).toContain(
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
    const todoWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.type === "todo");
    expect(todoWindow?.type).toBe("todo");
    expect(todoWindow && todoWindow.type === "todo" && todoWindow.content).toBe("补充 thinkloop 集成测试");
    expect(
      todoWindow && todoWindow.type === "todo" && todoWindow.activatesOn,
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
    // 反向引用：与 do method 中 _parentThreadRef 的 mechanism 一致
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

    await execRootMethod("end", {
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

  it("talk(target=user, title) creates a talk_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-talk" });
    // P6.§4-§5: execRootMethod 把 constructor outcome 的 object 挂到 thread.contextWindows，
    // 并返回 placeholder string "Constructed talk window <id>"。这里只验证副作用。
    await execRootMethod("talk", {
      thread,
      args: { target: "user", title: "发布计划" },
    });
    const talkWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.type === "talk");
    expect(talkWindow?.type).toBe("talk");
    expect(talkWindow && talkWindow.type === "talk" && talkWindow.target).toBe("user");
    expect(talkWindow && talkWindow.type === "talk" && talkWindow.title).toBe("发布计划");
  });

  it("talk accepts arbitrary objectId target (cross-object)", async () => {
    const thread = makeThread({ id: "thread-talk-other" });
    await execRootMethod("talk", {
      thread,
      args: { target: "researcher", title: "ask" },
    });
    const talkWindow = (thread.contextWindows as ContextWindow[]).find((w) => w.type === "talk");
    expect(talkWindow?.type).toBe("talk");
    expect(talkWindow && talkWindow.type === "talk" && talkWindow.target).toBe("researcher");
  });

  it("talk rejects empty target", async () => {
    const thread = makeThread({ id: "thread-talk-empty" });
    const result = await execRootMethod("talk", {
      thread,
      args: { target: "", title: "x" },
    });
    // P6.§4-§5: constructor 失败时返回 {ok:false, error}; execRootMethod 把 error 直接 return。
    // close/open 引导现在通过 form-input knowledge（formStatus="open"）暴露，不再嵌在错误串里。
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
