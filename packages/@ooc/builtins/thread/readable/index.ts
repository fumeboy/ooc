/**
 * thread —— readable 维度（投影成 context window）。
 *
 * thread 经 class 链继承 talk（`ooc.class: "talk"`）的会话渲染：它是普通 flow 里 creator 窗的
 * **self-view** class（context.md core 9：与对端 thread 的 other-view 会话窗 talk 区分），与 talk
 * 同形，渲染行为应**完全复用 talk 的 renderTalkWindow**。
 *
 * deferred（Wave4 talk 迁移归位）：talk 的 renderTalkWindow 仍在 core 用旧渲染上下文签名（本轮
 * 未迁），无法直接以新 (ctx,self,win) 契约调用。本文件先给一个**最小占位 readable**——投影 class=thread
 * + 简短说明 content；待 talk 迁到新契约后，本 readable 复用 talk 的渲染（含 transcript viewport /
 * compressView / consumedMessageIds 等会话维度 hook）。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import { xmlElement, xmlText } from "@ooc/core/_shared/types/xml.js";
import type { Data } from "../types.js";

/** thread 的投影态（与 Data 分离）。Wave4 复用 talk 的 transcript viewport 投影态。 */
export interface ThreadWin {}

const readable: ReadableModule<Data, ThreadWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: ThreadWin) => ({
    class: "thread",
    content: [
      xmlElement("note", {}, [
        xmlText(
          "thread self-view —— 继承 talk 的会话渲染（Wave4 talk 迁移后接回 renderTalkWindow）。",
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
