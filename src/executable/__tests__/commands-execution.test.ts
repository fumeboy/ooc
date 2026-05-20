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
      import("../windows/root/do"),
      import("../windows/root/end"),
      import("../windows/root/plan"),
      import("../windows/root/talk"),
      import("../windows/root/todo"),
    ]);
    for (const module of modules) {
      expect("KNOWLEDGE" in module).toBe(false);
    }
  });

  it("plan should write thread.plan", async () => {
    const thread = makeThread({ id: "thread-plan" });
    await execRootCommand("plan", {
      thread,
      args: { plan: "完成 thinkloop 真实测试\n\n先打通 tool call 与 command execute" },
    });
    expect(thread.plan).toContain("完成 thinkloop 真实测试");
  });

  it("todo should produce a todo_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-todo" });
    await execRootCommand("todo", {
      thread,
      args: {
        content: "补充 thinkloop 集成测试",
        on_command_path: ["program", "program.function"],
      },
    });
    const todoWindow = thread.contextWindows.find((w) => w.type === "todo");
    expect(todoWindow?.type).toBe("todo");
    expect(todoWindow && todoWindow.type === "todo" && todoWindow.content).toBe("补充 thinkloop 集成测试");
    expect(
      todoWindow && todoWindow.type === "todo" && todoWindow.onCommandPath,
    ).toEqual(["program", "program.function"]);
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
