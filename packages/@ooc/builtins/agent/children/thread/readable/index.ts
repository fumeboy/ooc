/**
 * thread —— readable 维度（投影成 context window + window method）。
 *
 * thread 是唯一会话载体注册 class；同一 thread 实例按视角（POV）投影成不同 window class
 * （context.md 核心 2/8/9）：
 *   - **thread**（self-view 非 super）：thread 与其 creator 的对话（普通 flow 的 creator 窗）。
 *   - **talk**（other-view）：与对端 peer/sub thread 的对话（含父侧 fork 子窗）。
 *   - **reflect_request**（self-view super）：super flow 的反思自视，额外 surface 沉淀 method。
 *
 * 投影 class 由 readable 内部调 `computeProjectionClass(...)` 从 id 派生的 self/other-view
 * （creator 窗 = `isSelfThreadWindow(id)`）+ thread session 动态算，作为 `ReadableProjection.class`
 * 返回——**不持久化**。三种投影对应 `window` 数组里的 3 个 window decl，渲染期 `resolveWindowClass(
 * _builtin/thread, 投影 class)` 据此决定该窗展示哪些 method。close 不再是 method（已塌回 close 原语）。
 * 会话 transcript 三种投影同款渲染（renderHead +
 * filterTalkMessages + renderTranscriptOrHandle），实现物保留在 core talk 域，本 readable import 复用。
 */
import type {
  ReadableContext,
  ReadableModule,
  WindowMethod,
} from "@ooc/core/readable/contract.js";
import type { ReadonlySelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import { xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { OocObjectRef } from "@ooc/core/_shared/types/context-window.js";
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
    args: {
      tail: { type: "number", required: false, description: "末 N 条（正整数，与 range_* 互斥）" },
      range_start: { type: "number", required: false, description: "区间起点" },
      range_end: { type: "number", required: false, description: "区间终点" },
    },
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
  schema: { args: {} },
  exec: (_ctx, _self, before_win) => {
    // TODO 执行一次信息总结
    return { ...before_win };
  },
};

/** thread 窗 resize：设自动压缩档位 autoCompressLevel（0 不主动 / 1 适度 / 2 激进）。 */
export const resize: WindowMethod<unknown, ThreadWin> = {
  name: "resize",
  description: "调本 thread 历史信息的自动压缩档位 level：0=不主动压缩，1=适度，2=激进（越高越早自动折叠早期历史）",
  schema: {
    args: {
      level: {
        type: "number",
        required: true,
        enum: [0, 1, 2],
        description: "自动压缩档位：0 不主动 / 1 适度 / 2 激进",
      },
    },
  },
  exec: (_ctx, _self, before_win, args) => {
    // TODO 按照新的自动档位进行一次压缩
    return { ...before_win, autoCompressLevel: args.level ?? 0 };
  },
};


const readable: ReadableModule<Data, ThreadWin> = {
  readable: (ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<ThreadWin>) => {
    const children: XmlNode[] = []

    if (win.class == "this_thread") {
      // TODO 展示 thread events & messages
    } else { // talk window 只展示 messages
      const { visible: messages } = applyTranscriptViewport(self.data.messages, win.data?.transcriptViewport);
      children.push(...messages.map(m => xmlText(m.from=="caller"? `[self:] ${m.content}`:`[callee:] ${m.content}`)));
    }

    return { content: children };
  },
  window: [
    {
      class: "this_thread",
      object_methods: ["reply", "end", "todo"],
      window_methods: [setTranscript, compress, resize],
    },
    {
      class: "talk",
      object_methods: ["say"],
      window_methods: [setTranscript, compress, resize],
    },
  ],
};

export default readable;
