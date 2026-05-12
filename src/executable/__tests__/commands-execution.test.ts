import { describe, expect, it } from "bun:test";
import { COMMAND_TABLE, executeCommand } from "../commands/index";
import type { ThreadContext } from "../../thinkable/context";

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
      import("../commands/todo")
    ]);
    for (const module of modules) {
      expect("KNOWLEDGE" in module).toBe(false);
    }
  });

  it("plan should write thread.plan", async () => {
    const thread: ThreadContext = {
      id: "thread-plan",
      status: "running",
      events: []
    };

    await executeCommand("plan", {
      thread,
      args: {
        plan: "完成 thinkloop 真实测试\n\n先打通 tool call 与 command execute"
      }
    });

    expect(thread.plan).toBeDefined();
    expect(thread.plan).toContain("完成 thinkloop 真实测试");
    expect(thread.plan).toContain("先打通 tool call 与 command execute");
  });

  it("todo should rely on form lifecycle and not write standalone thread todos", async () => {
    const thread: ThreadContext = {
      id: "thread-todo",
      status: "running",
      events: []
    };

    await executeCommand("todo", {
      thread,
      args: {
        content: "补充 thinkloop 集成测试",
        on_command_path: ["program", "program.function"]
      }
    });

    expect("todos" in thread).toBe(false);
    expect(thread.activeForms).toBeUndefined();
  });

  it("end should mark thread as done and persist remaining fields", async () => {
    const thread: ThreadContext = {
      id: "thread-end",
      status: "running",
      events: []
    };

    await executeCommand("end", {
      thread,
      args: {
        reason: "done",
        summary: "真实测试可以继续往上叠"
      }
    });

    expect(thread.status).toBe("done");
    expect(thread.endReason).toBe("done");
    expect(thread.endSummary).toBe("真实测试可以继续往上叠");
  });

  it("talk should be an explicit non-goal in the single object phase", async () => {
    const thread: ThreadContext = {
      id: "thread-talk",
      status: "running",
      events: []
    };

    await executeCommand("talk", {
      thread,
      args: {
        target: "another-object",
        msg: "hello"
      }
    });

    expect(thread.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "[talk] 多 object 交互不属于当前单 object 阶段。"
    });
  });
});
