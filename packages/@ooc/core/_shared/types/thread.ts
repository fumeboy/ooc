/**
 * Thread 运行时上下文类型 + flow/stone 引用类型 + 纯路径函数 —— canonical 源
 * （从 `thinkable/context/index.ts` 与 `persistable/common.ts` 迁入）。
 *
 * 只含**纯类型**与**纯函数**：ThreadContext 的运行时构造（buildContext /
 * buildInputItems / processEventToItems / loadSelfInstructions）留在 thinkable；
 * 带 IO / 路径路由的 objectDir / threadDir / stoneDir / resolveStoneDir 留在
 * persistable。
 */

import type { OocObjectInstance } from "../../runtime/ooc-class.js";

// ─────────────────────────── flow / stone 引用类型 ───────────────────────────

/**
 * 标识磁盘上的单个 flow object 目录。
 *
 * 路径形态（bun workspace 迁移，移除 objects/ 中间层）：
 *   objectId="a"       → `{baseDir}/flows/{sessionId}/a`
 *   objectId="a/b"     → `{baseDir}/flows/{sessionId}/a/children/b`
 *   objectId="a/b/c"   → `{baseDir}/flows/{sessionId}/a/children/b/children/c`
 */
export interface FlowObjectRef {
  /** 包含 `flows/` 和 `stones/` 的 workspace 根目录。 */
  baseDir: string;
  /** `flows/` 下的 session 目录名。 */
  sessionId: string;
  /** `flows/{sessionId}/` 下的 object 目录名。逻辑 id；嵌套 segment 由 children/ 物理隔开。 */
  objectId: string;
}

/**
 * 标识 flow object 内的单个线程持久化位置。
 *
 * 路径形态：`{objectDir(ref)}/threads/{threadId}`
 */
export interface ThreadPersistenceRef extends FlowObjectRef {
  /** `threads/` 下的线程目录名。 */
  threadId: string;
  /**
   * reflectable 沉淀的 **feat 分支绑定**（super(foo) 直接编辑路径）。
   *
   * super(foo) 调 `new_feat_branch` 开 feat 分支后，把分支名（`feat/<slug>`）绑到本 thread
   * 的 persistence 上并随 thread.json 持久化——使绑定跨 exec tick 存活（开分支后多次
   * write_file / file_window.edit 直接编辑 feat worktree 下文件，再 create_pr_and_invite_reviewers 提交）。
   *
   * 设置后 `resolveStoneIdentityRef` 在 sessionId 路由**最前面**优先认它：读写都落
   * `stones/<stonesBranch>/objects/<id>/`。**缺省时（绝大多数 thread）行为分毫不变**——
   * session-aware 读 / in-session create_object 零触碰。仅 super(foo) 沉淀 thread 才有此绑定。
   */
  stonesBranch?: string;
  /** feat 分支绑定的沉淀意图（派生 PR title / commit message；与 stonesBranch 配套）。 */
  sedimentIntent?: string;
}

/**
 * 标识磁盘上的单个 object stone 包。
 *
 * canonical 路径是 `{baseDir}/stones/{objectId}`（扁平布局）。嵌套 objectId（含 "/"）
 * 用 children/ marker 分隔。特殊路由（_stonesBranch / builtin）由 persistable 的
 * stoneDir() 解释。
 */
export interface StoneObjectRef {
  /** 包含 `stones/` 的 workspace 根目录。 */
  baseDir: string;
  /** `stones/` 下的 object 目录名。 */
  objectId: string;
  /**
   * Internal: when set, stoneDir() routes to a git versioning worktree path
   * `stones/{_stonesBranch}/objects/{objectId}/`.  Used by the metaprog versioning system.
   */
  _stonesBranch?: string;
}

/**
 * stone / flow 目录用来分隔嵌套子 Agent 的 marker 子目录名。
 *
 * 物理布局示例（stone 与 flow 形态对齐）：
 *   objectId = "parent/child" → stones/parent/children/child
 */
export const STONE_CHILDREN_SUBDIR = "children";

