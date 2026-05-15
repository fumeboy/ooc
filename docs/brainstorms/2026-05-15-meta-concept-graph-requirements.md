# meta/ 概念→代码 双向锁定（concept graph）

- **Date**: 2026-05-15
- **Stage**: brainstorm
- **Driver**: 文档先行做不到，因为补设计时常常直接改代码忘了回写 meta；要让 "改了代码必然影响文档" 变成可机器检测的强约束
- **Recommended next step**: `/ce-plan` (纵向先跑通 executable 模块)

## Problem

`meta/**/*.doc.js` 当前的写法：每个模块导出一个 `<name>_v<date>_<n>` 对象，对象的核心是一段 `index` 大块 markdown，里面同时写了 N 个设计概念（例如 `executable.index` 同时讲了 ContextWindow、5 原语、渐进式披露、knowledge 自动激活、submit 副作用…）。这导致两类问题：

1. **概念在代码里被改、在 meta 里被遗忘 → 文档失效**。最近几周加新 window type、改 refine schema、改 talk_window 协议时都发生过：代码改完测试通过，meta 里描述的还是上一版。CI 没有任何信号阻止这种漂移。
2. **概念无法被单点引用**。今天要在某次 brainstorm / commit message / 知识激活里指 "ContextWindow"，只能贴一整段 `executable.index`；同一概念在多处提及就会被独立改写、各处描述漂移。

文档先行（设计 → 写 doc → 再 import 到源码 → 实现）当前几乎不可能，因为 doc 不能被代码 import / 校验，写完没保护。

## Goal

让 meta 与 src 双向绑定：

- 每个**设计概念**是 `meta/` 里一个**具名 JS 对象**，可被 `var.path.to.concept` 单点引用
- 每个概念对象通过 `sources: { ... }` import 它对应的**源码 module 或 symbol**
- CI / pre-commit 在每次 commit 前跑 `bun tsc --noEmit` 与 link-check 脚本：源码删除 / 重命名 / 改 export 时，meta 立刻报错，迫使一并更新

## Non-goals

- **不重写概念文本本身**。本轮迁移不追求让 markdown 写得更好，只重新组织。文本质量是后续工作
- **不动 `docs/superpowers/` 历史 spec/plan**。它们是历史档案，不参与本结构
- **不做 meta 浏览的 UI / 索引页面**。本期产出仍是源码可读的 JS 对象
- **不引入新依赖**。CI 检查用 bun + tsc + 一个 ~50 行检查脚本足够
- **不展开横向其它模块**。executable 跑通前不动 thinkable / collaborable / app / web 的 meta

## Users / Beneficiaries

| 角色 | 受益方式 |
|---|---|
| 人（项目作者） | 改一处概念文本 / 加一个 window type 时，单点定位、机器提醒 |
| CodeAgent（含本会话） | 可以从 OOC LLM context 中按 `executable.contextWindow` / `executable.tools.refine` 精确拉取一段，而不是塞一整个 `executable.index` |
| 后续 ce-brainstorm / ce-compound | 引用具体概念时不必复制整段 markdown |

## Approach

**整体形态**：每个 doc.js 文件由一个 "总 index 对象" 退化为一组**概念对象**，每个概念对象形如：

```js
// meta/object/executable/concepts/context-window.doc.js
import * as windows from "@src/executable/windows/index";
import * as types from "@src/executable/windows/types";

export const context_window_v20260515_1 = {
  name: "ContextWindow",
  description: `
ContextWindow 是 thread 持有的上下文单元。每个 window 有 id/type/title/status...
`.trim(),
  sources: {
    types,        // 引用源码模块；CI 校验该模块仍在
    windows,      // 删除 / 重命名 src 文件 → tsc 立刻报错
  },
};
```

聚合层（如 `meta/object/executable/index.doc.js`）只 import + 串成树，自身不含大段文本：

```js
import { context_window_v... } from "./concepts/context-window.doc";
import { progressive_disclosure_v... } from "./concepts/progressive-disclosure.doc";
// ...

export const executable_v... = {
  description: `Executable 描述 Object 的行动 / 编程能力。`,
  concepts: {
    context_window: context_window_v...,
    progressive_disclosure: progressive_disclosure_v...,
    // ...
  },
};
```

**CI 校验**两层：

1. `bun tsc --noEmit` 已经会检测 `import` 失败（最强保护，零额外成本）
2. 一个 ~50 行 `scripts/check-meta-links.ts` 脚本，遍历 `meta/**/*.doc.js`，断言：
   - 每个 export 的概念对象有 `sources` 字段且非空 record
   - `sources` 里每个值是一个 module namespace 或一个具名 symbol
   - 在 pre-commit hook + bun test 中各跑一次

## Scope

