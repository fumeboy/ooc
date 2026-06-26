/**
 * knowledge_base —— readable 维度（投影成 context window）。
 *
 * **issue N**: 承担 knowledge 激活+渲染——按 ReadableContext.intents 算激活、输出 `<knowledge>`
 * 子节点（原 thread/thinkable/context.ts 内联 renderKnowledge 整段 + activationEnv 下沉到此）。
 *
 * 设计：knowledge_base 是 thread.contextWindows 内一个普通 builtin window；自己作为 ref 被
 * 渲染时,内部经 ctx.intents（core scanIntents 聚合）→ computeActivations → `<knowledge>` 子节点。
 * 知识 index 由调用方（thread builtin）预加载并经 win 注入（loader 依赖 worldDir/ownerId,这俩
 * 信息不在 ReadableContext 内,故由 thread 在 renderWindow 时一次性 load+pass-through）。
 *
 * fallback: knowledge_base 不在 contextWindows 时整段消失,不 core 兜底渲空段（OOC 哲学:对象
 * 不在则其表现不在）。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { XmlNode } from "@ooc/core/types/xml.js";
import { xmlElement, xmlText } from "@ooc/core/types/xml.js";
import type { Data } from "../types.js";
import {
  type ActivationResult,
  type KnowledgeIndex,
  computeActivations,
} from "../activator/index.js";

/**
 * knowledge_base 的投影态。
 *
 * `index` 字段是**渲染前注入的临时 knowledge index**——caller（thread/context.ts）在调
 * renderReadable 之前 loadKnowledgeIndex(worldDir, ownerId) 拿到后写入 ref.data；readable.render
 * 据此 + ctx.intents 算激活。这里走 ref.data（投影态）而非 inst.data,因为 knowledge_base 是
 * 单例 tool-object 无业务 self.data,且 index 是 per-thread 渲染瞬时值（不持久化）。
 */
export interface KnowledgeBaseWin {
  index?: KnowledgeIndex;
}

function renderActivations(activations: ActivationResult[]): XmlNode[] {
  return activations.map((a) =>
    xmlElement(
      "doc",
      { path: a.path, presentation: a.presentation },
      a.presentation === "full"
        ? [xmlText(a.doc.body)]
        : a.doc.frontmatter.description
          ? [xmlText(a.doc.frontmatter.description)]
          : [],
    ),
  );
}

const readable: ReadableModule<Data, KnowledgeBaseWin> = {
  readable: (ctx: ReadableContext, _self, win: OocObjectRef<KnowledgeBaseWin>) => {
    const index = win.data?.index;
    if (!index || index.byPath.size === 0) {
      // 无 index（thread 未注入 / world 无 knowledge 目录）——按 issue N 裁决 13:
      // fallback 完全无段,仅渲身份描述,不挂 <knowledge>。
      return {
        view: "default",
        content: [
          xmlElement("about", {}, [
            xmlText(
              "知识库对象（agent 持有的成员）——可查询知识存储。open_knowledge 把一篇 doc 作为 knowledge 窗引入 context。",
            ),
          ]),
        ],
      };
    }
    // 跑激活
    const activations = computeActivations(index, { intents: ctx.intents });
    const children: XmlNode[] = [
      xmlElement("about", {}, [
        xmlText(
          "知识库对象（agent 持有的成员）——可查询知识存储。open_knowledge 把一篇 doc 作为 knowledge 窗引入 context。",
        ),
      ]),
    ];
    if (activations.length > 0) {
      children.push(
        xmlElement(
          "knowledge",
          { count: String(activations.length) },
          renderActivations(activations),
        ),
      );
    }
    return {
      view: "default",
      content: children,
    };
  },
  window: [
    {
      view: "default",
      object_methods: ["open_knowledge"],
      window_methods: [],
    },
  ],
};

export default readable;
