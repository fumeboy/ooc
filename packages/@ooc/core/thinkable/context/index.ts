import type { LlmInputItem, LlmMessage } from "../llm/types";
import { objectDir, readSelf, resolveStoneIdentityRef, stoneDir, threadDir } from "../../persistable";
import { createDefaultPipeline } from "./pipeline.js";
import { XmlRenderer } from "./renderers/xml.js";
import type { ProcessEvent, ThreadContext, ThreadMessage } from "../../_shared/types/thread.js";

export type {
  Intent,
  FormChangeEvent,
  MethodCallSchema,
  MethodArgSpec,
  IntentCache,
  IntentCacheEntry,
} from "./intent.js";
export { hashArgs, diffArgs } from "./intent.js";

export { BudgetManager } from "./budget.js";
export type { ContextSnapshot } from "./snapshot.js";
export { XmlRenderer } from "./renderers/xml.js";
export { JsonRenderer } from "./renderers/json.js";
export { TraceRenderer } from "./renderers/trace.js";
export { ContextPipeline, createDefaultPipeline } from "./pipeline.js";
export type { PipelinePhase, PipelineContext } from "./pipeline.js";

/**
 * Thread 运行时类型 —— canonical 源已于 batch C5 迁入 `@ooc/core/_shared/types/thread.ts`；
 * 此处 re-export 保持旧 import 路径 (`thinkable/context`) 可用，并打破
 * thinkable → executable 的类型反向依赖（ContextWindow 现从 `_shared` 单向引入）。
 */
export type {
  ProcessEventCommon,
  ProcessEvent,
  ThreadMessage,
  ThreadStatus,
  ThreadContext,
} from "../../_shared/types/thread.js";

/** 基于 msgId 在 inbox 中查找实际消息正文。 */
function findInboxMessage(thread: ThreadContext, msgId: string): ThreadMessage | undefined {
  return thread.inbox?.find((message) => message.id === msgId);
}

/**
 * 推导 inbox 消息在接收方(当前 thread)视角下所属的 talk/do window id。
 *
 * 推导链:
 * 1. inboxMessage.replyToWindowId — talk-delivery / worker.syncCrossObjectCalleeEnds
 *    在跨 object 投递时已经写入,优先使用
 * 2. fallback: 在 thread.contextWindows 中找一个 type="do" 且
 *    targetThreadId === inboxMessage.fromThreadId 的 window;若多个,优先
 *    isCreatorWindow=true(child 视角下的 creator do_window 是规范配对窗口)
 * 3. 都没有 → undefined,header 中静默不输出 window_id KV
 */
function resolveInboxWindowId(thread: ThreadContext, inboxMessage: ThreadMessage): string | undefined {
  if (inboxMessage.replyToWindowId) return inboxMessage.replyToWindowId;
  const fromThreadId = inboxMessage.fromThreadId;
  if (!fromThreadId) return undefined;
  const candidates = thread.contextWindows.filter(
    (w) => w.type === "do" && (w as { targetThreadId?: string }).targetThreadId === fromThreadId,
  );
  if (candidates.length === 0) return undefined;
  const creator = candidates.find((w) => (w as { isCreatorWindow?: boolean }).isCreatorWindow === true);
  return (creator ?? candidates[0])!.id;
}

