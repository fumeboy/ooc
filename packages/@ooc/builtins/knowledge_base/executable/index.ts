/**
 * knowledge_base —— executable 维度。
 *
 * agent 组合持有的 tool-object 成员（可查询知识存储）。`open_knowledge` 经 makeRootDelegator
 * 委托到 knowledge constructor——把一篇 knowledge doc 作为 `knowledge` 窗引入 context。
 * 从 root 迁来：root 不再承载知识操作。独立壳断 root barrel import 循环。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";

// side-effect：确保被委托的 knowledge constructor 已注册。
import "@ooc/builtins/knowledge";

const OPEN_KNOWLEDGE_TIP = `open_knowledge 显式打开一个 knowledge doc，作为 knowledge 窗持续可见。
参数：path（必填，knowledge 索引中的路径，不带 .md）。`;

const openKnowledgeMethod: ObjectMethod = {
  description: "Pin a knowledge doc by path so it stays visible in context.",
  intents: ["open_knowledge"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
    },
  },
  onFormChange(_change, { args }) {
    const hasPath = typeof args.path === "string" && args.path.length > 0;
    return {
      tip: hasPath ? `Opening knowledge ${args.path}...` : OPEN_KNOWLEDGE_TIP,
      intents: [{ name: "open_knowledge" }],
      quick_exec_submit: hasPath,
    };
  },
  exec: makeRootDelegator({ method: "open_knowledge", constructorKind: "knowledge", objectLabel: "knowledge_window" }),
};

builtinRegistry.registerExecutable("knowledge_base", { methods: { open_knowledge: openKnowledgeMethod } });
