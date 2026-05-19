import type { DocNode } from "@meta/doc-types";

/**
 * Object 概念入口节点。
 *
 * 这是 aggregator——没有 sources，只承载叙述（OOC 是什么、Object 的特征、
 * 物理形态）。子树各能力（thinkable / executable / observable / ...）
 * 在 meta/index.doc.ts 顶层 tree 里挂载。
 */
export const object_v20260504_1: DocNode = {
  title: "section",
  content: `
OOC 是一种 AI 智能体（Agent）架构。

传统 Agent 的工作方式是：人类写一段 prompt，发给大语言模型（LLM），LLM 返回文本，
程序解析文本并执行动作，然后把结果拼回 prompt，再次发给 LLM。在这种模式下，
Agent 的「上下文」是一段不断增长的文本——它是扁平的、无结构的、一次性的。

OOC 提出一个不同的模型：**把 Agent 的上下文组织为「活的对象生态」**。

在 OOC 中，不存在一段巨大的 prompt。取而代之的是一组对象——每个对象有自己的身份、
数据、行为、思维方式和关系。对象之间可以协作、对话、创建新对象。

OOC （Object Oriented Context）由 Object 组成，每个 Object 都有以下特征：

- Object 是一个对象，包含属性和方法（数据与程序）
- Object 可以被其他 Object 引用，也可以引用其他 Object，可以和其他 Object 交互
- Object 具有知识（角色知识、技能知识、经验知识、记忆）
- Object 可持久化为文件，并可以进行元编程（阅读、修改自己）

从组成上（工程实现），Object 的"可被系统读取的实体形态"主要是文件系统目录：

- Stone：stones/{name}/（长期数据：长期身份、数据、固化能力、长期记忆）
- Flow：flows/{sessionId}/objects/{name}/（会话数据：一次任务中的运行态数据）
  `.trim(),
};
