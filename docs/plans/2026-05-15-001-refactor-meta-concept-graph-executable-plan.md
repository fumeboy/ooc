---
title: "refactor: meta/ concept graph (executable module first)"
date: 2026-05-15
status: active
type: refactor
origin: docs/brainstorms/2026-05-15-meta-concept-graph-requirements.md
depth: standard
---

# refactor: meta/ concept graph (executable module first)

> **Origin**: `docs/brainstorms/2026-05-15-meta-concept-graph-requirements.md`. The brainstorm established WHAT (拆 meta blob → 具名 concept 对象 + 代码级 import + CI 校验，executable 先行) and WHY (文档先行做不到，因为补设计时改代码忘改 meta，需要让漂移可机器检测). This plan defines HOW.

---

## Summary

`meta/object/executable/**/*.doc.js` 当前是几个大块 markdown blob，里面同时讲 ContextWindow / 5 原语 / 渐进式披露 / 各 window 协议等多个概念。这种形态让概念无法被单点引用，也让 "代码改了但 meta 没跟上" 失同步藏身。

本次重构把每个**设计概念**变成一个**具名 JS 对象**，对象的 `sources: Record<string, ModuleNamespace>` 字段 import 它对应的源码 module。`bun tsc --noEmit` 自然守住 import 失败；新增的 `meta/__tests__/concept-links.test.ts` 在 `bun test` 时遍历 meta 树，校验 sources schema 形状（非空 Record、值是 module namespace、所有概念有 description）。

首期只做 executable 模块，跑通 schema / 命名 / 工具链；后续 thinkable / collaborable / app / web 复刻同结构（不在本计划内）。

---

## Problem Frame

**痛点**（origin §Problem 完整保留）:

1. 概念在代码里被改、在 meta 里被遗忘 → 文档失效。最近几周加新 window type、改 refine schema、改 talk_window 协议时都发生过；测试通过但 meta 描述还是上一版，CI 没有信号阻止
2. 概念无法被单点引用。今天要在 brainstorm / commit message / 知识激活里指 "ContextWindow"，只能贴一整段 `executable.index`；同一概念在多处提及就会被独立改写

**目标**：让 meta 与 src 双向绑定，使得"改了代码必然影响文档"成为机器可检测的强约束，进而让"文档先行"工作流成为可能。

---

## Scope Boundaries

### In scope (this plan)

- 重构 `meta/object/executable/` 下所有 `*.doc.js`：把大块 index 文本拆成具名 concept 对象，每个对象带 `sources: Record<string, ModuleNamespace>`
- 新增 `meta/__tests__/concept-links.test.ts`：bun test 时遍历 meta 树，校验 schema
- 维持 `executable_v<date>_<n>` 等顶层版本对象继续 export，对外引用（如 `meta/index.doc.js`）不破坏

### Deferred for later (origin)

- thinkable / collaborable / persistable / observable / app / web 模块同结构铺开。本计划跑通 executable 后另开 plan 复刻
- 概念文本本身的质量提升（origin §Non-goals）— 本期搬运为主，文本改进是后续工作

### Outside this product's identity (origin)

- meta 浏览的 UI / 索引页面
- 引入新依赖（ts-morph 等）
- 概念→相关 PR / thread.json 失败案例 等扩展关联
- 修改 `docs/superpowers/` 下的历史 spec/plan

### Deferred to Follow-Up Work (this plan only)

- 旧 `<name>_v<date>_<n>` → 更稳定命名的统一切换：本计划保留日期版本（用户决定），未来若觉得日期太重再单独走一次重命名
- pre-commit hook 启用：当前仓库 `.git/hooks/pre-commit` 是空的；本计划只让 `bun test` 校验，pre-commit hook 接入是另一项 chore

---

## Key Technical Decisions

