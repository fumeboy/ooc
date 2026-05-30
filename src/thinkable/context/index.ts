import type { LlmInputItem, LlmMessage } from "../llm/types";
import { collectExecutableKnowledgeEntries } from "../../executable/index";
import type { ContextWindow } from "../../executable/windows/_shared/types";
import type { ThreadPersistenceRef } from "../../persistable/common";
import { deriveStoneFromThread, objectDir, readSelf, stoneDir, threadDir } from "../../persistable";
import { parseSelfMeta } from "../../executable/prototype";
import { renderContextXml } from "./render";

/**
 * ProcessEvent 共享的可选字段;所有 variants 都可承载它们。
 *
 * - `id` (P0f): events_summary 必须可被 _foldedBy 引用,所以引入稳定 event id 概念。
 *   其他类型的 event 也可选地携带 id (用于 compress(scope=events, target_event_ids) 指定);
 *   旧 thread.json 没有 id 字段属于正常情况,渲染层会按数组下标 fallback。
 * - `_foldedBy` (P0f): 该事件已被某条 events_summary 折叠;渲染时跳过,实际数据仍在
 *   thread.events 中保留。下划线前缀但**保留**进 thread.json (与 _decayMeta 相反),
 *   因为它是 fold 状态的唯一持久化锚点。design §4.2 + 任务 F2/F3。
 */
export type ProcessEventCommon = {
  /** 事件稳定标识 (P0f 引入); events_summary 必填,其他 variants 可选。 */
  id?: string;
  /** P0f: 该事件已被指定 events_summary event id 折叠,渲染层跳过,持久化保留。 */
  _foldedBy?: string;
};

/**
 * 线程过程事件。
 *
 * 只记录 ThinkLoop 单轮会直接产生或消费的事件；持久化、前端时间线和压缩策略
 * 都应围绕这个稳定事件流扩展，而不是把临时状态混入 system context。
 */
