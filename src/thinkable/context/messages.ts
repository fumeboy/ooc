import { serializeXml, type XmlNode } from "../../executable/protocol/xml.js";

import type { Message } from "../llm/client.js";
import type { buildThreadContext } from "./builder.js";
import type { ProcessEvent, ThreadFrameHook } from "../../thinkable/thread-tree/types.js";

/* ========== Context → LLM Messages 转换 ========== */

/* XML 结构化输出辅助已抽到独立模块 src/executable/protocol/xml.ts（便于单元测试） */

/**
 * 将 ThreadContext 转换为 LLM Messages
 *
 * 构建 system + process event messages，XML 结构按嵌套层级缩进：
 * - system：<context> 容器包裹 <identity> / <instructions> / <knowledge> / <task> /
 *   <creator> / <plan> / <inbox> / <todos> / <defers> / <children> / <ancestors> /
 *   <siblings> / <directory> / <paths> / <status>
 * - process event messages：每个历史事件单独渲染为 <process_event>
 *
 * 只有标签行被缩进；叶子节点的 content 原样输出（不破坏 Markdown / 代码块 / 长文本）。
 */
/**
 * 活跃 Form 的简化视图（contextToMessages 侧不关心 FormManager 内部细节）
 *
 * Phase 3 —— llm_input_viewer：把 <active-forms> 从 engine 外部追加改为
 * contextToMessages 内部以 <context> 子节点形式生成。
 */
export interface ActiveFormView {
  formId: string;
  command: string;
  description: string;
  trait?: string;
}

function processEventCategory(event: ProcessEvent): "llm_interaction" | "context_change" {
  if (
    event.type === "thinking"
    || event.type === "text"
    || event.type === "tool_use"
    || event.type === "message_in"
    || event.type === "message_out"
  ) {
    return "llm_interaction";
  }
  return "context_change";
}

function processEventRole(event: ProcessEvent): Message["role"] {
  if (event.type === "thinking" || event.type === "text" || event.type === "tool_use" || event.type === "message_out") {
    return "assistant";
  }
  return "user";
}

function valueNode(tag: string, value: unknown): XmlNode | null {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") {
    return { tag, content: String(value) };
  }
  return { tag, content: JSON.stringify(value, null, 2) };
}

function processEventToMessage(event: ProcessEvent): Message {
  const attrs: Record<string, string | number> = {
    type: event.type,
    category: processEventCategory(event),
    ts: event.timestamp,
  };
  if (event.id) attrs.id = event.id;
  if (event.name) attrs.name = event.name;
  if (event.title) attrs.title = event.title;

  const children: XmlNode[] = [];
  if (event.content) children.push({ tag: "content", content: event.content });
  const args = valueNode("args", event.args);
  if (args) children.push(args);
  const result = valueNode("result", event.result);
  if (result) children.push(result);
  if (typeof event.success === "boolean") children.push({ tag: "success", content: String(event.success) });

  return {
    role: processEventRole(event),
    content: serializeXml([{ tag: "process_event", attrs, children }], 0),
  };
}