| 决策 | 选择 | 理由 |
|---|---|---|
| **关联粒度** | 代码级 `import * as ns from "@src/..."`（origin 已选） | tsc 直接守住失败；symbol 级映射太脆，第一期只做 module namespace |
| **`sources` 形状** | `Record<string, ModuleNamespace>`（命名） | 名字承载语义（"该概念在 windows 这个 module 表达"），重构后仍能保留含义；`Module[]` 写起来更轻但失去意义 |
| **concept 变量名** | 沿用 `<name>_v<YYYYMMDD>_<n>`（origin 已选） | 与现有 executable_v20260504_1 等保持一致；后续若觉得日期版本累赘再统一切换 |
| **CI 检查脚本位置** | `meta/__tests__/concept-links.test.ts`（origin 已选） | bun test 自动发现；不需要单独 wire pre-commit |
| **concept 文件组织** | 复杂度驱动：当一个 doc.js 拆出 ≥3 个独立概念时，建子目录 `concepts/`；否则平铺 | 用户授权"自行决定"；executable 顶层 index 拆出 ≥6 个 → 用 concepts/，actions/tools/ 各文件单概念 → 平铺 |
| **顶层 `executable_v...` 对象保留方式** | 顶层对象保留，结构变成 `{ description, concepts: { ... } }`；旧 `index` 大块 markdown 退化为 `legacyIndex`（一两行兜底说明） | `meta/index.doc.js` 等下游 import 不破坏；下次 plan 删 `legacyIndex` |
| **concept schema 形状** | `{ name, description, sources: Record<string, ModuleNs>, parent? }` | name/description 必填；sources 校验非空 Record；parent 可选用于面包屑 |
| **CI 校验严格度** | 测试 `expect(sources).toBeDefined()` + `Object.keys(sources).length > 0` + 每个 value 是 object（module namespace 在运行时是 object） | 严格但不脆 |

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

新结构示意（concept 文件 + 聚合层）：

```
meta/object/executable/
├── index.doc.js                    # 聚合层：import + 串成 concepts/{...} 树
├── concepts/                       # 顶层独立概念
│   ├── context-window.doc.js       # → src/executable/windows/{types,index}.ts
│   ├── window-registry.doc.js      # → src/executable/windows/registry.ts
│   ├── window-manager.doc.js       # → src/executable/windows/manager.ts
│   ├── progressive-disclosure.doc.js  # 协议性概念，sources 指向 collectExecutableKnowledgeEntries
│   ├── creator-window.doc.js       # → src/executable/windows/init.ts
│   ├── command-exec-lifecycle.doc.js  # → manager.ts (openCommandExec/submit)
│   └── knowledge-activation.doc.js # → src/thinkable/knowledge/index.ts + executable/index.ts
├── actions/
│   ├── tools/{*.doc.js}            # 已经是单概念形态：原地补 sources（多数已有）
│   └── commands/{*.doc.js}         # 同上
├── windows/                        # 新增：每种 window type 一个 concept
│   ├── talk-window.doc.js          # → src/executable/windows/talk.ts + talk-delivery.ts
│   ├── do-window.doc.js
│   ├── todo-window.doc.js
│   ├── program-window.doc.js
│   ├── file-window.doc.js
│   └── knowledge-window.doc.js
├── server/index.doc.js             # 已是单概念：补 sources
└── client/index.doc.js             # 同上
```

每个 concept 对象的形状：

```js
// 示意，非实现规范
import * as windows from "@src/executable/windows/index";
import * as types from "@src/executable/windows/types";

export const context_window_v20260515_1 = {
  name: "ContextWindow",
  description: `
ContextWindow 是 thread 持有的上下文单元。每个 window 有 id/type/title/status...
`.trim(),
  sources: { types, windows },
};
```

聚合层 `executable/index.doc.js` 改为：

```js
// 示意
import { context_window_v20260515_1 } from "./concepts/context-window.doc";
// ...

export const executable_v20260504_1 = {
  description: `Executable 描述 Object 的行动 / 编程能力。`,
  concepts: {
    contextWindow: context_window_v20260515_1,
    progressiveDisclosure: progressive_disclosure_v20260515_1,
    // ...
  },
  // 旧字段保留为 legacyIndex 以最小化对 meta/index.doc.js 等下游的破坏
  legacyIndex: `（已被拆分到 concepts/）`,
  tools: tools_v20260506_1,        // 现有子树继续暴露
  commands: commands_v20260506_1,
  server: server_v20260506_1,
  client: client_v20260506_1,
  sources: {                       // 现有 sources 保留
    tools: executable_tools,
    commands: executable_commands,
    windows: executable_windows,
  },
};
```

`concept-links.test.ts` 的检查逻辑（伪代码）：

```ts
// 示意
import * as metaTree from "@meta/object/executable/index.doc";

it("every executable concept has non-empty sources Record", () => {
  for (const [path, value] of walkConcepts(metaTree)) {
    expect(value.name, `${path}.name`).toBeString();
    expect(value.description, `${path}.description`).toBeString();
    expect(value.sources, `${path}.sources`).toBeObject();
    expect(Object.keys(value.sources).length, `${path}.sources keys`).toBeGreaterThan(0);
    for (const [key, mod] of Object.entries(value.sources)) {
      expect(mod, `${path}.sources.${key}`).toBeObject();  // module namespace
    }
  }
});
```