export type ProcessEvent = ProcessEventCommon & (
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /**
       * 标记本轮 think 即将真正调 LLM (写完此 event 后立即 writeThread 一次)。
       *
       * 用途: 中断 (SIGKILL / 网络挂死 / 进程重启 / LlmTimeoutError) 后, bootstrap 期
       * detectInterruptedThread 看到尾部 call_started 后无任何后续 llm_interaction 即可
       * 判定 "上一轮 LLM 没跑完", 注入一条 inject 提示让 LLM 下一 tick 看到, 不改 status,
       * 让 worker 正常重新调度。
       *
       * 详见 src/thinkable/recovery.ts。
       */
      kind: "call_started";
      /**
       * 本轮 loop 编号 (来自 beginLlmLoop 的 LlmLoopHandle.loopIndex), observability 字段;
       * recovery 检测不依赖该字段, 只看 kind = "call_started"。
       */
      loopIndex: number;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** 普通文本回复，会作为 assistant message 进入下一轮 transcript。 */
      kind: "text";
      /** LLM 对外可见的文本内容。 */
      text: string;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** 工具调用记录，先进入事件流，再由 executable 分派执行。 */
      kind: "tool_use";
      /** 当前文档定义的 tool 原语名称；compress 暂只保留类型位置。 */
      toolName: "exec" | "close" | "wait" | "compress";
      /** 传给 tool handler 的原始参数对象。 */
      arguments: Record<string, unknown>;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** Responses-first 一等 function_call 记录。 */
      kind: "function_call";
      /** 当前调用的稳定 ID。 */
      callId: string;
      /** 被调用的 OOC tool 名称。 */
      toolName: "exec" | "close" | "wait" | "compress";
      /** 传给 tool handler 的原始参数对象。 */
      arguments: Record<string, unknown>;
    }
  | {
      /** 事件来源：LLM 本轮交互输出。 */
      category: "llm_interaction";
      /** thinking 只用于记录回看，不作为推理上下文复喂。 */
      kind: "thinking";
      /** provider 返回的 thinking 文本。 */
      text: string;
    }
  | {
      /** 事件来源：系统、工具或外部输入导致的上下文变化。 */
      category: "context_change";
      /** 注入给下一轮 LLM 的提示，通常用于错误、状态变化或人工补充。 */
      kind: "inject";
      /** 注入内容，会以 user message 形式进入下一轮 transcript。 */
      text: string;
    }
  | {
      /** 事件来源：外部输入到达，供 context builder 关联 inbox 中的新消息。 */
      category: "context_change";
      /** inbox 中有新消息到达。 */
      kind: "inbox_message_arrived";
      /** 到达消息的稳定标识。 */
      msgId: string;
      /** 可选的附加提示文本。 */
      text?: string;
    }
  | {
      /** 事件来源：tool 运行时结果。 */
      category: "tool_runtime";
      /** function_call 的输出结果。 */
      kind: "function_call_output";
      /** 与 function_call 对应的调用 ID。 */
      callId: string;
      /** 对应的 tool 名称。 */
      toolName: "exec" | "close" | "wait" | "compress";
      /** 序列化后的输出字符串。 */
      output: string;
      /** 是否成功。 */
      ok: boolean;
    }
  | {
      /**
       * 事件来源：context 压缩档位变化。
       *
       * 由 compress tool / expand command / 后续 phase 的自然衰减 + emergency guard 触发,
       * design: docs/2026-05-25-context-compression-design.md §F(silent-swallow ban) /
       * §4.5 / §4.4。每次压缩档位切换写一条本事件,与现有 ProcessEvent 同序进 thread.json /
       * debug 落盘 / contextSnapshot,LLM 视野中也可见。
       */
      category: "context_change";
      /** 压缩档位切换:每次 compressLevel 变化一次写一条。 */
      kind: "context_compressed";
      /** 受影响的 window id 列表(events scope 时为空数组)。 */
      windowIds: string[];
      /** 档位变化,形如 "0→1" / "1→0" / "1→2"。 */
      levelChange: string;
      /** 触发原因:user-compress / user-expand / idle-fold / age-fold / emergency 等。 */
      reason: string;
      /** 触发 scope:windows / events / auto;LLM 主动 compress 时来自 args。 */
      scope?: "windows" | "events" | "auto";
    }
  | {
      /**
       * 事件来源：runJob 单次跑满 workerMaxTicks 自然返回，且 thread.status 仍为 running。
       *
       * 设计：meta/app.server.doc.ts § worker.scheduler_yielded。worker 出口在写完本事件后
       * 调 jobManager.createRunThreadJob 让自己再入队一次，让长任务跨 job 续跑。
       * LLM 下轮可见，区别于自然 done / paused / failed。
       */
      category: "context_change";
      kind: "scheduler_yielded";
      /** 触发原因：当前只有 max_ticks，未来可扩展（如 cooperative_yield）。 */
      reason: "max_ticks";
      /** 触发时已跑过的 LLM 轮数（call_started 计数），observability。 */
      rounds?: number;
    }
  | {
      /**
       * 事件来源：events 流中段折叠后形成的摘要节点。
       *
       * Design: docs/2026-05-25-context-compression-design.md §4.2 / §4.4
       * P0f 任务 F1: 由 LLM 在 compress(scope=events, summary=...) 调用中主动提供摘要文本。
       * 未来 P0e emergency guard 也可触发本 event (scope="auto") — 那时 summary 是占位文本。
       *
       * 渲染策略 (processEventToItems): events_summary 渲染为一条 system message,
       * 内含 count + summary,LLM 视野中替换被 _foldedBy 标记的原 events 序列。
       */
      category: "context_change";
      /** events 流中段被折叠为一条摘要。 */
      kind: "events_summary";
      /** 被折叠掉的原 event 数量。 */
      count: number;
      /** 被折叠区段最早 event 的 id (可选; 旧 event 可能无 id)。 */
      earliestEventId?: string;
      /** 被折叠区段最晚 event 的 id (可选; 旧 event 可能无 id)。 */
      latestEventId?: string;
      /** 摘要正文; LLM 在 compress(scope=events) 调用中提供。 */
      summary: string;
      /** 摘要质量提示 (LLM 自评 / P0e auto 时为 "rough")。 */
      qualityHint?: "rough" | "curated";
      /** 谁触发本次 fold: user=LLM 主动 compress, auto=未来 emergency_guard 自动触发。 */
      scope?: "user" | "auto";
    }
  | {
      /**
       * 事件来源: thinkloop 在 dispatchToolCall 之前调 decidePermission 返回 "ask"。
       *
       * Design: docs/2026-05-25-permission-model-design.md
       * Meta:   meta/object.doc.ts:executable.children.permission.patches.approve_reject_path
       *
       * Q0b: 写完事件后 thread.status="paused"。
       * Q0c: HTTP endpoint 写入 decided 字段 + 翻回 running; thinkloop 在 resume 路径
       *      扫"最近一条 permission_ask"按 decided.action 处理:
       *        approve → 用 pendingCall 字段重放该 tool call (绕过 decidePermission)
       *        reject  → 写 permission_denied + 合成 function_call_output
       *
       * 渲染层根据 decided 区分 pending / approved / rejected 三态 system message。
       */
      category: "permission";
      kind: "permission_ask";
      /** 触发本次 ask 的 function_call id (与 llm_interaction.function_call.callId 对齐)。 */
      toolCallId: string;
      /** 解析后的实际 command 路径 (例如 "talk", "write_file" 或 "exec" / "close" 等 tool 名)。 */
      command: string;
      /** args 摘要 (截断到 200 字以内, 防止 events 流爆炸)。 */
      argsSummary?: string;
      /** exec 时目标 window id。 */
      windowId?: string;
      /**
       * Q0c: HITL 审批决议。无 → 待审批; "approve" → 已批准 (thinkloop resume 时重放);
       * "reject" → 已拒绝 (thinkloop resume 时合成 denied + function_call_output)。
       */
      decided?: {
        action: "approve" | "reject";
        at: number;
        reason?: string;
      };
      /**
       * Q0c: 完整序列化的原 pending tool call。approve 路径用它直接 dispatchToolCall,
       * 不依赖 LLM 重新发起 (LLM 可能换 args 或干脆不发了)。
       *
       * 字段冗余 (toolCallId / command / windowId 已经在外层) 是为了一站式重建 LlmToolCall,
       * 避免 resume 路径再次推断。
       */
      pendingCall?: {
        toolName: "exec" | "close" | "wait" | "compress";
        command: string;
        args: Record<string, unknown>;
        windowId?: string;
        toolCallId: string;
      };
    }
  | {
      /**
       * 事件来源: thinkloop 在 dispatchToolCall 之前调 decidePermission 返回 "deny"。
       *
       * Design + meta 同 permission_ask。
       *
       * 系统已拒绝该 tool call, 并合成了一条 function_call_output (在 thread.events
       * 紧邻位置) 让 LLM 看见拒绝原因 (silent-swallow ban + Deny 信息流不变量)。
       */
      category: "permission";
      kind: "permission_denied";
      /** 被拒绝的 function_call id。 */
      toolCallId: string;
      /** 实际 command 路径。 */
      command: string;
      /** 拒绝原因 (来自 PermissionDecision.reason 或默认描述)。 */
      reason: string;
      /** args 摘要 (截断到 200 字)。 */
      argsSummary?: string;
      /** exec 时目标 window id。 */
      windowId?: string;
    }
);

