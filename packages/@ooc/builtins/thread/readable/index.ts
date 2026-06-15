/**
 * thread —— readable 维度（投影成 context window + window method）。
 *
 * thread 是唯一会话载体注册 class；同一 thread 实例按视角（POV）投影成不同 window class
 * （context.md 核心 2/8/9）：
 *   - **thread**（self-view 非 super）：thread 与其 creator 的对话（普通 flow 的 creator 窗）。
 *   - **talk**（other-view）：与对端 peer/sub thread 的对话（含父侧 fork 子窗）。
 *   - **reflect_request**（self-view super）：super flow 的反思自视，额外 surface 沉淀 method。
 *
 * 投影 class 由 readable 内部调 `computeProjectionClass(...)` 从窗形态（isForkWindow /
 * isCreatorWindow）+ thread session 动态算，作为 `ReadableProjection.class` 返回——**不持久化**。
 * 三种投影对应 `window` 数组里的 3 个 window decl，渲染期 `resolveWindowClass(_builtin/thread,
 * 投影 class)` 据此决定该窗展示哪些 method。会话 transcript 三种投影同款渲染（renderHead +
 * filterTalkMessages + renderTranscriptOrHandle），实现物保留在 core talk 域，本 readable import 复用。
 */
import type {
  ReadableContext,
  ReadableModule,
  WindowMethod,
} from "@ooc/core/readable/contract.js";
import type { XmlNode } from "@ooc/core/_shared/types/xml.js";
import { computeProjectionClass } from "@ooc/core/readable/projection-class.js";
import {
  DEFAULT_TRANSCRIPT_VIEWPORT,
  mergeTranscriptViewport,
  hasAnyTranscriptViewportField,
} from "@ooc/core/readable/transcript-viewport.js";
import { renderTranscriptOrHandle } from "@ooc/core/readable/conversation-render.js";
import {
  filterTalkMessages,
  renderHead,
} from "@ooc/builtins/thread/readable/talk-render.js";
import type { Data, ThreadWin } from "../types.js";

const setTranscriptWindowMethod: WindowMethod<Data, ThreadWin> = {
  name: "set_transcript_window",
  description: "Adjust which portion of the transcript is rendered (tail N or fixed range).",
  schema: {
    args: {
      tail: { type: "number", required: false, description: "末 N 条（正整数，与 range_* 互斥）" },
      range_start: { type: "number", required: false, description: "区间起点" },
      range_end: { type: "number", required: false, description: "区间终点" },
    },
  },
  exec: (_ctx: ReadableContext, _self: Data, before: ThreadWin, args: Record<string, unknown>) => {
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

const readable: ReadableModule<Data, ThreadWin> = {
  readable: (ctx: ReadableContext, self: Data, win: ThreadWin) => {
    const thread = ctx.thread;
    // 投影 class：POV 派生（self-view 非 super→thread / other-view→talk / self-view super→reflect_request）。
    const projectionClass = thread
      ? computeProjectionClass(
          { id: ctx.object.id, isForkWindow: self.isForkWindow, isCreatorWindow: self.isCreatorWindow },
          thread,
        )
      : "thread";

    const children: XmlNode[] = renderHead(self);
    if (thread) {
      const messages = filterTalkMessages(ctx.object.id, self, thread);
      children.push(
        ...renderTranscriptOrHandle(
          { isCreatorWindow: self.isCreatorWindow, state: { transcriptViewport: win?.transcriptViewport } },
          messages,
        ),
      );
    }
    return { class: projectionClass, content: children };
  },
  window: [
    // self-view 非 super：thread 与 creator 的对话；会话 3 method。
    {
      class: "thread",
      object_methods: ["say", "close", "share"],
      window_methods: [setTranscriptWindowMethod],
    },
    // other-view：与对端 peer/sub 的对话；会话 3 method。
    {
      class: "talk",
      object_methods: ["say", "close", "share"],
      window_methods: [setTranscriptWindowMethod],
    },
    // self-view super：反思自视；会话 3 method + 2 个 reflectable 沉淀 method。
    {
      class: "reflect_request",
      object_methods: [
        "say",
        "close",
        "share",
        "new_feat_branch",
        "create_pr_and_invite_reviewers",
      ],
      window_methods: [setTranscriptWindowMethod],
    },
  ],
};

export default readable;