---

## Output Structure

新增文件树（仅本期实际新增 / 重构的文件）：

```
meta/object/executable/
├── concepts/                                  # 新增目录
│   ├── context-window.doc.js                  # 新增
│   ├── window-registry.doc.js                 # 新增
│   ├── window-manager.doc.js                  # 新增
│   ├── progressive-disclosure.doc.js          # 新增
│   ├── creator-window.doc.js                  # 新增
│   ├── command-exec-lifecycle.doc.js          # 新增
│   └── knowledge-activation.doc.js            # 新增
├── windows/                                   # 新增目录
│   ├── talk-window.doc.js                     # 新增
│   ├── do-window.doc.js                       # 新增
│   ├── todo-window.doc.js                     # 新增
│   ├── program-window.doc.js                  # 新增
│   ├── file-window.doc.js                     # 新增
│   └── knowledge-window.doc.js                # 新增
├── index.doc.js                               # 重写：拆出 concepts，保留 legacyIndex 兜底
├── actions/tools/{*.doc.js}                   # 修改：每个补 sources（多数已有，校验完整）
├── actions/commands/{*.doc.js}                # 同上
├── server/index.doc.js                        # 修改：补 sources
└── client/index.doc.js                        # 修改：补 sources
meta/__tests__/
└── concept-links.test.ts                      # 新增：schema 校验
```

---

## Implementation Units

### U1. concept schema + walk helper + 测试骨架

**Goal**: 先把校验机制写出来，让后续单元每完成一个就能立刻看到通过/失败

**Requirements**: origin §Goal, §Success criteria 2-3

**Dependencies**: 无

**Files**:
- `meta/__tests__/concept-links.test.ts` (new)
- `meta/__tests__/walk-concepts.ts` (new — helper：递归遍历 meta tree，识别 concept 对象 vs 聚合对象)

**Approach**:
- 定义 concept 识别规则：对象上同时有 `name: string` + `description: string` + `sources: object` 三个字段就是 concept
- `walkConcepts(root)` 递归收集所有 concept，返回 `[path, concept][]`
- 测试初版只断言 `meta/object/executable/index.doc.js` 整棵树：每个 concept 满足 schema
- 此时 executable 还没拆，测试会有 ≥1 个失败用例（顶层 executable_v 对象有 sources 但没有 name/description）— 用 `it.todo` / `it.skip` 占位，确保 U2 完成时这条断言能 flip 成 pass
- `Test expectation: 1 passing test for the helper output shape; 1 todo for "every executable concept satisfies schema" (flips to pass after U2)`

**Patterns to follow**:
- bun test 用法见 `src/executable/__tests__/tools.test.ts`
- meta import 路径用 `@meta/...` alias（已在 tsconfig）

**Test scenarios**:
- `walkConcepts` 在一个手工构造的 mini tree 上能找出 concept、忽略聚合层（happy path）
- `walkConcepts` 处理循环引用（`get parent()` getter）不死循环（edge case — 当前 meta 大量用 getter 模拟 parent 链）
- schema 断言在合法 concept 上通过、在缺字段的对象上失败（happy + error path）

**Verification**: `bun test meta/__tests__/concept-links.test.ts` 通过；helper 的单元测试 ≥3 条

---

### U2. 拆 executable/index.doc.js 顶层概念

**Goal**: 把 `executable_v20260504_1.index` 里的 6-7 个概念拆出独立 concept 文件

**Requirements**: origin §Goal, §Approach；origin §Scope 中的 context_window / progressive_disclosure / window_registry / window_manager / creator_window / command_exec_lifecycle / knowledge_activation

**Dependencies**: U1（schema 测试要在场）

**Files**:
- `meta/object/executable/concepts/context-window.doc.js` (new) — sources: `windows/types`, `windows/index`
- `meta/object/executable/concepts/window-registry.doc.js` (new) — sources: `windows/registry`
- `meta/object/executable/concepts/window-manager.doc.js` (new) — sources: `windows/manager`
- `meta/object/executable/concepts/progressive-disclosure.doc.js` (new) — sources: `executable/index`（指向 collectExecutableKnowledgeEntries）
- `meta/object/executable/concepts/creator-window.doc.js` (new) — sources: `windows/init`
- `meta/object/executable/concepts/command-exec-lifecycle.doc.js` (new) — sources: `windows/manager`
- `meta/object/executable/concepts/knowledge-activation.doc.js` (new) — sources: `thinkable/knowledge/index`, `executable/index`
- `meta/object/executable/index.doc.js` (modify) — import 上述 concepts，导出 `executable_v....concepts.{...}` 子树；旧 `index` 字段降级成 `legacyIndex` 一两行兜底说明

