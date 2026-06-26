/**
 * thread —— readable 维度（投影成 context window + window method）。
 *
 * thread 是唯一会话载体注册 class；同一 thread 实例按视角（POV）投影成不同 window class
 * （context.md 核心 2/8/9）。**issue I 修正**：原 `default + super` 二投影合并 caller+callee surface
 * 是语义 bug——`say` 是对端视角 method、`reply/end/todo` 是自看视角 method、合并到 default 让两边
 * 都错调。改为**三视角投影 default / self / super**：surface 按视角分集,内容渲染保持单 transcript
 * + author prefix：
 *   - **default**（对端视角:caller/peer 看 thread 作为对话窗）—— surface `say`（caller 向 thread
 *     发消息）。
 *   - **self**（自看视角:thread 经 self-view ref 看自身）—— surface `reply` / `end` / `todo`
 *     （thread 自己对自己做的 method）。
 *   - **super**（self-view 的 super flow 扩展:sessionId === SUPER_SESSION_ID）—— surface = self
 *     全集 + 4 个反思分发 method（scan_changes / create_pr_for_versioned / sediment_unversioned /
 *     create_pr_for_class_edits）。
 *
 * **单 transcript 模型**：thread.data.messages 是**单一**消息列表；每条 message 持 `from`
 * （"caller" / "callee"）。readable render 不分支投影 class、按 `from` 字段渲不同 prefix。
 *
 * **投影 class 三档判定**：`computeProjectionClass(self.data, win)` 依据 win.id 是否为 self-view
 * ref id（`threadWindowIdOf(threadId)`）+ session 是否为 super 三档分流；外人视角（win.id ≠
 * self-view id）一律 default。
 */
import type {
  ReadableContext,
  ReadableModule,
  WindowMethod,
} from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import { xmlText, type XmlNode } from "@ooc/core/types/xml.js";
import { OocObjectRef, threadWindowIdOf } from "@ooc/core/types/context-window.js";
import { SUPER_SESSION_ID } from "@ooc/core/types/constants.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  mergeTranscriptViewport,
  hasAnyTranscriptViewportField,
  applyTranscriptViewport,
} from "./transcript-viewport.js";
import type { Data, ThreadWin } from "../types.js";

const setTranscript: WindowMethod<Data, ThreadWin> = {
  name: "set_transcript_window",
  description: "Adjust which portion of the transcript is rendered (tail N or fixed range).",
  schema: {
      tail: { type: "number", required: false, description: "末 N 条（正整数,与 range_* 互斥）" },
      range_start: { type: "number", required: false, description: "区间起点" },
      range_end: { type: "number", required: false, description: "区间终点" },
    },
  exec: (_ctx: ReadableContext, _self: ReadonlySelfProxy<Data>, before: ThreadWin, args: Record<string, unknown>) => {
    if (!hasAnyTranscriptViewportField(args)) {
      return before ?? {};
    }
    const merged = mergeTranscriptViewport(
      before?.transcriptViewport ?? DEFAULT_TRANSCRIPT_VIEWPORT,
      args,
    );
    if (!merged.ok) throw new Error(`[thread.set_transcript_window] ${merged.error}`);
    return { ...before, transcriptViewport: merged.viewport };
  },
};

export const compress: WindowMethod<unknown, ThreadWin> = {
  name: "compress",
  description: "压缩本 thread 历史信息",
  schema: {},
  exec: (_ctx, _self, before_win) => {
    // TODO 执行一次信息总结
    return { ...before_win };
  },
};

/** thread 窗 resize：设自动压缩档位 autoCompressLevel（0 不主动 / 1 适度 / 2 激进）。 */
export const resize: WindowMethod<unknown, ThreadWin> = {
  name: "resize",
  description: "调本 thread 历史信息的自动压缩档位 level:0=不主动压缩,1=适度,2=激进(越高越早自动折叠早期历史)",
  schema: {
      level: {
        type: "number",
        required: true,
        enum: [0, 1, 2],
        description: "自动压缩档位:0 不主动 / 1 适度 / 2 激进",
      },
    },
  exec: (_ctx, _self, before_win, args) => {
    // TODO 按照新的自动档位进行一次压缩
    return { ...before_win, autoCompressLevel: args.level ?? 0 };
  },
};

/**
 * 投影 class 算法（issue I 三档）：
 *   - self-view ref（win.id === threadWindowIdOf(threadData.id)）+ super session → "super"
 *   - self-view ref + 普通 session → "self"
 *   - 其它（peer-view ref）→ "default"
 *
 * 注：self-view ref 由 thread.construct 物理写入 contextWindows 首位（issue I 改动 3）；id 编码
 * 在 `threadWindowIdOf(threadId)`（= `w_creator_<threadId>`，沿用历史前缀）。
 */
export function computeProjectionClass(
  threadData: Data,
  ref: OocObjectRef,
): string {
  const isSelfView = ref.id === threadWindowIdOf(threadData.id);
  if (isSelfView && threadData.sessionId === SUPER_SESSION_ID) return "super";
  if (isSelfView) return "self";
  return "default";
}

const readable: ReadableModule<Data, ThreadWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<ThreadWin>) => {
    const projectionClass = computeProjectionClass(self.data, win);
    const { visible: messages } = applyTranscriptViewport(self.data.messages, win.data?.transcriptViewport);
    const children: XmlNode[] = messages.map((m) =>
      xmlText(m.from === "caller" ? `[caller:] ${m.content}` : `[callee:] ${m.content}`),
    );
    return { class: projectionClass, content: children };
  },
  window: [
    {
      // default —— 对端视角（caller / peer 看 thread 作为对话窗）
      // surface: 仅 say（caller 向 thread 说话）。
      class: "default",
      object_methods: ["say"],
      window_methods: [setTranscript, compress, resize],
    },
    {
      // self —— thread 自看视角（self-view ref）
      // surface: reply / end / todo（thread 对自己的 method:回话给 creator / 结束 / 立 todo）。
      class: "self",
      object_methods: ["reply", "end", "todo"],
      window_methods: [setTranscript, compress, resize],
    },
    {
      // super —— super flow self-view 投影（sessionId === SUPER_SESSION_ID 时命中）
      // surface = self 全集 + 4 个反思分发 method（OOC 协议层无 decl 继承,平铺 7 method;业务
      // session 偷渡由 method 内 requireSuperSession 双闸门兜底）。
      class: "super",
      object_methods: [
        "reply",
        "end",
        "todo",
        "scan_changes",
        "create_pr_for_versioned",
        "sediment_unversioned",
        "create_pr_for_class_edits",
      ],
      window_methods: [setTranscript, compress, resize],
    },
  ],
};

export default readable;
