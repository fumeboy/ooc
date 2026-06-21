import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "bun:test";
// 注册窗类型（thread/plan/todo/knowledge/file…）进 builtinRegistry —— 否则 render 期
// resolveReadable 取不到投影，全部落 placeholder（Wave4：窗类型经 side-effect import 自声明）。
import "@ooc/core/runtime/register-builtins.js";
import { buildInputItems, type ThreadContext } from "../context";
import { clearKnowledgeLoaderCache } from "../knowledge";

/**
 * 测试 helper：把 buildInputItems 的输入投影回旧的 `{ role, content }[]` 形态，
 * 供只断言 system XML message 的用例使用（生产端只有 buildInputItems）。
 */
async function buildContext(
  thread: ThreadContext,
): Promise<{ role: "system" | "user" | "assistant"; content: string }[]> {
  const out = await buildInputItems(thread);
  return out.input
    .filter((item): item is Extract<typeof item, { type: "message" }> => item.type === "message")
    .map((item) => ({ role: item.role, content: item.content }));
}
import { createStoneObject, createPoolObject, poolKnowledgeDir, writeSelf, ensureStoneRepo, ensureSessionWorktree } from "../../persistable";
import {
  ROOT_WINDOW_ID,
  threadWindowIdOf,
  type ContextWindow,
} from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import { makeThread } from "../../__tests__/make-thread";

/**
 * 构造一个 method_exec window（Wave4 对象模型：业务字段进 inst.data）。
 * activator 的 `method::<type>::<m>` trigger 读 inst.data.method，故 method 必落 data。
 */
