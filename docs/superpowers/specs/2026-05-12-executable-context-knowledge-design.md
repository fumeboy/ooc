# Executable Context Knowledge Design

**日期：** 2026-05-12

## 目标

将 `src/thinkable/context` 中与执行协议相关的推断逻辑移出，收敛到 `src/executable` 子系统；`context` 只负责渲染线程状态与知识条目，不再生成 `next_action` / `protocol_hint` 一类的业务语义。

## 背景问题

当前 `context` 目录虽然已经拆为 `index.ts` / `render.ts` / `knowledge.ts` / `protocol.ts`，但复杂度并未真正下降。根因不是 XML 拼接代码多，而是 `renderActiveForms()` 同时承担了三类职责：

1. 把 form 状态序列化成 XML
2. 根据 form 生命周期推断下一步动作
3. 为 `program` command 补充协议提示与 function knowledge

这些职责不属于同一主干概念。真正的主干是：

- `context`：把已经存在的状态投影给 LLM
- `executable`：定义执行协议、命令语义与命令相关知识

## 设计原则

1. `context` 不生成业务协议，只渲染事实和已准备好的知识
2. command-specific knowledge 由 command 自己提供，不由 `context` 推断
3. knowledge 正文统一展示在 `<knowledge>` 区域，不内联到 `<form>`
4. `<form>` 只展示其关联的 knowledge path，帮助 LLM 理解“该 form 当前绑定了哪些协议知识”
5. 相同 knowledge path 的正文在单次 context 中只出现一次

## 目标结构

### 1. executable 全局基础知识

新增 `src/executable/index.ts`，导出：

- `KNOWLEDGE`：全局执行能力基础知识

它是每轮 `buildContext()` 都会注入的常驻知识，内容参考 `ooc-0/kernel/traits/base/TRAIT.md`，但裁剪为当前工程真实存在的执行协议：

- `open / refine / submit / close / wait`
- form 生命周期（`open / executing / executed`）
- 何时用 `close`
- 何时用 `wait`
- 参数渐进填充与 `refine` 的意义

### 2. command knowledge 接口

扩展 `CommandTableEntry`：

```ts
knowledge?: (
  args: Record<string, unknown>,
  formStatus: "open" | "executing" | "executed"
) => Record<string, string>;
```

约束：

- key 是 knowledge path
- value 是 knowledge content
- 所有 path 统一使用 `internal/executable/` 前缀

### 3. program command 的 knowledge 生成

`program` command 负责生成自己在当前参数态下的知识 map：

- `internal/executable/program/base`
- `internal/executable/program/form-status`
- `internal/executable/program/function`
- `internal/executable/program/shell`
- `internal/executable/program/tsjs`

其中：

- `form-status` 负责承接原来 `inferProtocolHint()` 里与 `executing / executed` 相关的提示
- `program` 缺参提示承接原来 `inferProgramProtocolHint()`
- 当 `function` 模式命中 server method 时，`program` 内部调用原方法的 `knowledge(args)`，再把结果拼到 `internal/executable/program/function`

## 数据模型

### ActiveForm

删除：

- `methodKnowledge?: string`

新增：

- `commandKnowledgePaths?: string[]`

`ActiveForm` 不再存储知识正文，只记录该 form 当前绑定的 knowledge path。

### knowledgeEntries

context 构建阶段引入临时汇总结构 `knowledgeEntries`，用于收集本轮需要展示的 executable knowledge。它不需要持久化，不回写 thread。

建议形态：

```ts
type KnowledgeEntries = Record<string, string>;
```

## 渲染策略

### form XML

`<form>` 中保留：

- `command`
- `description`
- `accumulated_args`
- `command_paths`
- `loaded_knowledge`
- `command_knowledge_paths`
- `result`

删除：

- `<next_action>`
- `<protocol_hint>`
- `<method_knowledge>`

### knowledge XML

在 `<knowledge>` 区域中新增 executable knowledge 段，渲染 `knowledgeEntries`。

建议结构：

```xml
<knowledge_entries>
  <knowledge path="internal/executable/base">...</knowledge>
  <knowledge path="internal/executable/program/base">...</knowledge>
</knowledge_entries>
```

同 path 只出现一次。

## 移除项

整文件移除：

- `src/thinkable/context/protocol.ts`

连带移除：

- `inferNextAction`
- `inferProtocolHint`
- `inferProgramProtocolHint`

## 实现边界

### 保持不变

- `context/index.ts` 仍保留 `buildContext()` 主干编排
- `context/knowledge.ts` 继续负责知识激活
- `server method` 自带 `knowledge(args)` 接口仍可用

### 要调整

- `executable` 新增全局基础知识入口
- `commands/types.ts` 扩展 `knowledge(args, formStatus)`
- `program.ts` 承接原 `program` 协议提示
- `server/enrich.ts` 升级为通用 command knowledge enrich
- `render.ts` 从“推断协议”改为“渲染已有 knowledge path 与 knowledge entries”

## 测试要求

1. `context` 不再渲染 `next_action` / `protocol_hint`
2. `buildContext()` 总是包含 executable base knowledge
3. `form` 只展示 `commandKnowledgePaths`，不展示 knowledge 正文
4. knowledge 正文只在 `<knowledge>` 区域出现
5. 多个 form 引用相同 knowledge path 时，正文只出现一次
6. `program` 在不同 args / status 下返回不同的 knowledge map
7. `program.function` 能拼接原 function knowledge

## 结果预期

完成后：

- `context` 目录复杂度会因职责收敛而下降
- 执行协议的演进集中在 `src/executable`
- 以后新增 `talk` / `do` / `todo` 的动态协议时，可以直接复用 command knowledge 机制，而不必再往 `context` 里加 `infer*`
