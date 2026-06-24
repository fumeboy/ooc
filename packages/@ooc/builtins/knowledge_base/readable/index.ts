/**
 * knowledge_base —— readable 维度（投影成 context window）。
 *
 * 无业务数据，只渲染身份/用途；方法菜单由 window 声明（object_methods 引用 open_knowledge）。
 * 无投影态（Win = {}）：tool-object 成员不持展示态。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import type { Data } from "../types.js";

/** knowledge_base 的投影态：无（tool-object 成员不持展示态）。 */
export interface KnowledgeBaseWin {}

const readable: ReadableModule<Data, KnowledgeBaseWin> = {
  readable: (_ctx: ReadableContext, _self: Data, _win: KnowledgeBaseWin) => ({
    class: "knowledge_base",
    content: [
      xmlElement("about", {}, [
        xmlText(
          "知识库对象（agent 持有的成员）——可查询知识存储。open_knowledge 把一篇 doc 作为 knowledge 窗引入 context。",
        ),
      ]),
    ],
  }),
  window: [
    {
      class: "knowledge_base",
      object_methods: ["open_knowledge"],
      window_methods: [],
    },
  ],
};

export default readable;
