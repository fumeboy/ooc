/**
 * thread —— object data 结构（types.ts = 纯 Data）+ 投影态 Win。
 *
 * thread 是 agent 一次智能运行的载体，也是**唯一**会话载体注册 class（设计权威：thinkable
 * `knowledge/thread.md` + `context.md` 核心 2/8/9）。所有会话窗（creator/peer/sub/fork）都是
 * thread 实例（inst.class=`_builtin/thread`）；talk / reflect_request 不是注册 class，而是 thread
 * readable 按视角（POV）投影出的 window class。
 *
 * **ThreadData**（inst.data）= 会话窗状态（指向某 thread 的引用）：target / targetThreadId /
 * isForkWindow。creator 窗身份编码在 id（`threadWindowIdOf`）里、conversationId 恒等于窗实例 id
 * （= `ctx.object.id`）——二者都不存 data flag，按 id 派生；投影 class 由窗形态 + id 派生的
 * self/other-view + thread session 算出，不持久化。
 * **ThreadWin**（inst.win）= 投影态：transcript 渲染窗口（window method `set_transcript_window` 读写）。
 *
 * 元信息字段（id / class / title / status / createdAt / parentWindowId）由 runtime 管理
 * （`OocObjectRef` 实例），不进 Data；thread 的过程数据（context/events/status）落 thread.json /
 * thread-context.json，由 runtime/persistence 管理，不冗余进本 Data。
 *
 * **inbox / outbox（creator-scoped 会话通道）**：一条 thread 与**它的 creator** 之间的消息单一真相源——
 * inbox = creator → 本 thread 的入站消息；outbox = 本 thread → creator 的出站消息。`say` 只往这两个 box
 * 写、经 runtime 触发对端调度（见 `executable/session-methods.ts`）；对端读侧投影（peer-ref）属后续重构。
 */
export interface Data {
  /** 对端 objectId（peer 会话）或自己的 objectId（fork 子线程）。 */
  target: string;
  /** 对端 thread id；peer 首条 say 时回填，fork 建窗即知。 */
  targetThreadId?: string;
  /** true ⇒ fork 子线程窗（同对象，旧 do_window）；缺省 ⇒ peer 跨对象会话窗。 */
  isForkWindow?: boolean;
  /** creator → 本 thread 的入站消息（creator-scoped inbox）。 */
  inbox?: import("@ooc/core/_shared/types/thread.js").ThreadMessage[];
  /** 本 thread → creator 的出站消息（creator-scoped outbox）。 */
  outbox?: import("@ooc/core/_shared/types/thread.js").ThreadMessage[];
}

/**
 * thread 的**投影态**（与 Data 分离）。compress v2（resize/compress 协议 + fork-summarizer）：
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
  transcriptViewport?: import("./transcript-viewport.js").TranscriptViewport;
  summarizedRanges?: import("@ooc/core/_shared/utils/summarized-ranges.js").SummarizedRange[];
  autoCompressLevel?: 0 | 1 | 2;
  compressIntent?: boolean;
  inFlightCompress?: { forkThreadId: string; fromIdx: number; toIdx: number };
}

/**
 * talk-family 别名（talk 实现物归 thread 包后的会话业务类型）。
 *
 * 会话窗 inst.class 一律 = `_builtin/thread`；`talk` / `reflect_request` 是 thread readable 投影
 * 出的 window class。会话实现（delivery / fork / render）按这些别名消费 thread 的会话业务 Data。
 */
export type TalkData = Data;
export type TalkWin = ThreadWin;

/**
 * delivery 域内部的**扁平派送视图 DTO**（实例 id/class 元信息 + TalkData 扁平）。
 * 非持久化结构——say / fork 派送时把 `OocObjectRef<TalkData>` 还原成 delivery 期望的扁平面。
 */
export interface TalkWindowView extends TalkData {
  id: string;
  class: string;
}
