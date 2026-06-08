# 新建 engineering.harness.doc.ts

## Context

OOC 项目缺一份"engineering 视角"的纲领性文档，回答：**我们按什么思想去演化 OOC，使它最终能自我迭代？**

用户带来的答案：**Harness Engineering**——构建一个让 Agent 高效、准确工作的"环境支架"。核心公式：

> Harness = Environment + Feedback + Constraints + Knowledge

参考文献：`/Users/bytedance/x/ooc/ooc-0/docs/工程管理/组织/README.md`（提供"模型 + 角色 + 协作 + 工作循环"的叙事结构）。

用户明确：
- 文档目的是"按 harness 思想构建可自我迭代的 OOC 系统"——指导未来演化，不是纯理论也不是后置映射
- **不**包含 "paradigm shift 反思段"

## 输出

新增一个文件：`/Users/bytedance/x/ooc/ooc-2/meta/engineering.harness.doc.ts`。不修改任何其它文件。

## 文件骨架

格式遵循已有的 `meta/engineering.testing.doc.ts` 范式：
- 顶部一段简洁的"文档维护说明"注释（15-25 行，引用 `meta/object.doc.ts` 头部维护原则）
- 本地定义 `type DocTreeNode`（与其它 meta/*.doc.ts 一致；不 import）
- 导出 `export const root: DocTreeNode = { ... }`（不带版本号）

## 树结构设计

### root

```
title: "OOC Harness Engineering"
content:
  - 一句话定位：harness engineering 是"构建让 Agent 高效准确工作的环境支架"
  - 公式：Harness = Environment + Feedback + Constraints + Knowledge
  - 角色：人类 Steer（定义目标 + 约束），Agent Execute（生成 + 测试 + 部署）
  - 关键判断：研发瓶颈已从"写码速度"转向"逻辑验证 + 系统可见性"
  - 本文档目的：按 harness 思想演化 OOC 各维度，最终构建一个能自我迭代的系统
  - 子树导航说明
named:
  Harness Engineering / Environment / Feedback / Constraints / Knowledge / Steer / Execute / visibility-first
```

### root.children（4 要素 + 自我迭代闭环）

| key | title | 主要内容 |
|---|---|---|
| `environment` | 环境 - Agent 能感知与操作的世界 | OOC 现状：ContextWindow 抽象、persistable world 树（stones/ + flows/）；演化方向：扩展 window types、扩展 stone/flow 子树。锚 src/executable/windows/types.ts、src/persistable/common.ts |
| `feedback` | 反馈 - Agent 看见结果的通道 | OOC 现状：observable（debug 文件、ContextSnapshot、loop_NNNN）+ function_call_output + context_change/inject。锚 src/observable/index.ts、src/thinkable/context/index.ts |
| `constraints` | 约束 - Agent 行为的边界 | OOC 现状：稳定的 5 tool 原语（open/refine/submit/close/wait）+ command_exec form 渐进披露 + activates_on knowledge 渐进激活。锚 src/executable/tools/、src/thinkable/knowledge/types.ts |
| `knowledge` | 领域知识 - Agent 知道怎么做的来源 | OOC 现状：knowledge frontmatter + activates_on、reflectable memory、collaborable relation_knowledge、server method 的 knowledge() 函数。锚 src/thinkable/knowledge/synthesizer.ts、src/thinkable/reflectable/、src/executable/server/types.ts |
| `self_iteration` | 自我迭代闭环（核心 — 用户指明的文档目的） | 把 4 要素 × OOC 维度（reflectable + programmable + visible + persistable + thinkable.knowledge）画成"OOC 怎么改自己"的完整通路；说明 super flow 闭环、stone/server method 热更、stone/client tsx 热更如何串成 self-evolution loop |

### root.patches（横切设计与硬约束）

| key | title | 主要内容 |
|---|---|---|
| `role_split` | 人类 Steer vs Agent Execute 的分工 | 人类：定义 self.md/readme.md/data 初始状态、监控 super flow 反思、决定 ui_methods 暴露面、把握危险动作的 human-in-the-loop。Agent：所有具体动作（open/refine/submit/wait/talk-delivery/write_file/...） |
| `visibility_first` | Agent 看不见就修不了 | 硬约束：任何 Agent 不可见的系统状态本质上是"无法被 Agent 自修复的死区"。OOC 中的落实：captureContextSnapshot 序列化全部 thread state、tool 结果一律进 function_call_output、错误一律进 context_change/inject 让下一轮 LLM 看到 |
| `constraint_minimality` | 约束面要稳定，新能力走 command / window | tool surface 稳定（5 个原语），新能力变成新 command 或新 window type。反面教训：每加功能就加新 tool → LLM 行动面爆炸 → 调试与 knowledge 激活复杂化 |

## 关键源代码锚点（供叶节点引用）

| 4 要素 | OOC 锚点 |
|---|---|
| Environment | `src/executable/windows/types.ts`（ContextWindow / WindowType 联合）；`src/persistable/common.ts` + `stone-object.ts`（world 目录结构） |
| Feedback | `src/observable/index.ts`（LlmObservation / loop debug）；`src/persistable/debug-file.ts`（ContextSnapshot）；`src/thinkable/context/index.ts:200-260`（ProcessEvent 中 function_call_output / inject 路径） |
| Constraints | `src/executable/tools/index.ts`（OOC_TOOLS 5 个）；`src/executable/tools/{open,refine,submit,close,wait}.ts`；`src/thinkable/knowledge/types.ts`（activates_on）；`src/thinkable/knowledge/activator.ts` |
| Knowledge | `src/thinkable/knowledge/synthesizer.ts`（collectExecutableKnowledgeEntries / deriveRelationKnowledge）；`src/thinkable/reflectable/reflectable-knowledge.ts`；`src/executable/server/types.ts`（ServerMethod.knowledge 动态函数） |
| Self-iteration | reflectable / programmable / visible 在 `meta/object.doc.ts` 已经定义；本文 self_iteration child 主要做"四要素 → OOC 维度"的索引 + 串成一个闭环叙事，不重复 object.doc.ts 的细节 |

## 验证

- `cd /Users/bytedance/x/ooc/ooc-2 && bun tsc --noEmit meta/engineering.harness.doc.ts` 必须 exit 0、无输出
- 写完后做一次"文档断言 vs 源代码"一致性核查（与 app.server / app.client 同样的方式）：每条 src/ 锚点都验证存在；不存在的进 warnings 或 todo
- 写完后扫一眼 root.content 的 named 字典，确保所有提到的术语都真在 content 里出现过

## 不做的事

- 不修改其它 meta/*.doc.ts
- 不修改 src/ 下任何代码
- 不再引入版本化命名（沿用 `export const root: DocTreeNode = {...}`）
- 不写 paradigm shift 反思段（用户已明确）
- 不重复 object.doc.ts 中 reflectable / programmable / visible 各维度的具体细节；harness 文档只做"4 要素索引到 OOC 维度"的串联