function execForm(overrides: {
  id?: string;
  method?: string;
  status?: ContextWindow["status"];
  createdAt?: number;
  title?: string;
  accumulatedArgs?: Record<string, unknown>;
  intentPaths?: string[];
  result?: string;
}): ContextWindow {
  const method = overrides.method ?? "program";
  return {
    id: overrides.id ?? "f_x",
    class: "method_exec",
    parentObjectId: ROOT_WINDOW_ID,
    title: overrides.title ?? "form",
    status: overrides.status ?? "open",
    createdAt: overrides.createdAt ?? 1,
    data: {
      method,
      description: "form description",
      accumulatedArgs: overrides.accumulatedArgs ?? {},
      intentPaths: overrides.intentPaths ?? [method],
      loadedKnowledgePaths: [],
      status: overrides.status ?? "open",
      result: overrides.result,
    },
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
    const inboxItem = out.input.find(
      (item) =>
        item.type === "message" &&
        item.role === "system" &&
        item.content.includes("[context_change:inbox_message_arrived]"),
    );
    expect(inboxItem).toBeDefined();
    const content = (inboxItem as { content: string }).content;
    // header / body 之间用单个 \n 分隔(claude-transport.extractInboxContent 依赖此 contract)
    const newlineIdx = content.indexOf("\n");
    expect(newlineIdx).toBeGreaterThan(0);
    const header = content.slice(0, newlineIdx);
    const body = content.slice(newlineIdx + 1);
    expect(header).toContain("msg_id=msg_in_1");
    expect(header).toContain("source=system");
    expect(header).toContain("from=t_user");
    expect(body).toBe("新的用户输入");
  });

  it("inbox_message_arrived header uses fromObjectId when available", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_obj",
      events: [
        { category: "context_change", kind: "inbox_message_arrived", msgId: "msg_obj" },
      ],
      inbox: [
        {
          id: "msg_obj",
          fromThreadId: "t_caller",
          fromObjectId: "ObjAlice",
          toThreadId: "t_obj",
          content: "hello from alice",
          createdAt: 1,
          source: "talk",
        },
      ],
    });
    const out = await buildInputItems(thread);
    const item = out.input.find(
      (i) => i.type === "message" && i.role === "system" && i.content.includes("[context_change:inbox_message_arrived]"),
    ) as { content: string } | undefined;
    expect(item).toBeDefined();
    const [header, body] = item!.content.split("\n", 2);
    // fromObjectId 优先于 fromThreadId
    expect(header).toContain("from=ObjAlice");
    expect(header).not.toContain("from=t_caller");
    expect(header).toContain("source=talk");
    expect(body).toBe("hello from alice");
  });

  it("inbox_message_arrived header includes window_id from replyToWindowId (case A)", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_reply",
      events: [
        { category: "context_change", kind: "inbox_message_arrived", msgId: "msg_reply" },
      ],
      inbox: [
        {
          id: "msg_reply",
          fromThreadId: "t_user",
          toThreadId: "t_reply",
          content: "回复内容",
          createdAt: 1,
          source: "talk",
          replyToWindowId: "w_talk_42",
        },
      ],
    });
    const out = await buildInputItems(thread);
    const item = out.input.find(
      (i) => i.type === "message" && i.role === "system" && i.content.includes("[context_change:inbox_message_arrived]"),
    ) as { content: string } | undefined;
    const header = item!.content.split("\n", 2)[0]!;
    expect(header).toContain("window_id=w_talk_42");
  });

  it("inbox_message_arrived falls back to creator fork talk_window matching fromThreadId (case B)", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_child",
      events: [
        { category: "context_change", kind: "inbox_message_arrived", msgId: "msg_from_creator" },
      ],
      inbox: [
        {
          id: "msg_from_creator",
          fromThreadId: "t_creator",
          toThreadId: "t_child",
          content: "creator 派的消息",
          createdAt: 1,
          source: "talk",
        },
      ],
      extraWindows: [
        // 普通 fork 子窗(非 creator)同样指向 t_creator。Wave4：stored class=_builtin/agent/thread；
        // resolveInboxWindowId 的 fork 判据读窗实例 data.isForkWindow / data.targetThreadId。
        {
          id: "w_fork_other",
          class: "_builtin/agent/thread",
          parentObjectId: ROOT_WINDOW_ID,
          title: "non-creator",
          status: "open",
          createdAt: 1,
          data: { target: "alice", targetThreadId: "t_creator", isForkWindow: true },
        },
        // creator fork 窗应被优先选中（creator 身份编码在 id=w_creator_<本thread.id>）。
        {
          id: "w_creator_t_child",
          class: "_builtin/agent/thread",
          parentObjectId: ROOT_WINDOW_ID,
          title: "creator",
          status: "open",
          createdAt: 1,
          data: { target: "alice", targetThreadId: "t_creator", isForkWindow: true },
        },
      ] as ContextWindow[],
    });
    const out = await buildInputItems(thread);
    const item = out.input.find(
      (i) => i.type === "message" && i.role === "system" && i.content.includes("[context_change:inbox_message_arrived]"),
    ) as { content: string } | undefined;
    const header = item!.content.split("\n", 2)[0]!;
    expect(header).toContain("window_id=w_creator_t_child");
    expect(header).not.toContain("window_id=w_fork_other");
  });

  it("inbox_message_arrived omits window_id when no source available (case C)", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_lonely",
      events: [
        { category: "context_change", kind: "inbox_message_arrived", msgId: "msg_lonely" },
      ],
      inbox: [
        {
          id: "msg_lonely",
          fromThreadId: "t_unknown",
          toThreadId: "t_lonely",
          content: "无窗口归属",
          createdAt: 1,
          source: "system",
        },
      ],
    });
    const out = await buildInputItems(thread);
    const item = out.input.find(
      (i) => i.type === "message" && i.role === "system" && i.content.includes("[context_change:inbox_message_arrived]"),
    ) as { content: string } | undefined;
    const header = item!.content.split("\n", 2)[0]!;
    expect(header).not.toContain("window_id=");
  });

  it("inbox_message_arrived falls back to defensive body when inbox lookup fails (case D)", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_missing",
      events: [
        { category: "context_change", kind: "inbox_message_arrived", msgId: "msg_ghost" },
      ],
      // 故意不放对应 inbox 消息
      inbox: [],
    });
    const out = await buildInputItems(thread);
    const item = out.input.find(
      (i) => i.type === "message" && i.role === "system" && i.content.includes("[context_change:inbox_message_arrived]"),
    ) as { content: string } | undefined;
    expect(item).toBeDefined();
    const newlineIdx = item!.content.indexOf("\n");
    const header = item!.content.slice(0, newlineIdx);
    const body = item!.content.slice(newlineIdx + 1);
    // header 仍然只输出 msg_id(无 inboxMessage 时其他 KV 不输出)
    expect(header).toBe("[context_change:inbox_message_arrived] msg_id=msg_ghost");
    expect(body).toBe("(inbox message msg_ghost not found)");
  });

  it("replays function_call and function_call_output into next input items", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_function_call_replay",
      events: [
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_1",
          toolName: "exec",
          arguments: { method: "talk", title: "向用户回复" },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "call_1",
          toolName: "exec",
          output: '{"ok":true,"tool":"open"}',
          ok: true,
        },
      ],
    });
    const out = await buildInputItems(thread);
    expect(out.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function_call", call_id: "call_1", name: "exec" }),
        expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
      ]),
    );
  });

  it("renders <context_windows> in system XML and includes creator fork talk_window", async () => {
    const thread: ThreadContext = makeThread({
      id: "t_parent",
      creatorThreadId: "t_root",
    });
    // thread.plan 字段已废弃；用 plan_window 验证 plan 已渲染。Wave4：业务字段进 inst.data。
    const planId = `${thread.id}_plan`;
    thread.contextWindows.push({
      id: planId,
      class: "_builtin/agent/plan", // 注册 class id；readable 投影成 class="plan"
      title: "Plan",
      status: "active",
      createdAt: 0,
      data: { title: "Plan", description: "先处理 inbox", steps: [] },
    } as ContextWindow);
    const messages = await buildContext(thread);
    expect(messages).toHaveLength(1);
    const xml = messages[0]!.content;
    expect(xml).toContain("<context>");
    expect(xml).toContain('<thread id="t_parent" status="running">');
    expect(xml).toContain("<creator_thread_id>t_root</creator_thread_id>");
    expect(xml).toContain("<description>先处理 inbox</description>");
    expect(xml).toContain("<context_windows>");
    // Wave4：creator 自视窗投影 class=thread（self-view 非 super）；plan 实例投影 class=plan。
    expect(xml).toContain('class="thread"');
    expect(xml).toContain('class="plan"');
    expect(xml).toContain("<is_creator_window>true</is_creator_window>");
    // 方法契约在 class 声明层（<window_classes>）声明一次，实例 window 不再带 <methods>。
    expect(xml).toContain("<window_classes");
    // thread/plan class 的方法在各自 <class name=...> 内声明
    const wcStart = xml.indexOf("<window_classes");
    const wcEnd = xml.indexOf("</window_classes>");
    const wcBlock = xml.slice(wcStart, wcEnd);
    expect(wcBlock).toContain('<class name="thread">');
    expect(wcBlock).toContain('<class name="plan">');
    // 负断言：实例 window 不含 <methods> 节点（菜单已搬走，不逐实例重复）
    const cwStart = xml.indexOf("<context_windows>");
    expect(xml.slice(cwStart)).not.toContain("<methods");
  });

  // guidance window 机制已整体退役（form 指引为 plain-string tip 直渲）；
  // 未注册 type 的渲染不崩由下一个测试（fail-soft 占位渲染）通用覆盖。

  it("未注册 peer 对象 type 的 window 渲染不崩（collaborable 回归：world 级 think 崩）", async () => {
    // PeerProcessor/derivePeerObjectWindows 造 type=peer objectId 的 window；若该 peer stone
    // 未注册进 runtime registry（后台注册中 / 新建对象未被 target 命中），renderWindowNode 的
    // getObjectDefinition(peerType) 修复前会抛 → think_error → 全 world 谁都不能 think。
    // fail-soft：未注册 type 走 readable/占位渲染（坐实 registrar 契约「render handles unregistered gracefully」）。
    const thread: ThreadContext = makeThread({ id: "t_peer" });
    thread.contextWindows.push({
      id: "w_peer_expert",
      class: "expert", // 未注册的 peer stone 类型
      title: "expert (peer)",
      status: "open",
      createdAt: 0,
    } as unknown as ContextWindow);
    // 修复前此处抛 'getObjectDefinition: object type "expert" not registered'
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    expect(xml).toContain("<context>");
    expect(xml).toContain('class="expert"'); // 未注册 peer 仍以占位/可用形式渲染
  });

  // 删除（退役机制）：「method_exec form 四态机 + status=failed 时渲 <result>」是已废的 form
  // 机制本身。Wave4 form 机制整体退役（method_exec_form Class 为空占位、无 readable、不再渲 <result>），
  // method_exec 窗只剩信封 status，由 placeholder 投影。该 TC 测的 result-rendering 状态机已不存在。

  it("renders todo_window content + activates_on", async () => {
    const thread = makeThread({
      id: "t_todo",
      extraWindows: [
        {
          // Wave4：实例 inst.class = 注册 class id（_builtin/agent/todo）；readable 投影成 class="todo"。
          id: "w_todo_1",
          class: "_builtin/agent/todo",
          parentObjectId: ROOT_WINDOW_ID,
          title: "记一笔",
          status: "open",
          createdAt: 1,
          data: { content: "记得加单测", activatesOn: ["program.shell"] },
        },
      ] as ContextWindow[],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    expect(xml).toContain('class="todo"');
    expect(xml).toContain("<content>记得加单测</content>");
    expect(xml).toContain("<activates_on>");
    expect(xml).toContain("<path>program.shell</path>");
  });

  it("class 声明层去重：多个同 class 实例 → <window_classes> 内只声明一个 <class>", async () => {
    // 3 个 knowledge 实例（同 class、同方法集）应只产出 1 个 <class name="knowledge">，
    // 而非旧版逐实例抄一份 <methods>（28% 重复的根因）。
    const thread = makeThread({
      id: "t_dup",
      extraWindows: [
        // 实例 inst.class = 注册 class id（_builtin/knowledge_base/knowledge）；readable 投影成 class="knowledge"。
        { id: "k1", class: "_builtin/knowledge_base/knowledge", parentObjectId: ROOT_WINDOW_ID, title: "k1", status: "open", createdAt: 1, data: { path: "a", source: "explicit", body: "A" } },
        { id: "k2", class: "_builtin/knowledge_base/knowledge", parentObjectId: ROOT_WINDOW_ID, title: "k2", status: "open", createdAt: 1, data: { path: "b", source: "explicit", body: "B" } },
        { id: "k3", class: "_builtin/knowledge_base/knowledge", parentObjectId: ROOT_WINDOW_ID, title: "k3", status: "open", createdAt: 1, data: { path: "c", source: "explicit", body: "C" } },
      ] as ContextWindow[],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    const wcBlock = xml.slice(xml.indexOf("<window_classes"), xml.indexOf("</window_classes>"));
    // knowledge class 声明恰好一次（去重）
    const occurrences = wcBlock.split('<class name="knowledge">').length - 1;
    expect(occurrences).toBe(1);
    // 三个实例都在 <context_windows> 出现，但都不带 <methods>
    const cw = xml.slice(xml.indexOf("<context_windows>"));
    expect(cw).toContain('id="k1"');
    expect(cw).toContain('id="k2"');
    expect(cw).toContain('id="k3"');
    expect(cw).not.toContain("<methods");
  });

  // 顶层 inbox 对被窗 transcript 收纳的消息去重（ReadableProjection.consumedMessageIds，
  // commit 69daf4c0 修复 #4）：msg_in_child 进 fork 窗后从顶层 <inbox> 剔除，msg_in_other 保留。
  it("filters fork talk_window transcript by targetThreadId; top-level inbox excludes consumed messages", async () => {
    const thread = makeThread({
      id: "t_p",
      inbox: [
        {
          id: "msg_in_child",
          fromThreadId: "t_child",
          toThreadId: "t_p",
          content: "from child",
          createdAt: 1,
          source: "talk",
        },
        {
          id: "msg_in_other",
          fromThreadId: "t_other",
          toThreadId: "t_p",
          content: "from other",
          createdAt: 2,
          source: "talk",
        },
      ],
      extraWindows: [
        {
          id: "w_fork_child",
          class: "_builtin/agent/thread",
          parentObjectId: ROOT_WINDOW_ID,
          title: "对子线程",
          status: "open",
          createdAt: 1,
          data: { target: "alice", targetThreadId: "t_child", isForkWindow: true },
        },
      ] as ContextWindow[],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]!.content;
    // creator window 也是一种 fork talk_window，targetThreadId="__session__"，会过滤；t_other 没归入任何 fork 窗
    expect(xml).toContain('<message id="msg_in_child"');
    // top level inbox 应该不再含 msg_in_child（已被 w_fork_child 收纳）
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
          toolName: "exec",
          arguments: { method: "todo" },
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
    // tool_use 不进 transcript；thinking 也不进 transcript（仅做记录用）；inject 全部进 transcript（silent-swallow ban）。
    expect(messages.slice(1)).toEqual([
      { role: "assistant", content: "已经完成第一步" },
      {
        role: "system",
        content: "[context_change:inject]\n[refine] Form f_1 已累积参数。当前路径：talk。",
      },
      {
        role: "system",
        content: "[context_change:inject]\n[错误] submit 失败：Form f_missing 不存在。",
      },
    ]);
  });

  // 合成 knowledge window 现用注册 class id KNOWLEDGE_CLASS_ID（commit 69daf4c0 修复 #3），
  // resolveReadable 命中 knowledge readable，body 正常渲染（不再落 placeholder）。
  it("always injects executable basic knowledge into system context", async () => {
    const messages = await buildContext(makeThread({ id: "t1" }));
    const xml = messages[0]?.content ?? "";
    // interaction-core.md（object::root 恒激活）：三原语 + 私有思考空间 + 收尾决策
    expect(xml).toContain("ContextWindow");
    expect(xml).toContain("exec(window_id");
    // wait 新签名：on 必填，reason 可选
    expect(xml).toContain("wait(on");
    // 关键提示：私有思考空间 + 收尾走 talk_window 回报
    expect(xml).toContain("思考空间");
    expect(xml).toContain("talk_window");
  });

  // ObjectMethod API 重构后，form 知识合成（knowledge_window + <path>）已移除：
  // 指引以 plain-string tip 直接渲染在 form 上，跨 form 知识正文去重语义不复存在，原 dedup 测试删除。

  it("emits text content raw — no XML escaping, no CDATA (表意为主)", async () => {
    const thread = makeThread({
      id: "t_cdata",
      extraWindows: [
        execForm({
          id: "f_cdata",
          method: "talk",
          accumulatedArgs: { msg: 'say "hello" & <tag>' },
          intentPaths: ["talk"],
        }),
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    // 原样输出：既不转义也不包 CDATA
    expect(xml).not.toContain("<![CDATA[");
    expect(xml).not.toContain("&quot;");
    expect(xml).not.toContain("&lt;");
    expect(xml).not.toContain("&amp;");
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

  // activator 合成 knowledge window 用 KNOWLEDGE_CLASS_ID（修复 #3）→ readable 命中，
  // summary/full presentation 正常渲染。
  it("renders summary entry when only show_description_when hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const poolRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const root = poolKnowledgeDir(poolRef);
    await writeFile(
      join(root, "summary-only.md"),
      `---\ndescription: 仅描述\nactivates_on:\n  "method::root::program": "show_description"\n---\nbody summary-only`,
    );

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
      extraWindows: [execForm({ id: "f1", method: "program", intentPaths: ["program"] })],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain('class="knowledge"');
    expect(xml).toContain("<source>activator</source>");
    expect(xml).toContain("<presentation>summary</presentation>");
    expect(xml).toContain("<description>仅描述</description>");
    expect(xml).not.toContain("body summary-only");
  });

  it("renders full entry with body when show_content_when hits", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-kn-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const poolRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const root = poolKnowledgeDir(poolRef);
    await writeFile(
      join(root, "full-doc.md"),
      `---\ndescription: 全文\nactivates_on:\n  "method::root::program": "show_content"\n---\n这是 full-doc 正文`,
    );

    const thread = makeThread({
      id: "t",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
      extraWindows: [
        execForm({ id: "f1", method: "program", intentPaths: ["program", "program.shell"] }),
      ],
    });
    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";
    expect(xml).toContain('class="knowledge"');
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

describe("buildInputItems self.md → self 窗 self 视角（不再灌 instructions）", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("self.md 作为 self 窗 self 视角内容渲进 context XML；不再单独灌 instructions", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-self-"));
    const stoneRef = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeSelf(stoneRef, "I am Alice, a careful reviewer.");

    const thread = makeThread({
      id: "t_alice",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "alice", threadId: "t_alice" },
    });
    const out = await buildInputItems(thread);
    // 身份不再灌 system instructions——只活在 self 窗。
    expect(out.instructions).toBeUndefined();

    const xml = (out.input[0] as { content: string }).content;
    // self.md 正文经 self 窗（self 视角）渲进 context；<self> 标记仍在。
    expect(xml).toContain("I am Alice, a careful reviewer.");
    expect(xml).toContain('<self object_id="alice">');
  });

  it("no persistence → 无 instructions、无 <self>", async () => {
    const thread = makeThread({ id: "t_in_memory" });
    const out = await buildInputItems(thread);
    expect(out.instructions).toBeUndefined();

    const xml = (out.input[0] as { content: string }).content;
    expect(xml).not.toContain("<self ");
  });

  it("worktree：业务 session 的 self 窗渲 worktree self.md；其它 session + super 渲 main", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-self-"));
    await ensureStoneRepo({ baseDir: tempRoot });
    await createStoneObject({ baseDir: tempRoot, objectId: "alice", _stonesBranch: "main" });
    await writeSelf({ baseDir: tempRoot, objectId: "alice", _stonesBranch: "main" }, "canonical Alice");
    // identity 入 main（worktree 从 main HEAD checkout 须先 commit）
    const mainDir = join(tempRoot, "stones", "main");
    Bun.spawnSync(["git", "add", "-A"], { cwd: mainDir });
    Bun.spawnSync(
      ["git", "-c", "user.name=t", "-c", "user.email=t@ooc.local", "commit", "-m", "seed"],
      { cwd: mainDir },
    );
    // s1 建 worktree 并写试验值（模拟业务 session 改自己 self.md）
    await ensureSessionWorktree(tempRoot, "s1");
    await writeSelf(
      { baseDir: tempRoot, objectId: "alice", _stonesBranch: "session-s1" },
      "worktree Alice (experiment)",
    );
    const xmlOf = async (t: Parameters<typeof buildInputItems>[0]) =>
      ((await buildInputItems(t)).input[0] as { content: string }).content;

    // s1 的 self 窗读 worktree
    const t1 = makeThread({
      id: "t1",
      persistence: { baseDir: tempRoot, sessionId: "s1", objectId: "alice", threadId: "t1" },
    });
    expect(await xmlOf(t1)).toContain("worktree Alice (experiment)");

    // s2 没有 worktree → 读 canonical main
    const t2 = makeThread({
      id: "t2",
      persistence: { baseDir: tempRoot, sessionId: "s2", objectId: "alice", threadId: "t2" },
    });
    expect(await xmlOf(t2)).toContain("canonical Alice");

    // super flow 读 canonical（不走 worktree）
    const tSuper = makeThread({
      id: "tS",
      persistence: { baseDir: tempRoot, sessionId: "super", objectId: "alice", threadId: "tS" },
    });
    expect(await xmlOf(tSuper)).toContain("canonical Alice");
  });

  it("self.md 缺失/空 → self 窗空、无 instructions；<self> 标记仍在", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-ctx-self-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "bob" });
    // 不写 self.md
    const thread = makeThread({
      id: "t_bob",
      persistence: { baseDir: tempRoot, sessionId: "s", objectId: "bob", threadId: "t_bob" },
    });
    const out = await buildInputItems(thread);
    expect(out.instructions).toBeUndefined();
    // <self> 标记与 self.md 是否存在解耦，仍渲染。
    const xml = (out.input[0] as { content: string }).content;
    expect(xml).toContain('<self object_id="bob">');
  });
});

describe("events compress — self-view fold (win.summarizedRanges)", () => {
  // 折叠 self 视角的 thread.events transcript：载体是**自己视角 thread 窗**（id=threadWindowIdOf(threadId)，
  // class=THREAD_CLASS_ID），其 win.summarizedRanges 把段内连续 events 折成一条 summary 占位（读出侧
  // context/index.ts:buildInputItems find(isSelfThreadWindow)）。不改 thread.events、可逆。
  function makeThreadWindow(threadId: string): ContextWindow & { win: Record<string, unknown> } {
    return {
      id: threadWindowIdOf(threadId),
      class: THREAD_CLASS_ID,
      parentObjectId: ROOT_WINDOW_ID,
      title: "thread",
      status: "open",
      createdAt: 1,
      data: {},
      win: { transient: true },
    } as ContextWindow & { win: Record<string, unknown> };
  }

  const fourTurns: ThreadContext["events"] = [
    { category: "llm_interaction", kind: "text", text: "turn-A" },
    { category: "llm_interaction", kind: "text", text: "turn-B" },
    { category: "llm_interaction", kind: "text", text: "turn-C" },
    { category: "llm_interaction", kind: "text", text: "turn-D" },
  ];

  function assistantTexts(out: Awaited<ReturnType<typeof buildInputItems>>): string[] {
    return out.input
      .filter((i) => i.type === "message" && i.role === "assistant")
      .map((i) => (i as { content: string }).content);
  }

  it("折叠 events[0..2] → 段内折成一条 summary、transcript item 数降、段外原样", async () => {
    const threadWin = makeThreadWindow("t_fold");
    const thread = makeThread({
      id: "t_fold",
      events: fourTurns,
      extraWindows: [threadWin],
      skipCreatorWindow: true,
    });

    const baseline = await buildInputItems(thread);
    expect(assistantTexts(baseline)).toEqual(["turn-A", "turn-B", "turn-C", "turn-D"]);

    threadWin.win.summarizedRanges = [{ fromIdx: 0, toIdx: 2, summary: "早期三轮上下文" }];
    const folded = await buildInputItems(thread);

    // 段内三 events 折成一条 summary 占位；段外 turn-D 原样。
    expect(assistantTexts(folded)).toEqual(["turn-D"]);
    const summary = folded.input.find(
      (i) =>
        i.type === "message" &&
        i.role === "system" &&
        (i as { content: string }).content.includes("events_summary") &&
        (i as { content: string }).content.includes("早期三轮上下文"),
    );
    expect(summary).toBeDefined();
    expect((summary as { content: string }).content).toContain("count=3");
    // 总 item 数下降（3 条折成 1 条）。
    expect(folded.input.length).toBeLessThan(baseline.input.length);
  });

  it("视角隔离：self 折叠不改 thread.events（object data 一字不动）", async () => {
    const threadWin = makeThreadWindow("t_iso");
    const thread = makeThread({
      id: "t_iso",
      events: fourTurns,
      extraWindows: [threadWin],
      skipCreatorWindow: true,
    });
    threadWin.win.summarizedRanges = [{ fromIdx: 0, toIdx: 2, summary: "折叠" }];
    await buildInputItems(thread);
    // thread.events 是 object data —— 折叠只动 win 投影态，events 原封不动（peer 视角读 messages，不受影响）。
    expect(thread.events.length).toBe(4);
    expect(thread.events.map((e) => (e as { text?: string }).text)).toEqual([
      "turn-A",
      "turn-B",
      "turn-C",
      "turn-D",
    ]);
  });

  it("可逆：清空 summarizedRanges（expand）→ transcript 完整还原", async () => {
    const threadWin = makeThreadWindow("t_rev");
    const thread = makeThread({
      id: "t_rev",
      events: fourTurns,
      extraWindows: [threadWin],
      skipCreatorWindow: true,
    });
    threadWin.win.summarizedRanges = [{ fromIdx: 0, toIdx: 2, summary: "折叠" }];
    expect(assistantTexts(await buildInputItems(thread))).toEqual(["turn-D"]);
    threadWin.win.summarizedRanges = [];
    expect(assistantTexts(await buildInputItems(thread))).toEqual([
      "turn-A",
      "turn-B",
      "turn-C",
      "turn-D",
    ]);
  });

  // Case B：折叠区段切断 function_call/function_call_output 配对 → 读出侧吸附到安全边界，不留孤儿
  // tool 块（否则 provider 拒、本轮 think 崩）。events 含 c1、c2 两对工具调用：
  // idx: 0=t0 1=fc(c1) 2=fco(c1) 3=t3 4=fc(c2) 5=fco(c2) 6=t6
  const toolEvents: ThreadContext["events"] = [
    { category: "llm_interaction", kind: "text", text: "t0" },
    { category: "llm_interaction", kind: "function_call", callId: "c1", toolName: "exec", arguments: {} },
    { category: "tool_runtime", kind: "function_call_output", callId: "c1", toolName: "exec", output: "r1", ok: true },
    { category: "llm_interaction", kind: "text", text: "t3" },
    { category: "llm_interaction", kind: "function_call", callId: "c2", toolName: "exec", arguments: {} },
    { category: "tool_runtime", kind: "function_call_output", callId: "c2", toolName: "exec", output: "r2", ok: true },
    { category: "llm_interaction", kind: "text", text: "t6" },
  ];
  function toolCallIds(out: Awaited<ReturnType<typeof buildInputItems>>): {
    calls: string[];
    outs: string[];
  } {
    return {
      calls: out.input.filter((i) => i.type === "function_call").map((i) => (i as { call_id: string }).call_id),
      outs: out.input
        .filter((i) => i.type === "function_call_output")
        .map((i) => (i as { call_id: string }).call_id),
    };
  }

  it("折叠区段同时切断两对（c1 output 半 + c2 call 半）→ 外扩全折、无孤儿", async () => {
    const threadWin = makeThreadWindow("t_caseB_both");
    // [2,4] 覆盖 fco(c1)@2（call@1 在外）+ t3@3 + fc(c2)@4（output@5 在外）→ 两对各被切一半。
    threadWin.win.summarizedRanges = [{ fromIdx: 2, toIdx: 4, summary: "中段折叠" }];
    const thread = makeThread({
      id: "t_caseB_both",
      events: toolEvents,
      extraWindows: [threadWin],
      skipCreatorWindow: true,
    });
    const out = await buildInputItems(thread);
    const { calls, outs } = toolCallIds(out);
    // 无孤儿：output 集合 === call 集合。
    expect(new Set(outs)).toEqual(new Set(calls));
    // 吸附后区段外扩到 [1,5]，两对都进 summary → 无残留 tool 块。
    expect(calls).toEqual([]);
    expect(outs).toEqual([]);
    // 段外原样、摘要出现。
    expect(assistantTexts(out)).toEqual(["t0", "t6"]);
    expect(
      out.input.some(
        (i) => i.type === "message" && i.role === "system" && (i as { content: string }).content.includes("中段折叠"),
      ),
    ).toBe(true);
  });

  it("折叠只切一对（c1）→ c1 整对折进 summary、完整的 c2 对原样保留（不过度折叠）", async () => {
    const threadWin = makeThreadWindow("t_caseB_one");
    // [1,1] 只覆盖 fc(c1)@1，output@2 在外 → 切断 c1；c2 对完全在区段外。
    threadWin.win.summarizedRanges = [{ fromIdx: 1, toIdx: 1, summary: "折 c1" }];
    const thread = makeThread({
      id: "t_caseB_one",
      events: toolEvents,
      extraWindows: [threadWin],
      skipCreatorWindow: true,
    });
    const out = await buildInputItems(thread);
    const { calls, outs } = toolCallIds(out);
    expect(new Set(outs)).toEqual(new Set(calls)); // balanced
    expect(calls).toEqual(["c2"]); // c1 被吸附后整对折叠；c2 原样
    expect(outs).toEqual(["c2"]);
  });
});

describe("transcript 纳入 budget（core10 另一半）", () => {
  // transcript（thread event + creator 对话）是自己视角 thread window 的内容通道，与窗口一并计入
  // 预算账——否则 events append-only 无界增长却不报 soft-warning，终将撑爆 context。
  function budgetWarning(out: Awaited<ReturnType<typeof buildInputItems>>): string | undefined {
    const item = out.input.find(
      (i) =>
        i.type === "message" &&
        i.role === "system" &&
        (i as { content: string }).content.includes("<context_budget_warning"),
    );
    return item ? (item as { content: string }).content : undefined;
  }

  it("estimateTranscriptTokens 随内容量增长（与窗口同口径）", async () => {
    const { estimateTranscriptTokens } = await import("../context/budget");
    const small = estimateTranscriptTokens([{ type: "message", role: "assistant", content: "x" }]);
    const big = estimateTranscriptTokens([
      { type: "message", role: "assistant", content: "x".repeat(4000) },
    ]);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(1000); // 4000 字符 /4 ≈ 1000 token
  });

  it("transcript 体量小：current 不超 soft → 无 budget warning", async () => {
    const thread = makeThread({
      id: "t_budget_small",
      events: [
        { category: "llm_interaction", kind: "text", text: "短叙事一" },
        { category: "llm_interaction", kind: "text", text: "短叙事二" },
      ],
      skipCreatorWindow: true,
    });
    expect(budgetWarning(await buildInputItems(thread))).toBeUndefined();
  });

  it("transcript 体量大：仅 events（无大窗）即把 current 顶过 soft → warning 触发且 current 含 transcript", async () => {
    // 默认 soft=100000 token；60 条 ~9000 字符 text event ≈ 60×2260 ≈ 135K token，仅 transcript 即越 soft。
    const events: ThreadContext["events"] = Array.from({ length: 60 }, (_, i) => ({
      category: "llm_interaction",
      kind: "text",
      text: `第${i}轮：` + "x".repeat(9000),
    }));
    const thread = makeThread({ id: "t_budget_big", events, skipCreatorWindow: true });
    const warn = budgetWarning(await buildInputItems(thread));
    expect(warn).toBeDefined();
    // warning 暴露 transcript 占比，且 transcript 估算应是 current 的主体（证明 transcript 被计入）。
    const m = warn!.match(/current="(\d+)" transcript="(\d+)"/);
    expect(m).not.toBeNull();
    const current = Number(m![1]);
    const transcript = Number(m![2]);
    expect(transcript).toBeGreaterThan(100000); // 仅 transcript 即越 soft
    expect(current).toBeGreaterThanOrEqual(transcript);
    // 指向正确杠杆：transcript 不能 close、只能 compress（v2 无参意图）。
    expect(warn).toContain('exec(method="compress")');
  });

  it("应急兜底：current 越 hard → transcript 本轮被钳、插 marker、thread.events 不动", async () => {
    // 默认 hard=180000 token；100 条 ~9000 字符 text event ≈ 100×2260 ≈ 226K token > hard。
    const events: ThreadContext["events"] = Array.from({ length: 100 }, (_, i) => ({
      category: "llm_interaction",
      kind: "text",
      text: `第${i}轮：` + "x".repeat(9000),
    }));
    const thread = makeThread({ id: "t_clamp", events, skipCreatorWindow: true });
    const out = await buildInputItems(thread);

    // 插了可见 marker（silent-swallow ban），指向 compress。
    const marker = out.input.find(
      (i) =>
        i.type === "message" &&
        i.role === "system" &&
        (i as { content: string }).content.includes("[context_change:context_clamped]"),
    );
    expect(marker).toBeDefined();
    expect((marker as { content: string }).content).toContain('exec(method="compress")');

    // 本轮 transcript 被钳短：assistant 文本项 < 100（最早被省略）。
    const texts = out.input.filter((i) => i.type === "message" && i.role === "assistant");
    expect(texts.length).toBeLessThan(100);
    expect(texts.length).toBeGreaterThan(0); // floor：不清空

    // thread.events 一字不动（瞬态钳制只影响本轮渲染、不改 object data）。
    expect(thread.events.length).toBe(100);
  });
});
