/**
 * thread —— readable 维度（投影成 context window + window method）。
 *
 * thread 是唯一会话载体注册 class；同一 thread 实例按视角（POV）投影成不同 window class
 * （context.md 核心 2/8/9）：
 *   - **thread**（self-view 非 super）：thread 与其 creator 的对话（普通 flow 的 creator 窗）。
 *   - **talk**（other-view）：与对端 peer/sub thread 的对话（含父侧 fork 子窗）。
 *   - **reflect_request**（self-view super）：super flow 的反思自视，额外 surface 沉淀 method
 *     —— 由 issue D 落地，本 readable 当前仅声明 thread + talk 两档。
 *
 * 投影 class 由 readable 内部从 win.class 派生（本 readable 是 thread 多视角场景的协议
 * 装配点；其它 class 受默认 `"default"` 强约束）。三种投影对应 `window` 数组里的 decl，渲染期
 * `resolveWindowClass(_builtin/thread, 投影 class)` 据此决定该窗展示哪些 method。close 不再是
 * method（已塌回 close 原语）。会话 transcript 多视角同款渲染（renderHead + filterTalkMessages +
 * renderTranscriptOrHandle），实现物保留在 core talk 域，本 readable import 复用。
 */
import type {
  ReadableContext,
  ReadableModule,
  WindowMethod,
} from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import { xmlText, type XmlNode } from "@ooc/core/types/xml.js";
import { OocObjectRef } from "@ooc/core/types/context-window.js";
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
      tail: { type: "number", required: false, description: "末 N 条（正整数，与 range_* 互斥）" },
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
  description: "调本 thread 历史信息的自动压缩档位 level：0=不主动压缩，1=适度，2=激进（越高越早自动折叠早期历史）",
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


const readable: ReadableModule<Data, ThreadWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<ThreadWin>) => {
    const children: XmlNode[] = [];
    // computeProjectionClass 前置判定（issue D + B 命名）：super flow 内 self-view → reflect_request
    // （投影携带 4 个分发器 method）。其他场景按 B 的 win.class 派生：talk → talk，否则 → thread。
    const projectionClass =
      self.data.sessionId === SUPER_SESSION_ID
        ? "reflect_request"
        : win.class === "talk"
          ? "talk"
          : "thread";

    if (projectionClass === "thread" || projectionClass === "reflect_request") {
      // 展示 transcript（reflect_request 视图与 self-view 同款渲染 messages；
      // scan_changes 结果由 method 调用结果显式注入，不在 readable 投影里渲）。
      const { visible: messages } = applyTranscriptViewport(self.data.messages, win.data?.transcriptViewport);
      children.push(...messages.map((m) => xmlText(m.from === "caller" ? `[self:] ${m.content}` : `[callee:] ${m.content}`)));
    } else {
      const { visible: messages } = applyTranscriptViewport(self.data.messages, win.data?.transcriptViewport);
      children.push(...messages.map((m) => xmlText(m.from === "caller" ? `[self:] ${m.content}` : `[callee:] ${m.content}`)));
    }

    return { class: projectionClass, content: children };
  },
  window: [
    {
      class: "thread",
      object_methods: ["reply", "end", "todo"],
      window_methods: [setTranscript, compress, resize],
    },
    {
      class: "talk",
      object_methods: ["say"],
      window_methods: [setTranscript, compress, resize],
    },
    {
      // issue D：super flow self-view 投影。surface 4 个分发器 object_methods（一步到位语义）
      // + say/reply（与 talk decl 同接口）。window_methods 与 talk decl 同。
      class: "reflect_request",
      object_methods: [
        "scan_changes",
        "create_pr_for_versioned",
        "sediment_unversioned",
        "create_pr_for_class_edits",
        "say",
        "reply",
      ],
      window_methods: [setTranscript, compress, resize],
    },
  ],
};

export default readable;