/** 把过程事件转换为 Responses-first input items；返回空数组表示该事件不进 transcript。 */
function processEventToItems(thread: ThreadContext, event: ProcessEvent): LlmInputItem[] {
  if (event.category === "context_change" && event.kind === "inbox_message_arrived") {
    const inboxMessage = findInboxMessage(thread, event.msgId);

    // header 行: KV 形式, 每个键只在有值时输出。
    // 关键 contract: header 与 body 之间用单个 \n 分隔 — claude-transport.ts 的
    // extractInboxContent 用第一个 \n 切分 header/body, 把 body 作为 user message,
    // 不要破坏这个边界。
    const headerParts = [`[context_change:${event.kind}] msg_id=${event.msgId}`];
    if (inboxMessage) {
      headerParts.push(`source=${inboxMessage.source}`);
      const fromKey = inboxMessage.fromObjectId ?? inboxMessage.fromThreadId;
      if (fromKey) {
        headerParts.push(`from=${fromKey}`);
      }
      const windowId = resolveInboxWindowId(thread, inboxMessage);
      if (windowId) {
        headerParts.push(`window_id=${windowId}`);
      }
    }
    const header = headerParts.join(" ");

    // body: inbox 消息正文(不截断, 与 talk_window/do_window level 0 渲染对齐);
    // 找不到 inbox 消息时(罕见, 防御性兜底)给 LLM 一条可读提示, 不抛错不打日志。
    let body: string;
    if (inboxMessage) {
      body = inboxMessage.content;
      // event.text 是 ProcessEvent 上的 optional 兼容字段; 当前没有写入点会真的填它,
      // 但保留追加路径(在 content 之后, 用 \n 分隔), 以保持类型契约的向后兼容。
      if (event.text) {
        body = `${body}\n${event.text}`;
      }
    } else {
      body = `(inbox message ${event.msgId} not found)`;
    }

    return [
      {
        type: "message",
        role: "system",
        content: `${header}\n${body}`,
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "context_compressed") {
    // 压缩档位切换:silent-swallow ban 要求 LLM 能看见;以 system message 注入,
    // 简洁陈述档位变化 + 原因,不引入新协议(LLM 看到后可继续 / 也可 expand 回滚)。
    const target = event.windowIds.length > 0 ? event.windowIds.join(",") : "(events scope)";
    return [
      {
        type: "message",
        role: "system",
        content:
          `[context_change:context_compressed] ${event.levelChange} ` +
          `window_ids=${target} reason=${event.reason}` +
          (event.scope ? ` scope=${event.scope}` : ""),
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "scheduler_yielded") {
    // worker 单次 runJob 跑满 workerMaxTicks 后自唤醒,LLM 下轮入口处看到本事件,
    // 知道自己被切片了(区别于 done/paused/failed)。详见 meta/app.server.doc.ts § worker。
    const roundsTag = event.rounds !== undefined ? ` rounds=${event.rounds}` : "";
    return [
      {
        type: "message",
        role: "system",
        content: `[context_change:scheduler_yielded] reason=${event.reason}${roundsTag}`,
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "events_summary") {
    // events 中段被折叠后的摘要节点:LLM 视野中替换被 _foldedBy 标记的原 events,
    // visibility-first 仍可见(否则就 silent-swallow 了)。
    const idTag = event.id ? ` id=${event.id}` : "";
    const earliest = event.earliestEventId ? ` earliest=${event.earliestEventId}` : "";
    const latest = event.latestEventId ? ` latest=${event.latestEventId}` : "";
    const quality = event.qualityHint ? ` quality=${event.qualityHint}` : "";
    const scope = event.scope ? ` scope=${event.scope}` : "";
    return [
      {
        type: "message",
        role: "system",
        content:
          `[context_change:events_summary count=${event.count}${idTag}${earliest}${latest}${quality}${scope}] ` +
          `${event.count} events folded, summary by LLM:\n${event.summary}`,
      },
    ];
  }

  if (event.category === "permission" && event.kind === "permission_ask") {
    // Q0c: 渲染区分 pending / approved / rejected 三态;让 LLM 在 transcript 中看到完整审批历史。
    const windowTag = event.windowId ? ` window_id=${event.windowId}` : "";
    const argsTag = event.argsSummary ? `\n  args: ${event.argsSummary}` : "";
    const decided = event.decided;
    let statusLine: string;
    if (!decided) {
      statusLine = "  status: awaiting human approval; thread paused";
    } else if (decided.action === "approve") {
      statusLine = `  status: approved at ${decided.at}${decided.reason ? ` reason: ${decided.reason}` : ""}`;
    } else {
      statusLine = `  status: rejected at ${decided.at}${decided.reason ? ` reason: ${decided.reason}` : ""}`;
    }
    return [
      {
        type: "message",
        role: "system",
        content:
          `[permission:permission_ask] tool_call_id=${event.toolCallId} command=${event.command}${windowTag}` +
          `${argsTag}\n${statusLine}`,
      },
    ];
  }

  if (event.category === "permission" && event.kind === "permission_denied") {
    // Q0b: deny 路径渲染 — 紧邻位置还会有一条合成的 function_call_output, 这里只补一条
    // 给 LLM 的 system 提示, 便于 LLM 在多步 reasoning 中识别拒绝。
    const windowTag = event.windowId ? ` window_id=${event.windowId}` : "";
    const argsTag = event.argsSummary ? `\n  args: ${event.argsSummary}` : "";
    return [
      {
        type: "message",
        role: "system",
        content:
          `[permission:permission_denied] tool_call_id=${event.toolCallId} command=${event.command}${windowTag}` +
          `\n  reason: ${event.reason}${argsTag}`,
      },
    ];
  }

  if (event.category === "context_change" && event.kind === "inject") {
    // 所有 inject 都进 transcript（silent-swallow ban）：包括 close 拒绝、deprecation 提醒、
    // [interrupted] 恢复提示、end.result 兜底说明等。文案语义由各写入点的前缀
    // ([错误] / [close 拒绝] / [interrupted] / [end.result] / [do] ...) 自带，render
    // 层不再做二次分类。
    return [
      {
        type: "message",
        role: "system",
        content: `[context_change:inject]\n${event.text}`,
      },
    ];
  }

  if (event.kind === "tool_use") {
    return [];
  }

  if (event.kind === "function_call") {
    return [
      {
        type: "function_call",
        call_id: event.callId,
        name: event.toolName,
        arguments: event.arguments
      }
    ];
  }

  if (event.category === "tool_runtime") {
    return [
      {
        type: "function_call_output",
        call_id: event.callId,
        name: event.toolName,
        output: event.output
      }
    ];
  }

  if (event.kind === "thinking") {
    return [];
  }

  // call_started 是 thinkloop 给 recovery 的磁盘锚点 (writeThread 之后即可被读到),
  // 对 LLM 视野无意义, 不进 transcript。详见 ProcessEvent.call_started + recovery.ts。
  if (event.category === "llm_interaction" && event.kind === "call_started") {
    return [];
  }

  return [
    {
      type: "message",
      role: "assistant",
      content: event.text
    }
  ];
}

/**
 * 构造单轮 LLM 输入。
 *
 * 第一条 message 是 XML system context，承载稳定状态窗口；历史过程事件作为后续
 * 普通 messages 追加，避免把 transcript 混入 system prompt。
 */
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  const input = await buildInputItems(thread);
  return input.input
    .filter((item): item is Extract<LlmInputItem, { type: "message" }> => item.type === "message")
    .map((item) => ({ role: item.role, content: item.content }));
}

/** 构造 Responses-first LLM 输入 items。 */
export async function buildInputItems(
  thread: ThreadContext
): Promise<{ instructions?: string; input: LlmInputItem[] }> {
  // Phase F: ContextPipeline + XmlRenderer production path
  const pipeline = createDefaultPipeline();
  const snapshot = await pipeline.run(thread);
  const renderer = new XmlRenderer();
  const content = await renderer.render(snapshot, thread);

  // Observability mirror: stash the pipeline's actually-rendered window set
  // (base + derived: protocol/activator knowledge, peer Objects, form knowledge)
  // so finishLlmLoop's windowsSnapshot reflects what the LLM saw, not just the
  // persisted thread.contextWindows (which omits all derived windows). Transient,
  // never persisted. See _shared/types/thread.ts:_renderedWindows.
  thread._renderedWindows = snapshot.windows;

  // P0f: fold _foldedBy events; events_summary renders as its own placeholder
  const transcript = thread.events.flatMap((event) =>
    event._foldedBy ? [] : processEventToItems(thread, event),
  );

  // self.md instructions (Object identity.innerSelf)
  const instructions = await loadSelfInstructions(thread);

  // [ooc:paths] meta node for metaprogramming / path anchors
  const pathsItem = await buildPathsItem(thread);

  return {
    ...(instructions ? { instructions } : {}),
    input: [
      {
        type: "message",
        role: "system",
        content
      },
      ...(pathsItem ? [pathsItem] : []),
      ...transcript
    ]
  };
}

/**
 * 构造 [ooc:paths] system message。
 *
 * 把以下绝对路径告诉 LLM(每轮都注入,作为元编程 / 路径引用的稳定锚点):
 * - world_root:               OOC world 根目录(stones / flows 等所有子树的父目录)
 * - object_stone_dir:         本 Object 的 stone 目录(身份 / 知识 / server / client 长期存放)
 * - object_flow_dir:          本 Object 在当前 session 下的 flow 目录(临时产出 / 本次任务文件)
 * - current_thread_dir:       当前 thread 的 thread.json 所在目录(debug / loop_*.json 在这里)
 * - session_id / object_id / thread_id:  人类可读的标识
 *
 * 之所以放在 system message 而非 instructions:每轮都需要稳定看到、不被对话历史挤占;
 * 用 system role 与 XML context message 平行 — 都属于"环境信息"。
 */
async function buildPathsItem(thread: ThreadContext): Promise<LlmInputItem | undefined> {
  const ref = thread.persistence;
  if (!ref) return undefined;
  // worktree 模型：object_stone_dir 与 program shell $OOC_SELF_DIR 同源——business
  // session 命中 worktree（已建）时显示 stones/session-<sid>/objects/<id>/，否则 main。
  // 用 "read" 模式：被动每轮注入不应主动建 worktree（惰性，仅首次 identity 写才建）。
  const stoneRef = await resolveStoneIdentityRef(
    { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId },
    "read",
  );
  const lines = [
    "[ooc:paths]",
    `world_root: ${ref.baseDir}`,
    `object_id: ${ref.objectId}`,
    `object_stone_dir: ${stoneDir(stoneRef)}`,
    `object_flow_dir: ${objectDir(ref)}`,
    `session_id: ${ref.sessionId}`,
    `current_thread_id: ${ref.threadId}`,
    `current_thread_dir: ${threadDir(ref)}`,
  ];
  return {
    type: "message",
    role: "system",
    content: lines.join("\n"),
  };
}

/**
 * 读取 thread 所属 Object 的 self.md 作为 instructions。
 *
 * - 内存模式（无 persistence）→ undefined，保持现有测试契约
 * - self.md 不存在或为空 → undefined
 * - 否则返回原文（trim 后非空校验）
 */
async function loadSelfInstructions(thread: ThreadContext): Promise<string | undefined> {
  if (!thread.persistence) return undefined;
  const { baseDir, sessionId, objectId } = thread.persistence;
  // worktree 模型：business session 读自己 worktree 的 self.md（完整副本，含本 session
  // 试验改动）；super flow / 控制面读 canonical main。worktree 未建（没改过 identity）则
  // "read" 透传 main——无 shadow、单目录读。
  const stoneRef = await resolveStoneIdentityRef({ baseDir, sessionId, objectId }, "read");
  const selfText = await readSelf(stoneRef);
  if (!selfText || !selfText.trim()) return undefined;
  return selfText;
}
