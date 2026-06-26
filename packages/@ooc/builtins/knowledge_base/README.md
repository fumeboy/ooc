# knowledge_base —— 基于意图的知识激活实现

> **本 builtin 是 issue N 后承接 thinkable 维度迁出的 knowledge 激活机制 ownership**。
> 「core 产出意图、ooc class 自决消费」哲学的实现实例之一。

## 角色定位

knowledge_base 是 OOC agent 组合持有的 tool-object 成员（不是 Agent）—— 一个可查询的知识存储。
每个 thread 默认在 `contextWindows` 中含一个 `_builtin/knowledge_base` ref（见
`builtins/agent/children/thread/index.ts:53` 与 super flow 路径 `builtins/agent/executable/method.talk.ts`），
当 thread 渲染 LLM input 时，knowledge_base 的 readable 据 `ReadableContext.intents` 算激活 +
输出 `<knowledge>` 子节点（XML 形态从原顶层 `<knowledge>` 段变为 `<window class="_builtin/knowledge_base">` 内的子节点）。

## 目录结构

```
knowledge_base/
├── index.ts                # Class 装配（executable + readable）
├── types.ts                # Data（空对象,单例 tool-object 无业务字段）
├── loader.ts               # loadKnowledgeIndex —— 双源（stone seed + pool sediment）磁盘扫描
├── activator/              # 激活机制（issue N 从 core/thinkable/knowledge/ 迁入）
│   ├── index.ts            # 公开 API barrel
│   ├── types.ts            # KnowledgeFrontmatter / KnowledgeDoc / KnowledgeIndex / ActivationResult
│   ├── parser.ts           # .md → frontmatter + body
│   ├── expr.ts             # Trigger 解析 + 求值（**单一 intent 维度**）
│   └── activator.ts        # computeActivations 算法
├── readable/index.ts       # ReadableModule —— 据 ctx.intents 算激活 + 渲 <knowledge> 子节点
├── executable/index.ts     # open_knowledge method —— 把一篇 knowledge 作为子窗 pin 入 context
└── children/knowledge/     # 子 class:一篇 knowledge doc 的窗口对象
```

## 激活协议（issue N 简化为单一 intent 维度）

knowledge md 的 frontmatter 写 `activates_on: { "<trigger>": "<level>" }`,trigger 全部为 intent 形态：

| trigger 形态 | 含义 | 谁产 intent |
|---|---|---|
| `intent::class::<class>` | context 中有这个 class 的 window | 每条 contextWindows ref（core 兜底 + 各 class.readable.intents 自决补充） |
| `intent::form_open::<targetClass>::<guideName>` | 某 form open 着指向某 class 的某 guide | `method_exec_form.readable.intents` 据自身 data 产 |
| `intent::super_flow::active` | 当前 thread 跑在 super session | `thread.readable.intents` 据 sessionId 产 |
| `intent::user::<name>` | 用户自定义命名空间（ooc class 自由发挥） | 任意 ooc class 自己的 readable.intents 产 |

intent 集合本身由 `core/thinkable/context/scanIntents.ts` 在每轮 thinkloop 聚合,作为
`ReadableContext.intents` 注入各 readable render。本 activator 的 evaluateTrigger 仅做 `env.intents.has(t.name)` 匹配。

**已退役**：旧 `window::` / `method::` / `super::` 三 kind 的 trigger 协议（issue N 裁决 5）。`object::` 历史拼写也随之退役。

## 命名空间约定

- **`class::<class>`** —— ref class id 兜底（core scanIntents 自动产 full id + short name 双形态：
  full = `_builtin/agent/plan`,short = `plan`,knowledge md 写哪种都命中）。
- **`form_open::<targetClass>::<guideName>`** —— 由 method_exec_form 产。
- **`super_flow::active`** —— super flow 内 thread 产。
- **`user::*`** —— 用户 ooc class 自定义命名空间。

## 双源加载（不变）

stone seed（设计期、进 git）`<world>/stones/main/objects/<owner>/knowledge/*.md` +
pool sediment（运行时、不进 git）`<world>/pools/objects/<owner>/knowledge/*.md`,
同名 sediment 覆盖 seed。**不沿继承链**（子若想用父 knowledge,自己 import + 重声明）。

## 渲染失败 fallback

knowledge_base 不在 contextWindows 时整段 `<knowledge>` 消失,**不 core 兜底渲空段**（issue N 裁决 13:OOC 哲学一致「对象不在则其表现不在」）。

## stateless 投影

`readable.intents` 与 `ctx.intents` 都是**每轮 thinkloop 重算、无缓存**——form close 后产
intent 自然消失,无需手工撤销。
