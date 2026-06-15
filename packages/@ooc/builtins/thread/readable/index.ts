/**
 * thread —— readable 维度（投影成 context window）。
 *
 * thread 是 creator 窗的 **self-view** class（与对端 thread 的 other-view 会话窗 talk 区分，见
 * `executable/windows/_shared/projection-class.ts`），与 talk 同形：投影 class=thread，但会话渲染
 * （transcript / viewport）应与 talk 一致。
 *
 * 现状：本文件是**最小占位 readable**——投影 class=thread + 简短说明 content。talk 已迁到新
 * `ReadableModule (ctx,self,win)` 契约（`core/.../windows/talk/readable`），但其渲染依赖 TalkData /
 * TalkWin 与 transcript-viewport 等 core 内部物；thread 复用 talk 渲染需跨包接线（见包内说明），
 * 不在本 class 单方裁决，故此处仍留占位。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** thread 的投影态（与 Data 分离）。复用 talk 渲染后将承载 transcript viewport 投影态。 */
export interface ThreadWin {}

const readable: ReadableModule<Data, ThreadWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: ThreadWin) => ({
    class: "thread",
    content: [
      xmlElement("note", {}, [
        xmlText(
          "thread self-view —— 会话渲染继承自 talk（占位，待跨包接线复用 talk readable）。",
        ),
      ]),
    ],
  }),
  window: [
    {
      class: "thread",
      object_methods: [],
      window_methods: [],
    },
  ],
};

export default readable;
