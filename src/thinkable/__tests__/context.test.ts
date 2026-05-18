import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
import { buildContext, buildInputItems, type ThreadContext } from "../context";
import { clearKnowledgeLoaderCache } from "../knowledge";
import { createStoneObject, knowledgeDir, writeSelf } from "../../persistable";
import {
  ROOT_WINDOW_ID,
  type CommandExecWindow,
  type ContextWindow,
} from "../../executable/windows/types";
import { makeThread } from "../../__tests__/make-thread";

/** 构造一个 command_exec window，便于 context render 测试 */
function execForm(overrides: Partial<CommandExecWindow>): CommandExecWindow {
  return {
    id: overrides.id ?? "f_x",
    type: "command_exec",
    parentWindowId: ROOT_WINDOW_ID,
    title: overrides.title ?? "form",
    status: overrides.status ?? "open",
    createdAt: overrides.createdAt ?? 1,
    command: overrides.command ?? "program",
    description: overrides.description ?? "form description",
    accumulatedArgs: overrides.accumulatedArgs ?? {},
    commandPaths: overrides.commandPaths ?? [overrides.command ?? "program"],
    loadedKnowledgePaths: overrides.loadedKnowledgePaths ?? [],
    commandKnowledgePaths: overrides.commandKnowledgePaths,
    result: overrides.result,
  };
}