/** Builtin object IDs that route to packages/@ooc/builtins/<id> instead of stones/<id>. */
export const BUILTIN_OBJECT_IDS: ReadonlySet<string> = new Set(["supervisor", "user", "feishu_app"]);

/**
 * 把 "/" 分隔的 objectId 翻译成 children/ 嵌套的物理 path segments。
 *
 * 例：
 *   "a"       → ["a"]
 *   "a/b"     → ["a", "children", "b"]
 *   "a/b/c"   → ["a", "children", "b", "children", "c"]
 *
 * 与 stoneDir / objectDir 共用，避免双份逻辑。
 */
export function nestedObjectPath(
  objectId: string,
  childrenSubdir: string = STONE_CHILDREN_SUBDIR,
): string[] {
  const segments = objectId.split("/").filter(Boolean);
  return segments.flatMap((seg, i) => (i === 0 ? [seg] : [childrenSubdir, seg]));
}

/** 判断一个 objectId 是否指向 Builtin Object（运行时自带、Agent 不可改写）。 */
export function isBuiltinObjectId(objectId: string): boolean {
  if (objectId.startsWith("_builtin/")) return true;
  return BUILTIN_OBJECT_IDS.has(objectId);
}

/** 序列化 JSON 的统一格式：两空格缩进 + 末尾换行。 */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 从 ThreadPersistenceRef 派生 StoneObjectRef，便于 program/server 模块复用。 */
export function deriveStoneFromThread(threadRef: ThreadPersistenceRef): StoneObjectRef {
  return {
    baseDir: threadRef.baseDir,
    objectId: threadRef.objectId,
  };
}

// ─────────────────────────── thread 事件 / 消息 / 上下文 ──────────────────────

/**
 * ProcessEvent 共享的可选字段;所有 variants 都可承载它们。
 *
 * - `id`: 事件稳定标识(可选)。旧 thread.json 无 id 字段属正常,渲染层按数组下标 fallback。
 *
 * 注:events 折叠不再改 thread.events（旧 `_foldedBy` 标记 / `events_summary` 事件已随 compress
 * Case A 退役）——折叠态活在自己视角 thread 窗的 `win.summarizedRanges`（投影态、可逆、不动 events）。
 */
