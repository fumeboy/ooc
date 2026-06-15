/**
 * knowledge_base —— executable 维度（object method）。
 *
 * agent 组合持有的 tool-object 成员（可查询知识存储）。委托类 tool-object：`open_knowledge`
 * 经 `ctx.runtime.instantiate('_builtin/knowledge', args)` 造一个 `knowledge` 子对象——把一篇
 * knowledge doc 作为 `knowledge` 窗引入 context、持续可见。委托方自身只调 instantiate，
 * 构造前置逻辑（path 解析 / 读盘）归 knowledge class 的 constructor。
 */
import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const openKnowledgeMethod: ObjectMethod<Data> = {
  name: "open_knowledge",
  description: "Pin a knowledge doc by path so it stays visible in context.",
  schema: {
    args: {
      path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: { path?: string }) => {
    if (!ctx.runtime) {
      throw new Error("[open_knowledge] runtime handle 缺失，无法实例化 knowledge 子对象。");
    }
    const id = await ctx.runtime.instantiate("_builtin/knowledge", args);
    return `opened knowledge → ${id}`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [openKnowledgeMethod],
};

export default executable;