**Approach**:
- 把当前 `executable.index` 大段 markdown 切成 7 段，每段搬到对应 concept 的 `description`
- concept 变量名：`<concept_snake>_v20260515_1`（如 `context_window_v20260515_1`）
- 顶层 `executable_v20260504_1` 保留旧 export 名（不动版本号），里面新增 `concepts: { contextWindow, ... }` 字段
- 对原顶层 `executable_v....index` 字段：保留，但内容简化为指向 concepts 的入口提示（"具体概念见 .concepts；本字段保留只作为 legacy 入口"），同时改名 → 新增 `legacyIndex` 字段，保留 `index` 字段以保持向后兼容直至下次清理

**Patterns to follow**:
- 现有 `tools_v20260506_1` 写法（已带 `sources: { tools: toolsSource }`）
- `get parent()` getter 模式（见 `actions/tools/index.doc.js` 注释）

**Test scenarios**:
- U1 中的 todo 测试 flip 成 pass（"every executable concept satisfies schema"）
- 一个新断言：`executable_v....concepts` 至少含 7 个 key（防止后续误删）
- `bun tsc --noEmit` 干净（防止 import 路径写错）

**Verification**: `bun test meta/` + `bun tsc --noEmit` 都干净；新建 7 个文件每个 `import ... from "@src/..."` 在 tsc 下能解析

---

### U3. 拆 windows/ 各 type 的协议为独立 concept

**Goal**: 每种 window type 一个 concept 文件，sources 指向其源码

**Requirements**: origin §Scope 表格（talk_window_protocol / do / todo / program / file / knowledge / talk_delivery）

**Dependencies**: U1

**Files**:
- `meta/object/executable/windows/talk-window.doc.js` (new) — sources: `windows/talk`, `windows/talk-delivery`
- `meta/object/executable/windows/do-window.doc.js` (new) — sources: `windows/do`
- `meta/object/executable/windows/todo-window.doc.js` (new) — sources: `windows/todo`
- `meta/object/executable/windows/program-window.doc.js` (new) — sources: `windows/program`, `windows/program-runtime`
- `meta/object/executable/windows/file-window.doc.js` (new) — sources: `windows/file`
- `meta/object/executable/windows/knowledge-window.doc.js` (new) — sources: `windows/knowledge`
- `meta/object/executable/index.doc.js` (modify) — 在 `concepts: {...}` 中加 `windows: { talkWindow, doWindow, ... }` 子组

**Approach**:
- description 文本主要从源码本身的 `XXX_BASIC_KNOWLEDGE` / 注释提炼；不重写文本质量（origin §Non-goals 第 1 条）
- 每个 concept 单独 import 它对应的 src 模块，验证 import 失败立即报错
- talk-window concept 同时 import `talk.ts` 与 `talk-delivery.ts`（两者协同实现 talk 协议）

**Patterns to follow**: U2 的 concept 文件形态

**Test scenarios**:
- schema 测试覆盖新增 6 个 windows concept（自动随 walkConcepts 收集）
- 删除 `src/executable/windows/talk.ts` 后，`bun tsc --noEmit` 立刻在 `talk-window.doc.js` 报错（手工验证一次，验证后回滚）

**Verification**: `bun test meta/`、`bun tsc --noEmit` 干净；executable 树里 concepts 数量从 7 → 13

---

### U4. 校验 actions/tools/ 与 actions/commands/ 子树

**Goal**: 这些子树多数已是单概念形态，给所有 doc.js 补齐 schema 必需字段

**Requirements**: origin §Goal — schema 一致性

**Dependencies**: U1

**Files**:
- `meta/object/executable/actions/tools/{open,refine,submit,close,wait,mark,compress,index}.doc.js` (modify) — 补 `name` / 必要时补 `sources`
- `meta/object/executable/actions/commands/{open-file,open-knowledge,program,talk,todo,do,plan,end,index}.doc.js` (modify) — 同上
- `meta/object/executable/server/index.doc.js` (modify) — 补 sources
- `meta/object/executable/client/index.doc.js` (modify) — 补 sources

**Approach**:
- 现有顶层 export 大多有 `index: \`...\``（即 description 的旧名）+ 部分有 sources。需要：
  - 若有 `index` 但没 `description`：把 `index` 改名为 `description`，同时保留 `index` 为别名指向同一字符串（向后兼容）
  - 若缺 `name`：根据文件名推 PascalCase
  - 若缺 `sources`：找到对应源码 module（如 `actions/tools/refine.doc.js` → `src/executable/tools/refine`）补上
