/**
 * thread —— readable 维度（投影成 context window + window method）。
 *
 * thread 是唯一会话载体注册 class；同一 thread 实例按视角（POV）投影成不同 window class
 * （context.md 核心 2/8/9）。**issue E 简化**：原 thread / talk / reflect_request 三投影 → **default + super
 * 二投影**：
 *   - **default**（普通 flow / 业务 session 内 self-view 及 peer-view 同框）：transcript + say / reply
 *     / end / todo。caller / callee 视角由单 transcript 的 entry.author 字段渲染时区分 prefix，
 *     不再分支独立投影 class。
 *   - **super**（self-view super flow）：在 default 基础上额外 surface 4 个一步到位的反思分发 method
 *     （scan_changes / create_pr_for_versioned / sediment_unversioned / create_pr_for_class_edits）+
 *     say / reply。
 *
 * **单 transcript 模型**：thread.data.messages 是**单一**消息列表；每条 message 持 `from`
 * （"caller" / "callee"）。readable render 不分支投影 class、按 `from` 字段渲不同 prefix。
 *
 * 投影 class 由 `computeProjectionClass` 单一三元决定：`sessionId === SUPER_SESSION_ID → "super"`
 * 否则 → `"default"`。
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
 * 投影 class 算法（issue E 单一三元）：
 *   - `sessionId === SUPER_SESSION_ID` → "super"
 *   - 否则 → "default"
 */
function computeProjectionClass(sessionId: string): string {
  return sessionId === SUPER_SESSION_ID ? "super" : "default";
}

const readable: ReadableModule<Data, ThreadWin> = {
  readable: (_ctx: ReadableContext, self: ReadonlySelfProxy<Data>, win: OocObjectRef<ThreadWin>) => {
    const projectionClass = computeProjectionClass(self.data.sessionId);
    const { visible: messages } = applyTranscriptViewport(self.data.messages, win.data?.transcriptViewport);
    const children: XmlNode[] = messages.map((m) =>
      xmlText(m.from === "caller" ? `[caller:] ${m.content}` : `[callee:] ${m.content}`),
    );
    return { class: projectionClass, content: children };
  },
  window: [
    {
      // 普通 flow / 业务 session 内的统一投影：default。
      // surface: say / reply（会话交互）+ end / todo（thread 作用域 agency）。
      class: "default",
      object_methods: ["say", "reply", "end", "todo"],
      window_methods: [setTranscript, compress, resize],
    },
    {
      // super flow self-view 投影：除 say/reply 外额外 surface 4 个反思分发 method
      // （仅在 sessionId === SUPER_SESSION_ID 时被命中，业务 session 偷渡由 method 内
      // requireSuperSession 双闸门兜底）。
      class: "super",
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
