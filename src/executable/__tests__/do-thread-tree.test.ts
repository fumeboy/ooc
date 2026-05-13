import { describe, expect, it } from "bun:test";
import { executeCommand } from "../commands/index";
import type { ThreadContext } from "../../thinkable/context";

describe("do thread tree core", () => {
  it("fork creates a running child thread, writes child inbox, updates parent outbox, and waits when requested", async () => {
    const parent: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: []
    };

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "fork",
        msg: "处理日志中的错误",
        wait: true
      }
    });

    expect(parent.childThreadIds).toHaveLength(1);
    const childId = parent.childThreadIds?.[0] ?? "";
    expect(childId).toBeDefined();
    expect(parent.childThreads?.[childId]?.parentThreadId).toBe("t_parent");
    expect(parent.childThreads?.[childId]?.creatorThreadId).toBe("t_parent");
    expect(parent.childThreads?.[childId]?.status).toBe("running");
    expect(parent.childThreads?.[childId]?.inbox).toEqual([
      {
        id: expect.any(String),
        fromThreadId: "t_parent",
        toThreadId: childId,
        content: "处理日志中的错误",
        createdAt: expect.any(Number),
        source: "do"
      }
    ]);
    expect(parent.outbox).toEqual([
      {
        id: expect.any(String),
        fromThreadId: "t_parent",
        toThreadId: childId,
        content: "处理日志中的错误",
        createdAt: expect.any(Number),
        source: "do"
      }
    ]);
    expect(parent.status).toBe("waiting");
    expect(parent.waitingType).toBe("await_children");
    expect(parent.awaitingChildren).toEqual([childId]);
  });

  it("fork creates an initial todo form in the child thread", async () => {
    const parent: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: []
    };

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "fork",
        msg: "请检查日志"
      }
    });

    const childId = parent.childThreadIds?.[0] ?? "";
    const child = parent.childThreads?.[childId];

    expect(child?.activeForms).toHaveLength(1);
    expect(child?.activeForms?.[0]?.command).toBe("todo");
    expect(child?.activeForms?.[0]?.description).toBe("处理初始消息");
    expect(child?.activeForms?.[0]?.accumulatedArgs).toEqual({
      content: "请检查日志"
    });
  });

  it("fork 与 continue 都通过 inbox_message_arrived 记录新消息，而不是 inject", async () => {
    const parent: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: []
    };

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "fork",
        msg: "处理第一批告警"
      }
    });

    const childId = parent.childThreadIds?.[0] ?? "";
    const child = parent.childThreads?.[childId];
    const firstMsgId = child?.inbox?.[0]?.id;

    expect(firstMsgId).toBeDefined();
    expect(child?.events).toEqual([
      {
        category: "context_change",
        kind: "inbox_message_arrived",
        msgId: firstMsgId
      }
    ]);

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "continue",
        threadId: childId,
        msg: "处理第二批告警"
      }
    });

    const secondMsgId = child?.inbox?.[1]?.id;
    expect(secondMsgId).toBeDefined();
    expect(child?.events).toEqual([
      {
        category: "context_change",
        kind: "inbox_message_arrived",
        msgId: firstMsgId
      },
      {
        category: "context_change",
        kind: "inbox_message_arrived",
        msgId: secondMsgId
      }
    ]);
  });

  it("continue appends inbox to an existing child thread and revives done child to running", async () => {
    const child: ThreadContext = {
      id: "t_child",
      status: "done",
      events: [],
      parentThreadId: "t_parent",
      creatorThreadId: "t_parent",
      inbox: []
    };
    const parent: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: [],
      childThreadIds: ["t_child"],
      childThreads: {
        t_child: child
      }
    };

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "continue",
        threadId: "t_child",
        msg: "继续检查剩余告警"
      }
    });

    expect(parent.childThreads?.t_child?.status).toBe("running");
    expect(parent.childThreads?.t_child?.inbox).toEqual([
      {
        id: expect.any(String),
        fromThreadId: "t_parent",
        toThreadId: "t_child",
        content: "继续检查剩余告警",
        createdAt: expect.any(Number),
        source: "do"
      }
    ]);
    expect(parent.outbox).toEqual([
      {
        id: expect.any(String),
        fromThreadId: "t_parent",
        toThreadId: "t_child",
        content: "继续检查剩余告警",
        createdAt: expect.any(Number),
        source: "do"
      }
    ]);
  });

  it("do.continue with wait=true puts parent into await_children", async () => {
    const child: ThreadContext = {
      id: "t_child",
      status: "done",
      events: [],
      parentThreadId: "t_parent"
    };
    const parent: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: [],
      childThreadIds: ["t_child"],
      childThreads: { t_child: child }
    };

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "continue",
        threadId: "t_child",
        msg: "再做 task B",
        wait: true
      }
    });

    expect(parent.status).toBe("waiting");
    expect(parent.waitingType).toBe("await_children");
    expect(parent.awaitingChildren).toEqual(["t_child"]);
    expect(child.status).toBe("running");
    expect(child.inbox?.length).toBe(1);
  });
});