**首期 = executable 模块**，验证整个 schema / 命名 / 工具链。executable 概念清单（从当前 `executable.index` 内容拆出来的初稿，可在 plan 阶段微调）：

| 概念名 | 对应源码 |
|---|---|
| `context_window` | `src/executable/windows/types.ts`, `windows/index.ts` |
| `window_registry` | `src/executable/windows/registry.ts` |
| `window_manager` | `src/executable/windows/manager.ts` |
| `five_primitives` (open/refine/submit/close/wait) | `src/executable/tools/*.ts` |
| `mark_primitive` | `src/executable/tools/schema.ts` 的 MARK_PARAM |
| `progressive_disclosure` | （概念性，sources 指向 windows/registry.ts + executable/index.ts 的 `collectExecutableKnowledgeEntries`） |
| `knowledge_activation` | `src/thinkable/knowledge/index.ts`, `src/executable/index.ts` 的 collectExecutableKnowledgeEntries |
| `creator_window` | `src/executable/windows/init.ts` |
| `talk_window_protocol` | `src/executable/windows/talk.ts` |
| `do_window_protocol` | `src/executable/windows/do.ts` |
| `todo_window_protocol` | `src/executable/windows/todo.ts` |
| `program_window_protocol` | `src/executable/windows/program.ts`, `program-runtime.ts` |
| `file_window_protocol` | `src/executable/windows/file.ts` |
| `knowledge_window_protocol` | `src/executable/windows/knowledge.ts` |
| `command_exec_lifecycle` | `src/executable/windows/manager.ts` 的 openCommandExec / submit |
| `talk_delivery` | `src/executable/windows/talk-delivery.ts` |
| `root_commands` | `src/executable/windows/root/index.ts`, root/*.ts |
| `server_methods` | `src/executable/server/loader.ts`, types.ts |
| `client_ui_methods` | （sources 主要在 web/，executable 这里只标 reference） |

**横向推进**：executable 验证完后，按依赖顺序复制结构：thinkable → collaborable → persistable → observable → app/server → app/web。

## Success criteria

1. executable 模块下每个概念都是一个具名 JS 对象，可以从外面 `executable_v....concepts.context_window` 取
2. 删除 / 重命名 `src/executable/windows/talk.ts` 时，`bun tsc --noEmit` 立刻报错（验证 import 锁）
3. 把 `talk_window_protocol.sources` 写空、或写一个不存在的字段，pre-commit 拒绝该 commit（验证 link-check 脚本）
4. `meta/object/executable/index.doc.js` 不再有 ≥30 行的 markdown blob；同等内容由 7-15 个独立 concept doc 文件提供
5. brainstorm / commit message 引用某个概念时，可以贴 `executable.concepts.talk_window_protocol` 的具名路径而不是大段文本

## Risks / Assumptions

- **`sources` 字段的语义边界**：能 import module 是清晰的；要 "import 某个 symbol" 时如果该 symbol 是 default export / re-export 链很长会变脆。**决策**：第一期 sources 只接受 module namespace（`import * as x from "..."`），允许列多个 module；symbol 级映射放进概念文本里以注释方式说明，不进 schema。
- **CI 检查会拖慢 pre-commit**：50 行脚本 + tsc 已经在跑。bun tsc --noEmit 当前 ~3-5s，可接受
- **现有 `<name>_v<date>_<n>` 命名 + `get parent()` getter 与新 schema 共存的迁移成本**：第一期 executable 完整切换；旧字段（如 `executable.index`）在过渡期保留为 `legacy_index`，下个版本删除
- **概念粒度划法存在主观性**：本文档列出的 18 个 executable 概念是初稿，plan 阶段会再校。原则：一个概念 = 在 LLM context 里要么整体出现要么不出现的最小单元
- **多个概念引用同一个 src 文件不构成冲突**（如 manager.ts 同时被 context_window / window_manager / command_exec_lifecycle 引用）；这就是细粒度的好处，不是 bug

## Open questions for `/ce-plan`

1. concept doc.js 文件的目录组织：`meta/object/executable/concepts/*.doc.js` vs 直接平铺在 `meta/object/executable/`？
2. CI 检查脚本是独立 `scripts/` 还是放在 `meta/__tests__/`？
3. 旧的 `<name>_v<date>_<n>` 版本号格式是否继续？这次拆分要不要顺便引入更稳定的命名（去掉日期）？
4. `sources` 字段是 `Record<string, ModuleNamespace>` 还是 `ModuleNamespace[]`（无名 vs 命名）？

## Related

- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — 同一个会话里另一条经验：协议名字一改要全链路同步，本工作正是为了让这种全链路同步可被机器检测
- 当前 meta 入口：`meta/index.doc.js`
- executable 顶层：`meta/object/executable/index.doc.js`
