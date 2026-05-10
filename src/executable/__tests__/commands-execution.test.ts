import { describe, expect, it } from "bun:test";
import { executeCommand } from "../commands/index";
import type { ThreadContext } from "../../thinkable/context";

describe("command execution side effects", () => {
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
});
