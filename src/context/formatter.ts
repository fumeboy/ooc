/**
 * Context 格式化器 (G5)
 *
 * 将结构化 Context 转换为 LLM 可读的纯文本 prompt。
 *
 * @ref docs/哲学文档/gene.md#G5 — implements — Context → system prompt + messages 格式化
 * @ref src/types/context.ts — references — Context 类型
 */

import type { Context, Action, FlowMessage } from "../types/index.js";

/**
 * 将 Context 格式化为 system prompt
 *
 * @param ctx - 结构化 Context
 * @returns LLM system prompt 文本
 */
export function formatContextAsSystem(ctx: Context): string {
  const parts: string[] = [];

  /* === WHO AM I === */
  parts.push("=== WHO AM I ===");
  parts.push(`名称: ${ctx.name}`);
  parts.push(ctx.whoAmI || "(未设置自我描述)");
  parts.push("");

  /* === INSTRUCTIONS === (kernel traits: 系统使用说明) */
  if (ctx.instructions.length > 0) {
    parts.push("=== INSTRUCTIONS ===");
    for (const w of ctx.instructions) {
      parts.push(w.content);
      parts.push("");
    }
  }

  /* === KNOWLEDGE === (用户 traits + 动态 windows) */
  if (ctx.knowledge.length > 0) {
    parts.push("=== KNOWLEDGE ===");
    for (const w of ctx.knowledge) {
      parts.push(`[${w.name}]`);
      parts.push(w.content);
      parts.push("");
    }
  }

  /* === DIRECTORY === */
  if (ctx.directory.length > 0) {
    parts.push("=== DIRECTORY ===");
    parts.push("以下是你可以联系的对象：");
    for (const entry of ctx.directory) {
      const methods = entry.functions.length > 0
        ? entry.functions.map((f) => `${f.name}(${f.description})`).join(", ")
        : "无公开方法";
      parts.push(`- ${entry.name}: ${entry.whoAmI || "(无简介)"} | 方法: ${methods}`);
    }
    parts.push("");
  }

  /* === PROCESS === */
  if (ctx.process) {
    parts.push("=== PROCESS ===");
    parts.push(ctx.process);
    parts.push("");
  }

  /* === STATUS === */
  parts.push(`=== STATUS: ${ctx.status} ===`);
  if (ctx.paths) {
    parts.push("");
    parts.push("环境路径（[program] 中可直接使用这些变量）：");
    for (const [key, value] of Object.entries(ctx.paths)) {
      if (value) parts.push(`- ${key} = ${value}`);
    }
  }

  return parts.join("\n");
}

/**
 * 将 Context 的消息历史 + 行为历史格式化为 LLM messages 数组
 *
 * 多轮 ThinkLoop 中，LLM 需要看到：
 * 1. 初始消息（in/out）
 * 2. 自己之前的思考（thought → assistant）
 * 3. 程序执行结果（program → user 反馈）
 *
 * 按时间戳交织 messages 和 actions，构建完整对话历史。
 * 支持 [ref:xxx] 引用解析：当消息中引用了不在当前 context 中的 action/message 时，
 * 自动追加引用补充段落。
 *
 * @param ctx - 结构化 Context
 * @param allActions - 所有节点的 actions（用于 ref 查找）
 * @param allMessages - 所有消息（用于 ref 查找）
 * @returns LLM 对话消息列表
 */
