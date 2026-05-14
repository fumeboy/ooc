import { describe, expect, it } from "bun:test";
import { COMMAND_TABLE, executeCommand } from "../commands/index";
import { makeThread } from "../../__tests__/make-thread";

/**
 * 验证 root level command 在 ContextWindow 模型下的副作用。
 *
 * 注：do/todo 都改为产生 window 类型的产物；详见各自专门测试。
 */
describe("command execution side effects", () => {
  it("all commands expose knowledge via CommandTableEntry instead of exported KNOWLEDGE", async () => {
    for (const [command, entry] of Object.entries(COMMAND_TABLE)) {
      const knowledge = entry.knowledge?.({}, "open");
      expect(knowledge?.[`internal/executable/${command}/basic`]).toBeString();
      expect(knowledge?.[`internal/executable/${command}/basic`].length).toBeGreaterThan(0);
    }

    const modules = await Promise.all([
      import("../commands/do"),
      import("../commands/end"),
      import("../commands/plan"),
      import("../commands/talk"),
      import("../commands/todo"),
    ]);
    for (const module of modules) {
      expect("KNOWLEDGE" in module).toBe(false);
    }
  });

  it("plan should write thread.plan", async () => {
    const thread = makeThread({ id: "thread-plan" });
    await executeCommand("plan", {
      thread,
      args: { plan: "完成 thinkloop 真实测试\n\n先打通 tool call 与 command execute" },
    });
    expect(thread.plan).toContain("完成 thinkloop 真实测试");
  });

  it("todo should produce a todo_window in contextWindows", async () => {
    const thread = makeThread({ id: "thread-todo" });
    await executeCommand("todo", {
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
    await executeCommand("end", {
      thread,
      args: { reason: "done", summary: "真实测试可以继续往上叠" },
    });
    expect(thread.status).toBe("done");
    expect(thread.endReason).toBe("done");
    expect(thread.endSummary).toBe("真实测试可以继续往上叠");
  });

  it("talk should be an explicit non-goal in the single object phase", async () => {
    const thread = makeThread({ id: "thread-talk" });
    await executeCommand("talk", {
      thread,
      args: { target: "another-object", msg: "hello" },
    });
    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "[talk] 多 object 交互不属于当前单 object 阶段。",
    });
  });
});
