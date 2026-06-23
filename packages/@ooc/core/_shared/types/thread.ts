/**
 * flow/stone 引用类型 + 纯路径函数 + 线程过程事件（ProcessEvent / ThreadStatus）—— core 侧
 * canonical 源。
 *
 * 只含 core 仍需的**纯类型**与**纯函数**：flow/stone 引用、路径派生、`ProcessEvent`（thinkloop
 * 单轮事件流，core engine 直接读写）、`ThreadStatus`（调度状态枚举）。
 *
 * 注（thinkable-module 后续：thread 与 core 解耦）：`ThreadContext`（thread class 统一业务 data）
 * 与 `ThreadMessage`（inbox/outbox 消息）已迁入 thread builtin
 * （`@ooc/builtins/agent/thread/types.ts`）——core engine 经 `import type` 引用其类型（运行时擦除、
 * 无环），具体形状归 thread class 所有。
 */

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

/**
 * 线程调度状态。status="waiting" 表示等待 inbox 新消息（不再有 waitingType 细分）。
 * 显式提取为具名 type，便于复用。
 */
export type ThreadStatus =
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "paused";