export function formatContextAsMessages(
  ctx: Context,
  allActions?: Action[],
  allMessages?: FlowMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  /* 将 messages 和 actions 统一为带时间戳的事件，按时间排序 */
  type Event = { ts: number; kind: "message" | "action"; idx: number };
  const events: Event[] = [];

  for (let i = 0; i < ctx.messages.length; i++) {
    events.push({ ts: ctx.messages[i]!.timestamp, kind: "message", idx: i });
  }
  for (let i = 0; i < ctx.actions.length; i++) {
    events.push({ ts: ctx.actions[i]!.timestamp, kind: "action", idx: i });
  }

  events.sort((a, b) => a.ts - b.ts);

  /* 构建当前 context 中已有的 ID 集合（用于判断 ref 是否需要补充） */
  const contextActionIds = new Set(ctx.actions.map((a) => a.id).filter((id): id is string => !!id));
  const contextMessageIds = new Set(ctx.messages.map((m) => m.id).filter((id): id is string => !!id));

  const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const event of events) {
    if (event.kind === "message") {
      const msg = ctx.messages[event.idx]!;
      const idTag = msg.id ? ` [${msg.id}]` : "";
      if (msg.direction === "in") {
        msgs.push({
          role: "user",
          content: `[来自 ${msg.from}]${idTag} ${msg.content}`,
        });
      } else {
        msgs.push({
          role: "assistant",
          content: msg.content,
        });
      }
    } else {
      const action = ctx.actions[event.idx]!;

      if (action.type === "thought") {
        /* LLM 的思考输出 → assistant 消息 */
        msgs.push({
          role: "assistant",
          content: action.content,
        });
      } else if (action.type === "program") {
        /* 程序执行结果 → user 反馈（让 LLM 看到执行结果） */
        const feedback = action.result || "(无输出)";
        const idTag = action.id ? ` [${action.id}]` : "";
        msgs.push({
          role: "user",
          content: `[程序执行结果]${idTag}\n${feedback}`,
        });
      } else if (action.type === "inject") {
        /* Hook 注入 → user 反馈（利用 Output 提示 > Bias prompt 的发现） */
        msgs.push({
          role: "user",
          content: action.content,
        });
      } else if (action.type === "action") {
        /* [action/toolName] 结构化工具调用结果 → user 反馈 */
        const feedback = action.result || "(无结果)";
        const idTag = action.id ? ` [${action.id}]` : "";
        const statusTag = action.success === false ? " ❌" : " ✓";
        msgs.push({
          role: "user",
          content: `[工具调用结果${statusTag}]${idTag}\n${feedback}`,
        });
      } else if (action.type === "message_in") {
        /* 收到的消息 → user 反馈 */
        msgs.push({
          role: "user",
          content: action.content,
        });
      }
      /* 其他 action 类型（message_out/pause）暂不加入对话 */
    }
  }

  /* 解析 [ref:xxx] 引用，补充不在当前 context 中的引用内容 */
  if (allActions || allMessages) {
    resolveRefs(msgs, contextActionIds, contextMessageIds, allActions, allMessages);
  }

  return msgs;
}

/** ref 匹配模式 */
const REF_PATTERN = /\[ref:(act_[a-z0-9_]+|msg_[a-z0-9_]+)\]/g;

/** 格式化时间戳为 HH:MM:SS */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

/**
 * 扫描消息内容中的 [ref:xxx]，对不在当前 context 中的引用追加补充段落
 */
function resolveRefs(
  msgs: Array<{ role: "user" | "assistant"; content: string }>,
  contextActionIds: Set<string>,
  contextMessageIds: Set<string>,
  allActions?: Action[],
  allMessages?: FlowMessage[],
): void {
  /* 构建全局查找索引 */
  const actionIndex = new Map<string, Action>();
  if (allActions) {
    for (const a of allActions) {
      if (a.id) actionIndex.set(a.id, a);
    }
  }
  const messageIndex = new Map<string, FlowMessage>();
  if (allMessages) {
    for (const m of allMessages) {
      if (m.id) messageIndex.set(m.id, m);
    }
  }

  for (const msg of msgs) {
    const refs: string[] = [];
    let match: RegExpExecArray | null;
    /* 重置 lastIndex 以确保全局匹配从头开始 */
    REF_PATTERN.lastIndex = 0;
    while ((match = REF_PATTERN.exec(msg.content)) !== null) {
      refs.push(match[1]!);
    }
    if (refs.length === 0) continue;

    const supplements: string[] = [];
    for (const refId of refs) {
      /* 已在当前 context 中的引用不需要补充 */
      if (refId.startsWith("act_")) {
        if (contextActionIds.has(refId)) continue;
        const action = actionIndex.get(refId);
        if (!action) continue;
        const brief = action.content.length > 200 ? action.content.slice(0, 200) + "..." : action.content;
        supplements.push(`[ref:${refId}] (${action.type} @ ${formatTime(action.timestamp)}): ${brief}`);
      } else if (refId.startsWith("msg_")) {
        if (contextMessageIds.has(refId)) continue;
        const message = messageIndex.get(refId);
        if (!message) continue;
        const brief = message.content.length > 200 ? message.content.slice(0, 200) + "..." : message.content;
        supplements.push(`[ref:${refId}] (message from ${message.from} @ ${formatTime(message.timestamp)}): ${brief}`);
      }
    }

    if (supplements.length > 0) {
      msg.content += `\n--- 引用补充 ---\n${supplements.join("\n")}`;
    }
  }
}