/** 线程之间通过 inbox/outbox 传递的最小消息模型。 */
export type ThreadMessage = {
  /** 消息唯一标识；当前由创建方生成，不要求全局可排序。 */
  id: string;
  /** 发送消息的线程 ID。 */
  fromThreadId: string;
  /** 接收消息的线程 ID。 */
  toThreadId: string;
  /** 发送方的 flow object id；跨对象 talk 时由 deliverTalkMessage 写入,便于 UI 标注发送方身份。
   *  旧 thread.json 缺该字段;前端要兼容空值。 */
  fromObjectId?: string;
  /** 消息正文，直接作为接收线程可见的协作输入。 */
  content: string;
  /** 创建时间戳，用于排序和调试，不承担强一致时钟语义。 */
  createdAt: number;
  /** 消息来源；step 2 加入 talk 与外部用户对话；user 区分"控制面代用户派送的 talk"。 */
  source: "do" | "system" | "talk" | "user";
  /**
   * 消息归属的 window id；
   * - 由 talk_window.say 写 outbox 时设置为该 talk_window 的 id
   * - 由 do_window.continue 可选设置（do_window 视图实际用 targetThreadId 过滤，本字段非必需）
   */
  windowId?: string;
  /**
   * 该消息是哪个 window 的回复目标；
   * - 由控制面 user-reply 路径填入：当 user 选择回复某个 talk_window 时，
   *   写入新 inbox 消息的 replyToWindowId = 那个 talk_window 的 id
   * - render 层据此把消息归入对应 talk_window 的 transcript
   */
  replyToWindowId?: string;
};