export type ProcessEventCommon = {
  /** 事件稳定标识(可选)。 */
  id?: string;
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
      toolName: "exec" | "close" | "wait";
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
      toolName: "exec" | "close" | "wait";
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
      /**
       * 可选：触发该注入的源头模块 / 函数（如 "thinkable/llm/providers/openai#toOpenAiOutputItems"）。
       * 用于可观测性：thread.json 查看者 / 控制面能直接定位事件是谁发出的，
       * 而不必从错误文本反推。错误类注入强烈建议填充。
       */
      source?: string;
      /**
       * 可选：机器可读的错误码，供上层按类型处理（如 "json_parse_failed"、
       * "tool_dispatch_error"、"permission_denied"）。
       */
      errorCode?: string;
      /**
       * 可选：完整或截断的原始异常堆栈。仅在 source 是异常捕获点时填充；
       * 前端 timeline 默认折叠，不直接注入 LLM context。
       */
      stack?: string;
      /**
       * 可选：相关数据的预览（截断到 ≤ 200 字符）。
       * 例如 JSON.parse 失败时放入被解析的原始字符串前 200 字，极大降低定位成本。
       */
      dataPreview?: string;
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
      toolName: "exec" | "close" | "wait";
      /** 序列化后的输出字符串。 */
      output: string;
      /** 是否成功。 */
      ok: boolean;
    }
  | {
      /**
       * 事件来源：context 折叠发生（compress v2）。
       *
       * 由 `harvestSummarizerForks` 在 summarizer fork 完成（done→记段 / failed→关自动压缩）时写一条，
       * 与现有 ProcessEvent 同序进 thread.json / debug 落盘 / contextSnapshot,LLM 视野中也可见
       * （silent-swallow ban：折叠对 LLM 透明）。
       */
      category: "context_change";
      /** 折叠发生:每次 harvest 记段 / 记失败写一条。 */
      kind: "context_compressed";
      /** 折叠标记,形如 "auto-fold" / "auto-fold-failed"。 */
      levelChange: string;
      /** 触发原因:auto-summarized / summarizer-fork-failed 等。 */
      reason: string;
    }
  | {
      /**
       * 事件来源：runJob 单次跑满 workerMaxTicks 自然返回，且 thread.status 仍为 running。
       *
       * worker 出口在写完本事件后
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
       * 事件来源: thinkloop 在 dispatchToolCall 之前调 decidePermission 返回 "ask"。
       *
       * 写完事件后 thread.status="paused"。
       * HTTP endpoint 写入 decided 字段 + 翻回 running; thinkloop 在 resume 路径
       * 扫"最近一条 permission_ask"按 decided.action 处理:
       *        approve → 用 pendingCall 字段重放该 tool call (绕过 decidePermission)
       *        reject  → 写 permission_denied + 合成 function_call_output
       *
       * 渲染层根据 decided 区分 pending / approved / rejected 三态 system message。
       */
      category: "permission";
      kind: "permission_ask";
      /** 触发本次 ask 的 function_call id (与 llm_interaction.function_call.callId 对齐)。 */
      toolCallId: string;
      /** 解析后的实际 method 路径 (例如 "talk", "write_file" 或 "exec" / "close" 等 tool 名)。 */
      method: string;
      /** args 摘要 (截断到 200 字以内, 防止 events 流爆炸)。 */
      argsSummary?: string;
      /** exec 时目标 window id。 */
      windowId?: string;
      /**
       * HITL 审批决议。无 → 待审批; "approve" → 已批准 (thinkloop resume 时重放);
       * "reject" → 已拒绝 (thinkloop resume 时合成 denied + function_call_output)。
       */
      decided?: {
        action: "approve" | "reject";
        at: number;
        reason?: string;
      };
      /**
       * 完整序列化的原 pending tool call。approve 路径用它直接 dispatchToolCall,
       * 不依赖 LLM 重新发起 (LLM 可能换 args 或干脆不发了)。
       *
       * 字段冗余 (toolCallId / method / windowId 已经在外层) 是为了一站式重建 LlmToolCall,
       * 避免 resume 路径再次推断。
       */
      pendingCall?: {
        toolName: "exec" | "close" | "wait";
        method: string;
        args: Record<string, unknown>;
        windowId?: string;
        toolCallId: string;
      };
    }
  | {
      /**
       * 事件来源: thinkloop 在 dispatchToolCall 之前调 decidePermission 返回 "deny"。
       *
       * Design 同 permission_ask。
       *
       * 系统已拒绝该 tool call, 并合成了一条 function_call_output (在 thread.events
       * 紧邻位置) 让 LLM 看见拒绝原因 (silent-swallow ban + Deny 信息流不变量)。
       */
      category: "permission";
      kind: "permission_denied";
      /** 被拒绝的 function_call id。 */
      toolCallId: string;
      /** 实际 method 路径。 */
      method: string;
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
  /** 消息来源；talk = 经 talk_window.say（peer 会话 + fork 子窗统一）；user = 控制面代用户派送；
   *  "do" 是旧 fork 消息的历史 source 值（do→talk 合并后不再产生，保留以读旧 thread.json）。 */
  source: "do" | "system" | "talk" | "user";
  /**
   * 消息归属的 window id；
   * - 由 talk_window.say 写 outbox 时设置为该 talk_window 的 id
   *   （fork 子窗的 say 视图实际用 targetThreadId 过滤，本字段非必需）
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
 * 线程调度状态。status="waiting" 表示等待 inbox 新消息（不再有 waitingType 细分）。
 * 显式提取为具名 type，便于复用。
 */
export type ThreadStatus =
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "paused"
  | "canceled";

/**
 * 单个线程的运行时上下文。
 *
 * 这是 buildContext / think / scheduler 共享的最小结构，不等同于完整持久化模型。
 *
 * 重构：
 * - 删除 activeForms / windows / pinnedKnowledge / waitingType / awaitingChildren
 * - 新增 contextWindows（统一抽象）+ threadLocalData（program_window 使用，先占位）
 * - status="waiting" 单独表达"等待 inbox 新消息"，不再细分 waitingType（等待语义的简化）
 */
export type ThreadContext = {
  /** 线程唯一标识；同时用于 XML context 中的 thread id。 */
  id: string;
  /** 调度状态；status="waiting" 表示等待 inbox 新消息，不再有 waitingType 细分。 */
  status: ThreadStatus;
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
   * 创建本线程的 session id（cross-session notify 修复）。
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
   * compress v2：本线程是 framework fork 的 **summarizer 子线程**（生成摘要后由 scheduler harvest
   * 读其 endSummary 记入父窗 summarizedRanges）。标记使 emitChildEndNotifications 不对它发 child-end
   * 通知（避免污染父会话 + 双记，C2）；它的产出经 harvest 内部回收、不进父的协作叙事。
   */
  isSummarizer?: boolean;
  /**
   * 父 thread 反向引用（运行时设置，不持久化）。
   *
   * 用于 do_window.move 等命令需要从子 thread 访问父 thread 的场景；
   * 由 fork 路径（root.do executeDoMethod）在创建 child 时建立。
   * thread.json 序列化时被 strip（避免循环引用）。
   */
  _parentThreadRef?: ThreadContext;
  /** 其他线程投递给当前线程的消息。 */
  inbox?: ThreadMessage[];
  /** 当前线程发出的协作消息记录。 */
  outbox?: ThreadMessage[];
  /**
   * 当前线程持有的 object 实例（Wave 4：元素类型从旧平铺 `ContextWindow` 改为
   * `OocObjectInstance` —— 身份元信息 + 业务 data + 投影态 win 分离）。**复用字段名**
   * `contextWindows` 以最小破坏。访问方式：业务数据 `.data`、投影态 `.win`、元信息 `.id/.class/...`。
   */
  contextWindows: OocObjectInstance[];
  /**
   * thread-local 共享数据；program_window 的 ts/js exec 之间通过这里传值
   * （program_window 的"跨 exec 数据传递"）。当前仅占位、不读不写。
   */
  threadLocalData?: Record<string, unknown>;
  /** end method 写入的结束原因。 */
  endReason?: string;
  /** end method 写入的最终摘要。 */
  endSummary?: string;
  /**
   * 结构化失败原因。
   *
   * 当 status="failed" 由 thinkloop catch 块写入时，给出机读的失败分类，让控制面 /
   * GET .../threads/:id 不必去 events 里扒文本：
   * - "llm_timeout"：LlmTimeoutError（LLM 调用超时兜底触发）
   * - "think_error"：think 单轮中其他异常
   *
   * 仅失败终态写入；done/running/waiting/paused 不带此字段。
   */
  statusReason?: string;
  /** 失败时的人读错误消息（与 statusReason 配套）。 */
  lastError?: string;
  /**
   * 任务级 LLM 超时覆盖（ms）。
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
   * 见等待语义的简化。
   */
  inboxSnapshotAtWait?: number;
  /**
   * status="waiting" 时由 wait tool 写入：本次 wait 引用的 IO 来源 window id。
   * 唤醒后由 scheduler 清空。observability/debug 用，不参与 wakeup 决策
   * （任何 inbox 新消息都唤醒）；未来可能据此做精确路由。
   */
  waitingOn?: string;
  /**
   * Transient observability mirror of the windows the ContextPipeline actually
   * rendered into the LLM input on the latest buildInputItems pass (base windows
   * PLUS pipeline-derived ones: protocol/system knowledge, activator knowledge,
   * peer/children Objects, form-scoped knowledge).
   *
   * Populated at the end of buildInputItems; read by finishLlmLoop so that the
   * loop debug windowsSnapshot reflects what the LLM saw — not just the persisted
   * thread.contextWindows (which omits all derived windows, making activator/
   * protocol knowledge look "未激活" in the debug snapshot). Runtime-only; never
   * persisted. Undefined falls back to thread.contextWindows.
   */
  _renderedWindows?: OocObjectInstance[];
  /** 当前线程的持久化位置；缺失时系统只以内存模式运行。 */
  persistence?: ThreadPersistenceRef;
};