describe("buildContext (ContextWindow model)", () => {
  it("buildInputItems returns system item plus inbox-linked msg_id notice", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_items",
      events: [
        { category: "context_change", kind: "inbox_message_arrived", msgId: "msg_in_1" },
      ],
      inbox: [
        {
          id: "msg_in_1",
          fromThreadId: "t_user",
          toThreadId: "t_items",
          content: "新的用户输入",
          createdAt: 1,
          source: "system",
        },
      ],
    });

    const out = await buildInputItems(thread);
    expect(out.input[0]).toEqual(
      expect.objectContaining({ type: "message", role: "system" }),
    );
    expect(
      out.input.some(
        (item) =>
          item.type === "message" &&
          item.role === "system" &&
          item.content.includes("[context_change:inbox_message_arrived]") &&
          item.content.includes("msg_id=msg_in_1"),
      ),
    ).toBe(true);
  });

  it("replays function_call and function_call_output into next input items", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_function_call_replay",
      events: [
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_1",
          toolName: "open",
          arguments: { command: "talk", title: "向用户回复" },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "call_1",
          toolName: "open",
          output: '{"ok":true,"tool":"open"}',
          ok: true,
        },
      ],
    });
    const out = await buildInputItems(thread);
    expect(out.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function_call", call_id: "call_1", name: "open" }),
        expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
      ]),
    );
  });

  it("renders <context_windows> in system XML and includes creator do_window", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_parent",
      creatorThreadId: "t_root",
    });
    thread.plan = "先处理 inbox";
    const messages = await buildContext(thread);
    expect(messages).toHaveLength(1);
    const xml = messages[0]!.content;
    expect(xml).toContain("<context>");
    expect(xml).toContain('<thread id="t_parent" status="running">');
    expect(xml).toContain("<creator_thread_id>t_root</creator_thread_id>");
    expect(xml).toContain("<plan>先处理 inbox</plan>");
    expect(xml).toContain("<context_windows>");
    expect(xml).toContain('type="do"');
    expect(xml).toContain("<is_creator_window>true</is_creator_window>");
  });

  it("renders command_exec form result only when status=executed", async () => {
    const thread = makeThread({
      id: "t_status",
      extraWindows: [
        execForm({ id: "f_open", status: "open" }),
        execForm({ id: "f_executing", status: "executing" }),
        execForm({
          id: "f_executed",
          status: "executed",
          result: "$ ls\n[stdout]\nfoo\n[exit 0]",
        }),
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    expect(xml).toContain('id="f_open" type="command_exec" status="open"');
    expect(xml).toContain('id="f_executing" type="command_exec" status="executing"');
    expect(xml).toContain('id="f_executed" type="command_exec" status="executed"');

    function sliceWindow(id: string): string {
      const start = xml.indexOf(`id="${id}"`);
      const end = xml.indexOf("</window>", start) + "</window>".length;
      return xml.slice(start, end);
    }
    expect(sliceWindow("f_executed")).toContain("<result>$ ls");
    expect(sliceWindow("f_open")).not.toContain("<result>");
    expect(sliceWindow("f_executing")).not.toContain("<result>");
  });

  it("renders todo_window content + on_command_path", async () => {
    const thread = makeThread({
      id: "t_todo",
      extraWindows: [
        {
          id: "w_todo_1",
          type: "todo",
          parentWindowId: ROOT_WINDOW_ID,
          title: "记一笔",
          status: "open",
          createdAt: 1,
          content: "记得加单测",
          onCommandPath: ["program.shell"],
        },
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    expect(xml).toContain('type="todo"');
    expect(xml).toContain("<content>记得加单测</content>");
    expect(xml).toContain("<on_command_path>");
    expect(xml).toContain("<path>program.shell</path>");
  });

  it("filters do_window transcript by targetThreadId; top-level inbox excludes consumed messages", async () => {
    const thread = makeThread({
      id: "t_p",
      inbox: [
        {
          id: "msg_in_child",
          fromThreadId: "t_child",
          toThreadId: "t_p",
          content: "from child",
          createdAt: 1,
          source: "do",
        },
        {
          id: "msg_in_other",
          fromThreadId: "t_other",
          toThreadId: "t_p",
          content: "from other",
          createdAt: 2,
          source: "do",
        },
      ],
      extraWindows: [
        {
          id: "w_do_child",
          type: "do",
          parentWindowId: ROOT_WINDOW_ID,
          title: "对子线程",
          status: "running",
          createdAt: 1,
          targetThreadId: "t_child",
        },
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    // creator window 也是一种 do_window，targetThreadId="__session__"，会过滤；t_other 没归入任何 do_window
    expect(xml).toContain('<message id="msg_in_child"');
    // top level inbox 应该不再含 msg_in_child（已被 w_do_child 收纳）
    const inboxStart = xml.indexOf("<inbox>");
    if (inboxStart !== -1) {
      const inboxEnd = xml.indexOf("</inbox>", inboxStart);
      const inboxBlock = xml.slice(inboxStart, inboxEnd);
      expect(inboxBlock).not.toContain("from child");
      expect(inboxBlock).toContain("from other");
    }
  });

  it("appends only meaningful process events after the system xml", async () => {
    const thread = makeThread({
      id: "t_process",
      events: [
        { category: "llm_interaction", kind: "text", text: "已经完成第一步" },
        { category: "llm_interaction", kind: "thinking", text: "需要先检查上下文" },
        {
          category: "llm_interaction",
          kind: "tool_use",
          toolName: "open",
          arguments: { command: "todo" },
        },
        {
          category: "context_change",
          kind: "inject",
          text: "[refine] Form f_1 已累积参数。当前路径：talk。",
        },
        {
          category: "context_change",
          kind: "inject",
          text: "[错误] submit 失败：Form f_missing 不存在。",
        },
      ],
    });
    const messages = await buildContext(thread);
    expect(messages[0]?.role).toBe("system");
    // tool_use 不进 transcript；普通 inject 不进 transcript；thinking 也不进 transcript（仅做记录用）
    expect(messages.slice(1)).toEqual([
      { role: "assistant", content: "已经完成第一步" },
      {
        role: "system",
        content: "[context_change:error]\n[错误] submit 失败：Form f_missing 不存在。",
      },
    ]);
  });

  it("always injects executable basic knowledge into system context", async () => {
    const messages = await buildContext(makeThread({ id: "t1" }));
    const xml = messages[0]?.content ?? "";
    // KNOWLEDGE 现在的形态：一行一个原语，不再是 "open / refine / submit / close / wait"
    expect(xml).toContain("ContextWindow");
    expect(xml).toContain("open(parent_window_id");
    // wait 新签名（spec 2026-05-17）：on 必填，reason 可选
    expect(xml).toContain("wait(on");
    // 关键提示：思考空间 + talk 是与 user 唯一通道
    expect(xml).toContain("思考空间");
    expect(xml).toContain('command="talk"');
  });

  it("deduplicates identical knowledge entries across multiple forms", async () => {
    const f1 = execForm({
      id: "f_1",
      command: "program",
      accumulatedArgs: { language: "shell", code: "pwd" },
      commandPaths: ["program", "program.shell"],
    });
    const f2 = execForm({
      id: "f_2",
      command: "program",
      accumulatedArgs: { language: "shell", code: "ls" },
      commandPaths: ["program", "program.shell"],
    });
    const thread = makeThread({ id: "t_dedupe", extraWindows: [f1, f2] });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    // basic 出现 2 次（每个 form 一份 path），但合成的 knowledge_window 中只 1 份正文
    expect(xml.match(/<path>internal\/executable\/program\/basic<\/path>/g)?.length).toBe(3);
    expect(xml.match(/program 用于执行一段代码/g)?.length).toBe(1);
  });

  it("wraps text content in CDATA when plain text would require XML escaping", async () => {
    const thread = makeThread({
      id: "t_cdata",
      extraWindows: [
        execForm({
          id: "f_cdata",
          command: "talk",
          accumulatedArgs: { msg: 'say "hello" & <tag>' },
          commandPaths: ["talk"],
        }),
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain("<![CDATA[");
    expect(xml).not.toContain("&quot;hello&quot;");
  });
});

describe("buildContext knowledge synthesis (activator → knowledge_window)", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    clearKnowledgeLoaderCache();
  });

  it("renders summary entry when only show_description_when hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const root = knowledgeDir(stoneRef);
    await writeFile(
      join(root, "summary-only.md"),
      `---\ndescription: 仅描述\nactivates_on:\n  show_description_when: [program]\n---\nbody summary-only`,
    );

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
      extraWindows: [execForm({ id: "f1", command: "program", commandPaths: ["program"] })],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain('type="knowledge"');
    expect(xml).toContain("<source>activator</source>");
    expect(xml).toContain("<presentation>summary</presentation>");
    expect(xml).toContain("<description>仅描述</description>");
    expect(xml).not.toContain("body summary-only");
  });

  it("renders full entry with body when show_content_when hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const root = knowledgeDir(stoneRef);
    await writeFile(
      join(root, "full-doc.md"),
      `---\ndescription: 全文\nactivates_on:\n  show_content_when: [program.shell]\n---\n这是 full-doc 正文`,
    );

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
      extraWindows: [
        execForm({ id: "f1", command: "program", commandPaths: ["program", "program.shell"] }),
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain('type="knowledge"');
    expect(xml).toContain("<source>activator</source>");
    expect(xml).toContain("<presentation>full</presentation>");
    expect(xml).toContain("这是 full-doc 正文");
  });

  it("does not synthesize activator knowledge_window when no activation hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
    });
    const messages = await buildContext(thread);
    // 只会有 protocol 来源的 KNOWLEDGE，没有 activator 来源
    expect(messages[0]?.content).not.toContain("<source>activator</source>");
  });
});

// 防 import 不使用 lint 报错
void [makeThread, ROOT_WINDOW_ID, execForm];

describe("buildInputItems self.md injection", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("returns self.md body as instructions and renders <self object_id> in XML", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-self-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeSelf(stoneRef, "I am Alice, a careful reviewer.");

    const thread = makeThread({
      id: "t_alice",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "alice", threadId: "t_alice" },
    });
    const out = await buildInputItems(thread);
    expect(out.instructions).toBe("I am Alice, a careful reviewer.");

    const xml = (out.input[0] as { content: string }).content;
    expect(xml).toContain('<self object_id="alice">');
  });

  it("omits instructions and <self> when thread has no persistence", async () => {
    const thread = makeThread({ id: "t_in_memory" });
    const out = await buildInputItems(thread);
    expect(out.instructions).toBeUndefined();

    const xml = (out.input[0] as { content: string }).content;
    expect(xml).not.toContain("<self ");
  });

  it("omits instructions when self.md is missing or empty", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-self-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    // 不写 self.md
    const thread = makeThread({
      id: "t_bob",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "bob", threadId: "t_bob" },
    });
    const out = await buildInputItems(thread);
    expect(out.instructions).toBeUndefined();
    // 仍然渲染 <self>：objectId 是稳定标记，与 self.md 是否存在解耦
    const xml = (out.input[0] as { content: string }).content;
    expect(xml).toContain('<self object_id="bob">');
  });
});