- 每个对象不改版本号（避免破坏下游 import）

**Patterns to follow**: 现有 `tools_v20260506_1` 已经是目标形态（除了字段名是 `index` 而非 `description`）

**Test scenarios**:
- schema 测试覆盖所有 actions/tools/* 与 actions/commands/* 文件；都通过
- 一个回归断言：`tools_v20260506_1.sources.tools` 仍然存在（防止误删）

**Verification**: `bun test meta/` + `bun tsc --noEmit` 干净；所有 executable 子树文件都满足 schema

---

### U5. 文档化：补 docs/solutions/conventions/ 一条短文

**Goal**: 把"meta concept = 具名 JS 对象 + sources 锁定 src module + bun test 校验"写成一条 convention，之后给其它模块复刻时直接引用

**Requirements**: origin §Open questions 间接相关；为下一轮 thinkable / web 铺路

**Dependencies**: U2, U3, U4 都完成

**Files**:
- `docs/solutions/conventions/meta-concept-graph-2026-05-15.md` (new)

**Approach**:
- 用 ce-compound 的 knowledge-track convention 模板
- 写明 concept schema、sources 命名规则、wal kConcepts 行为、何时建 concepts/ 子目录、新建模块（如 thinkable）的迁移 checklist

**Test scenarios**: 无（纯文档）。`Test expectation: none -- documentation-only convention doc`

**Verification**: 文档里给的示例代码与 U2/U3 实际产物一致

---

## Risks / Mitigations

| 风险 | 缓解 |
|---|---|
| 拆完后 `meta/index.doc.js` 等下游 import `executable_v20260504_1` 时找不到 `.index` 字段 | 顶层对象保留 `legacyIndex` 与 `index` 两个字段（同字符串），下次 plan 再删 |
| `walkConcepts` 在 `get parent()` getter 上死循环 | helper 实现时维护 visited set，按对象 identity 去重；U1 的 edge case 测试覆盖 |
| concept 识别规则误判（把聚合对象当 concept 或反之） | 规则严格用 "同时有 name + description + sources" 三件套；聚合层是 `{ description, concepts: {...} }`（无 sources），不会误中 |
| 大量新文件让 `bun test` 启动变慢 | 新增 ~13 个文件，单测一个文件遍历，可忽略 |
| 拆分时把概念文本压坏 | description 直接搬运，不重写；diff review 时用语义对照 |

---

## System-Wide Impact

- **下游 import** (`meta/index.doc.js`, 任何外部 `import { executable_v... } from "@meta/object/executable/..."` 的地方): 顶层对象 export 名不变、字段做加法 — 已有 `index` / `tools` / `commands` / `server` / `client` / `sources` 字段全保留；新增 `concepts` 字段。所以无需改任何下游
- **`bun tsc --noEmit`**: 多了 13 个新文件，但 incremental 影响很小
- **`bun test`**: 新增 1 个 test file (`meta/__tests__/concept-links.test.ts`)，新增约 5-8 个 expect 调用
- **agent context 拉取**: 未来 `executable.concepts.contextWindow` 这条路径可被精确引用，但本期不改 LLM context 构建逻辑
- **OOC 系统运行时行为**: 零影响，纯 meta 文档侧重构

---

## Open Questions Resolved

来自 origin §Open questions for /ce-plan 的四个：

1. **目录组织** → 复杂度驱动：concepts/ 用于顶层独立概念（≥3 个就建子目录），单文件单概念时平铺。已选定 `concepts/` + `windows/` 两个子目录
2. **CI 脚本位置** → `meta/__tests__/concept-links.test.ts`（用户已选）
3. **版本号格式** → 沿用 `<name>_v<YYYYMMDD>_<n>`（用户已选）
4. **sources 形状** → `Record<string, ModuleNamespace>` 命名形式（用户已选）

---

## Verification (overall)

- `bun test` 全 pass（含新增的 `meta/__tests__/concept-links.test.ts`）
- `bun tsc --noEmit` 干净（除既有的 ui/service.ts Dirent 报错）
- `meta/object/executable/` 树下：≥13 个 concept 对象；顶层 `executable_v20260504_1.concepts.contextWindow.sources.types` 路径可访问、值是 module namespace
- 手工实验：`mv src/executable/windows/talk.ts /tmp/`，运行 `bun tsc --noEmit`，立即在 `meta/object/executable/windows/talk-window.doc.js` 报 import 错；恢复