export function contextToMessages(
  ctx: ReturnType<typeof buildThreadContext>,
  deferHooks?: ThreadFrameHook[],
  activeForms?: ActiveFormView[],
): Message[] {
  /* ========== context 侧：稳定身份、规则与知识窗口 ========== */
  const systemChildren: XmlNode[] = [];

  /* 身份 */
  systemChildren.push({
    tag: "identity",
    attrs: { name: ctx.name },
    content: ctx.whoAmI,
    comment: "对象身份：readme.md 的完整内容",
  });

  /* 系统指令窗口 */
  if (ctx.instructions.length > 0) {
    systemChildren.push({
      tag: "instructions",
      comment: "系统指令：激活的 kernel trait 注入的行为规则",
      children: ctx.instructions.map(w => {
        const attrs: Record<string, string | number> = { name: w.name };
        /* Phase 3 — llm_input_viewer：source 属性用于前端 hover 溯源 */
        if (w.source) attrs.source = w.source;
        return { tag: "instruction", attrs, content: w.content };
      }),
    });
  }

  /* 知识窗口 */
  if (ctx.knowledge.length > 0) {
    systemChildren.push({
      tag: "knowledge",
      comment: `知识窗口：激活的 library/user trait 和 skill 注入的知识。lifespan="transient" 表示该 trait 由 open(title="...", type=command, ...) 带入，form 关闭即回收；lifespan="pinned" 表示用户已显式固定，或该 trait 是系统协议基座。source 属性标明窗口的注入来源（thread_pinned / command_binding / always_on / skill_index / memory / coverage / build_feedback / file_window / extra / from_parent）。若需保留 transient trait，请 open(title="固定能力", type="trait", name="X", description="...") 固定之。`,
      children: ctx.knowledge.map(w => {
        const attrs: Record<string, string | number> = { name: w.name };
        if (w.lifespan) attrs.lifespan = w.lifespan;
        /* Phase 3 — llm_input_viewer：source 属性用于前端 hover 溯源 */
        if (w.source) attrs.source = w.source;
        return {
          tag: "window",
          attrs,
          content: w.content,
        };
      }),
    });
  }

  const systemRoot: XmlNode = { tag: "system", children: systemChildren };

  /* ========== context 侧：当前任务状态窗口 ========== */
  const userChildren: XmlNode[] = [];

  /* 父线程期望 */
  if (ctx.parentExpectation) {
    userChildren.push({
      tag: "task",
      content: ctx.parentExpectation,
      comment: "任务：用户消息或父线程对当前线程的期望",
    });
  }

  /* 创建者信息 */
  if (ctx.creationMode === "root") {
    userChildren.push({
      tag: "creator",
      attrs: { mode: "root" },
      content: "你是根线程，由用户(user)发起。完成任务后必须用 [return] 返回最终结果。[talk] 只用于向其他对象发消息，不会结束线程。",
    });
  } else {
    userChildren.push({
      tag: "creator",
      attrs: { mode: ctx.creationMode, from: ctx.creator },
      content: `你是子线程，由 ${ctx.creator} 创建（${ctx.creationMode}）。你的职责是完成 <task> 中描述的具体工作，然后用 [return] 返回结果给创建者。不要重复创建者的工作，专注于你被分配的任务。`,
    });
  }

  /* 当前计划 */
  if (ctx.plan) {
    userChildren.push({ tag: "plan", content: ctx.plan });
  }

  /* 局部变量 */
  if (Object.keys(ctx.locals).length > 0) {
    userChildren.push({ tag: "locals", content: JSON.stringify(ctx.locals, null, 2) });
  }

  /* inbox */
  if (ctx.inbox.length > 0) {
    const unread = ctx.inbox.filter(m => m.status === "unread");
    const marked = ctx.inbox.filter(m => m.status === "marked");
    const inboxChildren: XmlNode[] = [];

    if (unread.length > 0) {
      /* 用一个“空 tag”承载分组注释不合适；改为给每条未读消息注入自己的 comment */
      /* 首条 unread 附带分组注释，以减少噪音 */
      for (let i = 0; i < unread.length; i++) {
        const m = unread[i]!;
        /* Phase 6：relation_update_request 徽章渲染——用 <relation_update_request> 标签替代 <message>，
         * 让 LLM 一眼识别出"这是请求我修改关系文件的提议"。正文内容不变，接收方自主决定。 */
        if (m.kind === "relation_update_request") {
          inboxChildren.push({
            tag: "relation_update_request",
            attrs: { id: m.id, from: m.from, ts: m.timestamp },
            content: m.content,
            comment: i === 0
              ? "关系更新请求（Phase 6）：对方希望你在自己的 relations/{他}.md 里记录某内容。请自主决定接受/部分接受/拒绝；engine 不会自动写入，写入需你自己 call file_ops.writeFile 或 editFile"
              : undefined,
          });
          continue;
        }
        inboxChildren.push({
          tag: "message",
          attrs: { id: m.id, from: m.from, status: "unread" },
          content: m.content,
          comment: i === 0 ? "未读消息：请在下次工具调用时通过 mark 参数标记" : undefined,
        });
      }
    }
    if (marked.length > 0) {
      for (let i = 0; i < marked.length; i++) {
        const m = marked[i]!;
        const attrs: Record<string, string | number> = {
          id: m.id, from: m.from, status: "marked",
        };
        if (m.mark) {
          attrs.mark = m.mark.type;
          attrs.tip = m.mark.tip;
        }
        /* Phase 6：即使已 marked，relation_update_request 仍保留其专用标签形态（便于 LLM 回查） */
        const tag = m.kind === "relation_update_request" ? "relation_update_request" : "message";
        inboxChildren.push({
          tag,
          attrs,
          content: m.content,
          comment: i === 0 ? "已标记消息" : undefined,
        });
      }
    }

    userChildren.push({
      tag: "inbox",
      attrs: {
        unread: unread.length,
        marked: marked.length,
      },
      comment: "收件箱：来自其他对象或系统的消息",
      children: inboxChildren,
    });
  }

  /* todos */
  if (ctx.todos.length > 0) {
    userChildren.push({
      tag: "todos",
      children: ctx.todos.map(t => ({ tag: "todo", content: t.content })),
    });
  }

  /* defer hooks：展示已注册的 command hooks，让 LLM 在决策前看到 */
  if (deferHooks && deferHooks.length > 0) {
    const onHooks = deferHooks.filter(h => h.event.startsWith("on:"));
    if (onHooks.length > 0) {
      userChildren.push({
        tag: "defers",
        comment: "defer 提醒：你之前注册的 command hook，对应 command 执行时请注意",
        children: onHooks.map(h => {
          const cmd = h.event.slice(3); /* 去掉 "on:" 前缀 */
          const attrs: Record<string, string | number> = { command: cmd };
          if (h.once === false) attrs.once = "false";
          return { tag: "defer", attrs, content: h.content };
        }),
      });
    }
  }

  /* 子节点摘要 */
  if (ctx.childrenSummary) {
    const allDone = ctx.childrenSummary.includes("[done]")
      && !ctx.childrenSummary.includes("[running]")
      && !ctx.childrenSummary.includes("[pending]")
      && !ctx.childrenSummary.includes("[waiting]");
    const comments: string[] = ["子线程：当前线程创建的子线程状态摘要"];
    if (allDone) comments.push("所有子线程已完成。请汇总子线程的结果，然后用 [return] 返回最终结果。");
    userChildren.push({
      tag: "children",
      content: ctx.childrenSummary,
      comment: comments.join(" / "),
    });
  }

  /* 祖先摘要 */
  if (ctx.ancestorSummary) {
    userChildren.push({ tag: "ancestors", content: ctx.ancestorSummary });
  }

  /* 兄弟摘要 */
  if (ctx.siblingSummary) {
    userChildren.push({ tag: "siblings", content: ctx.siblingSummary });
  }

  /* 通讯录 */
  if (ctx.directory.length > 0) {
    userChildren.push({
      tag: "directory",
      comment: "通讯录：可通过 talk 联系的对象",
      children: ctx.directory.map(d => ({
        tag: "object",
        attrs: { name: d.name },
        content: d.whoAmI,
      })),
    });
  }

  /* <relations> 索引（Phase 5 target 阶段）
   *
   * 仅列出本线程涉及的 peer 对象的一行式关系摘要。LLM 若需全文再
   * open(path="@relation:<peer>") 主动读。缺失 relation 文件的 peer 也会
   * 显示 "(无关系记录)"，让 LLM 感知"存在但未登记"的缺口。 */
  if (ctx.relations && ctx.relations.length > 0) {
    userChildren.push({
      tag: "relations",
      comment: "关系索引：本线程已涉及的对象的关系摘要（一行）；需全文用 open(path=\"@relation:<peer>\")",
      children: ctx.relations.map(r => ({
        tag: "peer",
        attrs: { name: r.name },
        content: r.summary,
      })),
    });
  }

  /* 沙箱路径 */
  if (ctx.paths && Object.keys(ctx.paths).length > 0) {
    userChildren.push({ tag: "paths", content: JSON.stringify(ctx.paths) });
  }

  /* 活跃 Form（Phase 3 — llm_input_viewer）
   *
   * 以前这里由 engine 在 contextToMessages 之后追加到 user message 末尾，
   * 从前端 DOMParser 的角度看它是 <user> 的兄弟节点；现在作为 <context> 的子节点
   * 序列化，语义更清晰、对 LLM 的可见性不变。 */
  if (activeForms && activeForms.length > 0) {
    userChildren.push({
      tag: "active-forms",
      comment: "活跃 Form：已 open 等待 submit 或 close",
      children: activeForms.map(f => {
        const attrs: Record<string, string | number> = {
          id: f.formId,
          command: f.command,
        };
        if (f.trait) attrs.trait = f.trait;
        return { tag: "form", attrs, content: f.description };
      }),
    });
  }

  /* 状态 */
  userChildren.push({ tag: "status", content: ctx.status });

  const contextRoot: XmlNode = {
    tag: "context",
    children: [
      ...systemChildren,
      ...userChildren,
    ],
  };

  const processEvents = "processEvents" in ctx ? ctx.processEvents : [];

  return [
    { role: "system", content: serializeXml([contextRoot], 0) },
    ...processEvents.filter(e => e.type !== "thinking").map(processEventToMessage),
  ];
}