/**
 * 单个线程的运行时上下文。
 *
 * 这是 buildContext / think / scheduler 共享的最小结构，不等同于完整持久化模型。
 *
 * Step 1 重构（spec 2026-05-14）：
 * - 删除 activeForms / windows / pinnedKnowledge / waitingType / awaitingChildren
 * - 新增 contextWindows（统一抽象）+ threadLocalData（program_window step 2 使用，先占位）
 * - status="waiting" 单独表达"等待 inbox 新消息"，不再细分 waitingType（spec § 等待语义的简化）
 */
export type ThreadContext = {
  /** 线程唯一标识；同时用于 XML context 中的 thread id。 */
  id: string;
  /** 调度状态；status="waiting" 表示等待 inbox 新消息，不再有 waitingType 细分。 */
  status: "running" | "waiting" | "done" | "failed" | "paused";
  /** 当前线程的过程事件流，会被转换成 system message 之后的普通 LLM messages。 */
  events: ProcessEvent[];
  /** 线程树中的直接父线程；root thread 没有该字段。 */
  parentThreadId?: string;
  /** 创建本线程任务的线程，用于后续向 creator 汇报结果。 */
  creatorThreadId?: string;
  /**
   * 创建本线程的 object id；与 thread.persistence.objectId 比较即可判断 creator 是否=自己：
   * - 相同（含缺省，视为 fork） → creator 关系是 do（同 object 内派生子线程）
   * - 不同 → creator 关系是 talk（跨 object 的 callee thread）
   *
   * 由 talk-delivery / fork helper 在创建 callee/child thread 时写入；
   * 历史 thread.json 没有此字段时保守按"相同"处理（do）。
   */
  creatorObjectId?: string;
  /**
   * 创建本线程的 session id（C5：cross-session notify 修复，2026-05-25）。
   *
   * 大多数 thread 的 creator 与自己在同一 session，此时该字段与 persistence.sessionId 相等，
   * 通常缺省。**关键场景**：super-alias 派送时 callee thread 在 "super" session，
   * 但 caller thread 在 user session——此字段记录 caller 的 sessionId，让
   * notifyThreadActivated / end({result}) auto-reply 知道把 enqueue 派到哪个 session。
   *
   * 缺省回退（向后兼容）：使用 thread.persistence.sessionId（同 session）。
   *
   * 由 talk-delivery 在跨 session 创建 callee thread 时写入；其他路径可不设。
   */
  creatorSessionId?: string;
  /** 子线程 ID 列表，保留创建顺序，便于展示和调试。 */
  childThreadIds?: string[];
  /** 子线程实体表；当前内存实现直接嵌套，不引入独立存储层。 */
  childThreads?: Record<string, ThreadContext>;
  /**
   * 父 thread 反向引用（运行时设置，不持久化）。
   *
   * 用于 do_window.move 等命令需要从子 thread 访问父 thread 的场景；
   * 由 fork 路径（root.do executeDoCommand）在创建 child 时建立。
   * thread.json 序列化时被 strip（避免循环引用）。
   */
  _parentThreadRef?: ThreadContext;
  /** 其他线程投递给当前线程的消息。 */
  inbox?: ThreadMessage[];
  /** 当前线程发出的协作消息记录。 */
  outbox?: ThreadMessage[];
  /**
   * 当前线程的所有 ContextWindow（flat 数组，层级通过 parentWindowId 表达）。
   *
   * 取代旧的 activeForms / windows / pinnedKnowledge 三套并列字段。
   * 见 src/executable/windows/_shared/types.ts 与 spec § 模型骨架。
   */
  contextWindows: ContextWindow[];
  /**
   * thread-local 共享数据；Step 2 program_window 的 ts/js exec 之间通过这里传值
   * （spec § program_window 的"跨 exec 数据传递"段）。Step 1 仅占位、不读不写。
   */
  threadLocalData?: Record<string, unknown>;
  /** end command 写入的结束原因。 */
  endReason?: string;
  /** end command 写入的最终摘要。 */
  endSummary?: string;
  /**
   * 结构化失败原因（observability 根因 #4，2026-05-27）。
   *
   * 当 status="failed" 由 thinkloop catch 块写入时，给出机读的失败分类，让控制面 /
   * GET .../threads/:id 不必去 events 里扒文本：
   * - "llm_timeout"：LlmTimeoutError（LLM 调用超时兜底触发）
   * - "think_error"：think 单轮中其他异常
   *
   * 仅失败终态写入；done/running/waiting/paused 不带此字段。
   */
  statusReason?: string;
  /** 失败时的人读错误消息（与 statusReason 配套；observability 根因 #4）。 */
  lastError?: string;
  /**
   * 任务级 LLM 超时覆盖（ms；observability 根因 #1，2026-05-27）。
   *
   * 缺省时 think → llmClient.generate 回落全局默认（120s，由 OOC_LLM_TIMEOUT_MS 覆写）。
   * 设置后本 thread 的每轮 generate 用此值兜底超时，让"已知慢任务"能申请更长超时，
   * 而不必全局拔高（全局拔高会让真卡死 thread 拖更久才暴露，反伤 observability）。
   */
  llmTimeoutMs?: number;
  /** 最近一次被 scheduler 执行的时间，用于公平选择下一个 running thread。 */
  lastExecutedAt?: number;
  /**
   * 入眠时刻 inbox 长度快照；scheduler 唤醒时对比当前 inbox.length 判断是否有新消息。
   * status="waiting" 时由 wait tool 写入；唤醒后由 scheduler 重置为 undefined。
   * 见 spec § 等待语义的简化。
   */
  inboxSnapshotAtWait?: number;
  /**
   * status="waiting" 时由 wait tool 写入：本次 wait 引用的 IO 来源 window id。
   * 唤醒后由 scheduler 清空。observability/debug 用，Phase 1 不参与 wakeup 决策
   * （任何 inbox 新消息都唤醒）；Phase 2 可能据此做精确路由。
   * 见 docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md。
   */
  waitingOn?: string;
  /** 当前线程的持久化位置；缺失时系统只以内存模式运行。 */
  persistence?: ThreadPersistenceRef;
};

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
  const executableState = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
  const content = await renderContextXml({
    thread,
    contextWindows: executableState.contextWindows,
    knowledgeEntries: executableState.knowledgeEntries,
  });

  // P0f 渲染层 fold: 被 _foldedBy 标记的 event 跳过(实际数据仍在 thread.events 中,
  // 持久化保留); 它们的位置由对应的 events_summary event 自身渲染为占位 system message。
  // events_summary event 不带 _foldedBy 标记 — 它就是"代替被折叠区段"的渲染单元。
  const transcript = thread.events.flatMap((event) =>
    event._foldedBy ? [] : processEventToItems(thread, event),
  );

  // self.md 是 Object 的对内身份说明（identity.innerSelf，见
  // meta/object/persistable/index.doc.ts stoneLayout）。这里把它作为顶层 instructions
  // 注入 LLM，让多个 Object 在同一 Session 中持有可区分的身份；不存在则保持原行为。
  const instructions = await loadSelfInstructions(thread);

  // [ooc:paths] 信息节点:把 Object 的持久化目录与 OOC world 路径告诉 LLM,
  // 让元编程动作("write_file 到我的 stones/<self>/..." / "engineer 一个新 server method")
  // 能落到正确路径。无 persistence(测试 fixture) 时不注入此节点。
  const pathsItem = buildPathsItem(thread);

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
function buildPathsItem(thread: ThreadContext): LlmInputItem | undefined {
  const ref = thread.persistence;
  if (!ref) return undefined;
  const stoneRef = deriveStoneFromThread(ref);
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
 * - 否则注入 frontmatter 之后的正文（剥掉 extends 等元数据；OOC-4 L4.1 / Task 5）
 *
 * 注：当前 world-stone self.md 暂不带 frontmatter，本改是 forward-correct 防御
 * （base 原型 self.md 已用 `extends:` frontmatter，world self.md 迟早会跟进）。
 */
async function loadSelfInstructions(thread: ThreadContext): Promise<string | undefined> {
  if (!thread.persistence) return undefined;
  const stoneRef = deriveStoneFromThread(thread.persistence);
  const selfText = await readSelf(stoneRef);
  if (!selfText || !selfText.trim()) return undefined;
  const body = parseSelfMeta(selfText).body;
  if (!body.trim()) return undefined;
  return body;
}
