/**
 * thread —— object data 结构（**统一** ThreadContext = 运行时上下文 + 会话窗指针字段）+ 投影态 Win。
 *
 * thread 是 agent 一次智能运行的载体，也是**唯一**会话载体注册 class（设计权威：thinkable
 * `knowledge/thread.md` + `context.md` 核心 2/8/9）。所有会话窗（creator/peer/sub/fork）都是
 * thread 实例（inst.class=`_builtin/agent/thread`）；talk / reflect_request 不是注册 class，而是 thread
 * readable 按视角（POV）投影出的 window class。
 *
 * **ThreadContext = 一份 thread 的完整业务 data**（thinkable-module 后续：原 core 的 `ThreadContext`
 * 与本包旧 `interface Data` 合并为一个类型，随 thread 与 core 解耦从 core/_shared 迁入本处）。它既是
 * scheduler/thinkloop 共享的运行时上下文（id / status / events / contextWindows / 线程树），也承载
 * **会话窗指针字段**（target / targetThreadId / isForkWindow）——自我视角 thread 窗的 creator 通道、
 * 以及 caller 侧指向 callee 的会话窗引用都用它表达。指针字段全 optional：self-driven root / 纯运行时
 * 线程不设；caller 侧轻量指针窗只填这几项（其余运行时字段缺省）。
 *
 * **ThreadWin**（inst.win）= 投影态：transcript 渲染窗口（window method `set_transcript_window` 读写）。
 *
 * 元信息字段（id / class / title / status / createdAt / parentWindowId）由 runtime 管理
 * （`OocObjectRef` 实例），不进 data；thread 的过程数据（context/events/status）落 thread.json /
 * thread-context.json，由 runtime/persistence 管理。
 */

import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type {
  ProcessEvent,
  ThreadStatus,
} from "@ooc/core/_shared/types/thread.js";
import type { TranscriptViewport } from "./transcript-viewport.js";
import type { SummarizedRange } from "@ooc/core/_shared/utils/summarized-ranges.js";

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
 * 单个线程的运行时上下文 **+ 会话窗指针字段** —— thread class 的统一业务 data。
 *
 * 这是 buildContext / think / scheduler 共享的最小结构，也是 thread 实例 `inst.data` 的类型。
 * 不等同于完整持久化模型（运行时镜像字段 `_parentThreadRef` / `_renderedWindows` / `_objectTable`
 * 不落盘）。
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
  /**
   * compress v2：本线程是 framework fork 的 **summarizer 子线程**（生成摘要后由 scheduler harvest
   * 读其 endSummary 记入父窗 summarizedRanges）。标记使 emitChildEndNotifications 不对它发 child-end
   * 通知（避免污染父会话 + 双记，C2）；它的产出经 harvest 内部回收、不进父的协作叙事。
   */
  isSummarizer?: boolean;
  /** 其他线程投递给当前线程的消息。 */
  inbox?: ThreadMessage[];
  /** 当前线程发出的协作消息记录。 */
  outbox?: ThreadMessage[];
  /**
   * 当前线程持有的 object 实例引用（Wave 4：元素类型从旧平铺 `ContextWindow` 改为
   * `OocObjectRef` —— 身份元信息 + 投影态 win；**窗不持 data**，data 在 session 对象表 / data.json）。
   */
  contextWindows: OocObjectRef[];
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

  // ─────────────── 会话窗指针字段（旧 `interface Data` 合并入；全 optional）───────────────
  /** true ⇒ fork 子线程窗（同对象，旧 do_window）；缺省 ⇒ peer 跨对象会话窗。 */
  isForkWindow?: boolean;
};

/**
 * thread class 实例 data 的别名 —— `OocClass<Data>` 机制名沿用，substance 即统一 `ThreadContext`。
 */
export type Data = ThreadContext;

/**
 * thread 的**投影态**（与 data 分离）。compress v2（resize/compress 协议 + fork-summarizer）：
 * - `transcriptViewport`：transcript 渲染窗口（window method `set_transcript_window` 读写）。
 * - `summarizedRanges`：折叠态——transcript 内点名区段折成摘要占位（fork-summarizer 产出后由框架记入；
 *   视角独立、随 inline thread 窗持久化）。读出侧 `projectSummarizedRanges` 投影。
 * - `autoCompressLevel`：**自动压缩档位**（window method `resize` 设）——thread 窗专用阈值旋钮：未总结
 *   transcript 超该档位阈值即自动 fork-summarize。**独立于 compressLevel**（后者是内容窗的展示档位，
 *   被 renderer `projectByCompressLevel` 消费；thread 窗自视渲句柄、不用展示档位），避免展示折叠副作用。
 * - `compressIntent`：agent 经 window method `compress`（无参意图）请求折一次——框架 auto-trigger hook 消费。
 * - `inFlightCompress`：在途 summarizer fork 标记 `{forkThreadId,fromIdx,toIdx}`——框架 harvest 完成后清；
 *   force-wait 据此判定「在途 compress」。随 inline thread 窗持久化（跨 reload；orphan 由 harvest 超时清）。
 */
export interface ThreadWin {
  transcriptViewport?: TranscriptViewport;
  summarizedRanges?: SummarizedRange[];
  autoCompressLevel?: 0 | 1 | 2;
  compressIntent?: boolean;
  inFlightCompress?: { forkThreadId: string; fromIdx: number; toIdx: number };
}

/**
 * talk-family 别名（talk 实现物归 thread 包后的会话业务类型）。
 *
 * 会话窗 inst.class 一律 = `_builtin/agent/thread`；`talk` / `reflect_request` 是 thread readable 投影
 * 出的 window class。会话实现（delivery / fork / render）按这些别名消费 thread 的会话业务 data。
 */
export type TalkData = ThreadContext;
export type TalkWin = ThreadWin;

/**
 * delivery 域内部的**扁平派送视图 DTO**（实例 id/class 元信息 + 会话窗指针字段扁平）。
 * 非持久化结构——say / fork 派送时把会话窗实例还原成 delivery 期望的扁平面。
 * 只取指针字段子集，不背完整 ThreadContext 运行时字段。
 */
export interface TalkWindowView
  extends Pick<ThreadContext, "target" | "targetThreadId" | "isForkWindow" | "inbox" | "outbox"> {
  id: string;
  class: string;
}
