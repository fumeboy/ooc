# builtins 模块自审方案

> 模块第一人称 · 对齐 `docs/refactor_0604/README.md` ooc-6 phase 2 总纲
> 适用范围：`packages/@ooc/builtins/*`

---

## 1. 我是谁

我是 **OOC 的内置 Object Type 集合**——把 OOC runtime 自带的 ContextObject 定义集中在一个 packages 子树，每类 Object 按自己的 type 拆成独立子目录。我直接持有 13 个子目录，其中 9 个是完整 Object（root/file/knowledge/program/todo/plan/search/skill_index/custom），2 个是无 executable 的 Agent/User-proxy（supervisor/user），1 个共享目录（_shared），1 个空遗留（command_exec）。另外 talk/do/method_exec/command_exec/relation 5 个窗口 type 留在 `@ooc/core/executable/windows/` 由 core 负责。

### 与 8 维度关系

| 维度 | 我的角色 |
|------|---------|
| **executable**（行动）| 主战场：每个 type 的 executable/ 目录注册了该 type 上所有 ObjectMethod（包括 kind="constructor" 的构造方法 + 实例 method），贡献了 OOC 默认可用 command 清单的 70%+ |
| **visible**（可见）| 每个 type 提供 `visible/index.tsx` 的 React 渲染组件（supervisor/user/其余大多数都有；custom 缺） |
| **thinkable**（思考）| 通过 **readable** hook 把 Object 渲染成 XML 片段喂给 LLM；每个 constructor/method 的 `intent()` 参与 knowledge 激活路径推导；KNOWLEDGE 常量是协议 knowledge 的主要内容来源 |
| **persistable**（持久化）| 每个 type 定义 `types.ts` 里的 Window 子接口，持久化形态就是 thread.contextWindows 中对应 type 的条目 |
| **observable**（观测）| 不直接参与；observable 通过 WindowManager 透明观测 |
| **reflectable**（反思）| 不直接参与 |
| **programmable**（编程）| supervisor/knowledge/*.md 是 supervisor stone-object 级 knowledge；其余 type 的 programmable 能力来自通用 stone-loader，不是我定义 |
| **collaborable**（协作）| talk/do 两个协作窗口由 core/executable/windows/ 持有；但我提供了 supervisor/user 两个可被 talk 指向的 Agent/User-proxy type |

我在依赖方向图里处于最下层——**只应该依赖 `_shared/types`、`_shared/utils`、`extendable/*`、`executable/*`、`persistable/*`**；反向被依赖只允许 `app/server` 和 `runtime`。

---

## 2. 我有什么（符号全景）

### 2.1 子目录清单与结构

```
packages/@ooc/builtins/
├── root/             # RootWindow：thread 根窗口，承载所有顶层 opener
│   ├── executable/   # 13 个 command.*.ts + index.ts（ROOT_METHODS + lookupConstructor side-effect import）
│   ├── visible/      # index.tsx
│   ├── readable.ts   # readable hook（空 children 占位）
│   ├── self.md       # builtin identity
│   ├── types.ts      # RootWindow extends BaseContextWindow
│   ├── index.ts      # barrel
│   └── package.json  # @ooc/builtins/root，objectId="_builtin/root", type="agent"
├── file/             # FileWindow：文件内容视图
│   ├── executable/   # index.ts（set_range/set_viewport/reload/edit/close + constructor）
│   ├── visible/      # index.tsx
│   ├── readable.ts   # viewport 切片 + 32KB 截断渲染
│   ├── self.md
│   ├── types.ts      # FileWindow（path/viewport/lines/columns）
│   ├── index.ts
│   └── package.json  # objectId="_builtin/file", type="object"
├── knowledge/        # KnowledgeWindow：knowledge 文本视图（explicit/protocol/activator）
│   ├── executable/   # index.ts（reload/close/set_viewport + constructor open_knowledge）
│   ├── visible/      # index.tsx
│   ├── readable.ts   # 按 mtime 失效缓存的全文/viewport 渲染
│   ├── self.md
│   ├── types.ts      # KnowledgeWindow（path/source/viewport）
│   ├── index.ts
│   └── package.json  # objectId="_builtin/knowledge", type="object"
├── program/          # ProgramWindow：REPL 式代码执行窗口
│   ├── executable/   # index.ts（exec/close/set_history_window + constructor program）
│   │   ├── runtime.ts        # runOneExec：shell/ts/js sandbox 调度
│   │   └── history-viewport.ts # set_history_window 的 tail/range 适配
│   ├── visible/      # index.tsx（CodeMirror）
│   ├── readable.ts
│   ├── self.md
│   ├── types.ts      # ProgramWindow（history/historyViewport）
│   ├── tsconfig.json
│   ├── index.ts
│   └── package.json  # depends @ooc/builtins/_shared
├── todo/             # TodoWindow：一步直建的可见待办
│   ├── executable/   # index.ts（constructor todo 只此一个 method；close 走通用）
│   ├── visible/      # index.tsx
│   ├── readable.ts
│   ├── self.md
│   ├── types.ts      # TodoWindow（content/onCommandPath）
│   ├── tsconfig.json
│   ├── index.ts
│   └── package.json
├── plan/             # PlanWindow：行动计划 + sub plan 嵌套
│   ├── executable/   # index.ts（update_plan/add_step/update_step/expand_step/collapse_subplan/mark_done/close + constructor plan）
│   ├── visible/      # index.tsx
│   ├── readable.ts
│   ├── self.md
│   ├── types.ts      # PlanWindow + PlanWindowStep（parentPlanWindowId/parentStepId）
│   ├── index.ts
│   └── package.json
├── search/           # SearchWindow：glob/grep 结果
│   ├── executable/   # index.ts（close/open_match + constructors glob/grep）
│   │   ├── command.set-results-window.ts  # set_results_window method
│   │   └── results-viewport.ts           # tail/range 适配（与 history-viewport 95% 同构）
│   ├── visible/      # index.tsx
│   ├── readable.ts
│   ├── self.md
│   ├── types.ts      # SearchWindow（kind/query/matches/truncated/searchRoot/resultsViewport）
│   ├── index.ts
│   └── package.json
├── skill_index/      # SkillIndexWindow：stone skills 目录的索引视图
│   ├── executable/   # index.ts（methods={}, onClose 拒绝）
│   ├── visible/      # index.tsx
│   ├── readable.ts
│   ├── self.md
│   ├── types.ts      # SkillIndexWindow（skills: SkillEntry[]）
│   ├── index.ts
│   └── package.json
├── custom/           # 占位：用户自定义 Object
│   ├── executable/   # index.ts（空 export {}）
│   ├── visible/      # 缺
│   ├── types.ts      # export {}
│   ├── index.ts
│   └── package.json
├── supervisor/       # Supervisor agent Object（没有 executable）
│   ├── knowledge/    # 5 篇 stone-level knowledge md
│   ├── visible/      # index.tsx
│   ├── readable.md   # markdown 自我介绍
│   ├── self.md
│   ├── types.ts      # SupervisorWindow extends BaseContextWindow
│   ├── index.ts      # 只 re-export types + WindowDetail
│   └── package.json  # objectId="supervisor", type="agent"
├── user/             # 真人用户的占位 Object（没有 executable）
│   ├── visible/      # index.tsx
│   ├── readable.md   # inline UI token 协议说明
│   ├── self.md
│   ├── types.ts      # UserWindow extends BaseContextWindow
│   ├── index.ts      # 只 re-export types + WindowDetail
│   └── package.json  # objectId="user", type="user-proxy"
├── _shared/          # 内置 type 间的共享（目前只有 visible）
│   ├── visible/      # utils.ts
│   └── package.json
└── command_exec/     # 遗留空目录，仅剩 node_modules/
```

### 2.2 executable/index.ts 注册的所有 method 全景

#### root（`packages/@ooc/builtins/root/executable/index.ts:51` ROOT_METHODS）

| method 名 | 所在文件 | kind | 说明 |
|-----------|---------|------|------|
| talk | command.talk.ts | thin delegator | 委托 lookupConstructor("talk")；schema={target,title} |
| do | command.do.ts | thin delegator | 委托 lookupConstructor("do")；schema={task, share_windows?} |
| program | command.program.ts | thin delegator | 委托 lookupConstructor("program")；schema={language,code} |
| plan | command.plan.ts | thin delegator | 委托 lookupConstructor("plan")；schema={plan?,title?,description?,steps?} |
| todo | command.todo.ts | thin delegator | 委托 lookupConstructor("todo")；schema={content,on_command_path?} |
| end | command.end.ts | 自实现 | 标记 thread 完成 |
| open_file | command.open-file.ts | thin delegator | 委托 lookupConstructor("file")（open_file 分支） |
| open_knowledge | command.open-knowledge.ts | thin delegator | 委托 lookupConstructor("knowledge") |
| write_file | command.write-file.ts | thin delegator | 委托 lookupConstructor("file")（write_file 分支） |
| glob | command.glob.ts | thin delegator | 委托 lookupConstructor("search")（glob 分支） |
| grep | command.grep.ts | thin delegator | 委托 lookupConstructor("search")（grep 分支） |
| metaprog | command.metaprog.ts | 自实现 | metaprog 编排（生成/修改 stone-object 代码） |
| open_feishu_chat | @ooc/core/extendable/lark | 外部注入 | |
| open_feishu_doc | @ooc/core/extendable/lark | 外部注入 | |

#### file（`packages/@ooc/builtins/file/executable/index.ts:653`）

| method 名 | kind | 说明 |
|-----------|------|------|
| set_range | 普通 | 遗留：调整 lines/columns 切片 |
| set_viewport | 普通 | 精细化 viewport 调整（推荐路径） |
| reload | 普通 | 语义提示 |
| edit | 普通 | oldString→newString 精确唯一替换；支持 atomic 多点 edit |
| close | 普通 | 释放 window |
| **file** | **constructor** | paths=["open_file","write_file"]；按 ctx.form.command 分派 |

#### knowledge（`packages/@ooc/builtins/knowledge/executable/index.ts:271`）

| method 名 | kind | 说明 |
|-----------|------|------|
| reload | 普通 | 语义提示 |
| close | 普通 | onClose hook 拒绝 protocol/activator 来源 |
| set_viewport | 普通 | 精细化 viewport 调整 |
| **open_knowledge** | **constructor** | paths=["open_knowledge"]；校验 path 在 knowledge index |

#### program（`packages/@ooc/builtins/program/executable/index.ts:374`）

| method 名 | kind | 说明 |
|-----------|------|------|
| exec | 普通 | paths=["exec","exec.shell","exec.ts","exec.js"]；跑一次 sandbox |
| close | 普通 | 释放 window + history |
| set_history_window | 普通 | 调整 exec history 视口 |
| **program** | **constructor** | paths=["program","program.shell","program.ts","program.js"]；首次 exec + ProgramWindow build |

#### todo（`packages/@ooc/builtins/todo/executable/index.ts:139`）

| method 名 | kind | 说明 |
|-----------|------|------|
| **todo** | **constructor** | paths=["todo","todo.on_command_path"]；仅构造 |

#### plan（`packages/@ooc/builtins/plan/executable/index.ts:630`）

| method 名 | kind | 说明 |
|-----------|------|------|
| update_plan | 普通 | 修改 title/description |
| add_step | 普通 | 追加 step |
| update_step | 普通 | 修改某 step 的 text/status |
| expand_step | 普通 | step → child plan_window |
| collapse_subplan | 普通 | 反向；archive sub plan |
| mark_done | 普通 | 标记 plan_window 完成 |
| close | 普通 | onClose hook 级联关闭所有 sub plan |
| **plan** | **constructor** | paths=["plan"]；接受 {plan} 或 {title?,description?,steps?} |

#### search（`packages/@ooc/builtins/search/executable/index.ts:484`，二次注册覆盖 methods）

| method 名 | kind | 说明 |
|-----------|------|------|
| close | 普通 | 释放 |
| open_match | 普通 | 在指定 match 上 spawn file_window |
| set_results_window | 普通 | 独立 command.set-results-window.ts 文件 |
| **glob** | **constructor** | searchConstructor glob 分支；Bun Glob 扫描 |
| **grep** | **constructor** | searchConstructor grep 分支；ripgrep + JS fallback |

注：search 做了 **两次 registerObjectType**（`search/executable/index.ts:279` 和 `:484`），后者覆盖前者的 methods 以注入 constructor——这是坏味道（见 §3.2）。

#### skill_index（`packages/@ooc/builtins/skill_index/executable/index.ts:44`）

methods={}（无 LLM 可调用 command；onClose 拒绝）

#### custom / supervisor / user

custom: executable/index.ts 空；supervisor/user: 无 executable 目录。

### 2.3 独立 command.*.ts 文件（13 + 1 = 14 个）

`root/executable/` 下 13 个：

1. command.talk.ts
2. command.do.ts
3. command.program.ts
4. command.plan.ts
5. command.todo.ts
6. command.end.ts（自实现）
7. command.open-file.ts
8. command.open-knowledge.ts
9. command.write-file.ts
10. command.glob.ts
11. command.grep.ts
12. command.grep.impl.ts（ripgrep + JS fallback，search constructor 也引用）
13. command.metaprog.ts（自实现）

`search/executable/` 下 1 个：

14. command.set-results-window.ts

### 2.4 Constructor 清单汇总

| constructor 名 | 所在 type | paths | 构造产物 |
|---------------|-----------|-------|---------|
| file | file | open_file / write_file | FileWindow |
| open_knowledge | knowledge | open_knowledge | KnowledgeWindow（source="explicit"） |
| program | program | program / program.shell / program.ts / program.js | ProgramWindow（含首次 exec record） |
| todo | todo | todo / todo.on_command_path | TodoWindow |
| plan | plan | plan | PlanWindow |
| glob | search | glob | SearchWindow（kind="glob"） |
| grep | search | grep | SearchWindow（kind="grep"） |

另有 3 个 constructor 不在我这里，由 `@ooc/core/executable/windows/` 提供但 root 的 thin delegator 指向它们：talk、do、method_exec。

---

## 3. 哪些不属于我 / 哪些我做得不好

### 3.1 重复代码

#### guidanceWindows() — 19 处逐字复制

完全相同的 24 行函数逐字出现在：

- `packages/@ooc/builtins/root/executable/command.talk.ts:48`
- `packages/@ooc/builtins/root/executable/command.do.ts`
- `packages/@ooc/builtins/root/executable/command.program.ts`
- `packages/@ooc/builtins/root/executable/command.plan.ts`
- `packages/@ooc/builtins/root/executable/command.todo.ts`
- `packages/@ooc/builtins/root/executable/command.open-file.ts`
- `packages/@ooc/builtins/root/executable/command.open-knowledge.ts`
- `packages/@ooc/builtins/root/executable/command.write-file.ts`
- `packages/@ooc/builtins/root/executable/command.glob.ts`
- `packages/@ooc/builtins/root/executable/command.grep.ts`
- `packages/@ooc/builtins/file/executable/index.ts:49`
- `packages/@ooc/builtins/knowledge/executable/index.ts:43`
- `packages/@ooc/builtins/program/executable/index.ts:39`
- `packages/@ooc/builtins/todo/executable/index.ts:27`
- `packages/@ooc/builtins/plan/executable/index.ts:40`
- `packages/@ooc/builtins/search/executable/index.ts:49`
- （另 3 处在 command.end.ts / command.metaprog.ts / command.set-results-window.ts）

#### onFormChange 骨架 — 38 处同构

几乎每个 method 的 onFormChange 都是：

```
onFormChange(change, { form }) {
  if (change.kind === "status_changed" && change.to !== "open") return [];
  const args = change.kind === "args_refined" ? change.args : form.accumulatedArgs;
  const formStatus = form.status;
  const entries = { [BASIC_PATH]: BASIC_KNOWLEDGE };
  // 1-2 行特化：检查缺参，塞 INPUT 提示
  return guidanceWindows(form, entries);
}
```

38 处分布在 13 个 root command.*.ts + file(5) + knowledge(3) + program(3) + todo(1) + plan(7) + search(3) 的 method 定义中。

#### root thin delegator — 10 处同构

```
const ctor = (ctx.manager?.registry ?? builtinRegistry).lookupConstructor("<type>");
if (!ctor) return "[<name>] ... constructor 未注册";
return await ctor.exec(ctx);
```

| 文件 | 行号 |
|------|------|
| root/executable/command.talk.ts | :116 |
| root/executable/command.do.ts | :119 |
| root/executable/command.program.ts | :160 |
| root/executable/command.plan.ts | :127 |
| root/executable/command.todo.ts | :115 |
| root/executable/command.open-file.ts | :104 |
| root/executable/command.open-knowledge.ts | :99 |
| root/executable/command.write-file.ts | :143 |
| root/executable/command.glob.ts | :110 |
| root/executable/command.grep.ts | :88 |

#### isString / basenameOfPath / emptyIntent = () => [] — 40+ 处

- `isString(v)` 定义在 file/executable/index.ts:299、plan/executable/index.ts:149，其余大量 inline `typeof x === "string"`
- `basenameOfPath(p)` 定义在 file/executable/index.ts:294、knowledge/executable/index.ts:190、search/executable/index.ts:168（命名为 `basename`）
- `intent: () => []` 出现在至少 25 个 method 定义中

#### history-viewport.ts vs results-viewport.ts — 95% 同构

| 文件 | 行数 | 差异点 |
|------|------|--------|
| program/executable/history-viewport.ts | 90 行 | 前缀 `history_` / 默认 tail=10 / 字段 `historyViewport` / 错误前缀 `[program_window.set_history_window]` |
| search/executable/results-viewport.ts | 87 行 | 前缀 `matches_` / 默认 tail=50 / 字段 `resultsViewport` / 错误前缀 `[search_window.set_results_window]` |

算法完全共用 `mergeTranscriptViewport`。

#### search 两次 registerObjectType — search/executable/index.ts:279 vs :484

依赖 merge 语义；应该一次注册完成。

### 3.2 命名债务

- **13+1 个 command.*.ts**：术语已统一为 "method"（ObjectMethod），文件名仍叫 command.*.ts，与 core 侧 `method_exec/` 术语不一致。
- **command_exec/ 空遗留目录**：只剩 node_modules，历史 type 已迁到 core。
- **form.command 字段 26 处引用**：应改称 form.method（总纲批次 D2）。
- **command-types.ts**：@ooc/core/extendable/_shared/command-types.ts 定义 ObjectMethod 等，但文件名仍叫 command-types。
- **注释残留**：大量 "Step 2 重构"、"2026-06-02 P6" 等历史叙事作为头部注释。

### 3.3 耦合

- **21 处 Intent/MethodCallSchema 来自 thinkable**：`import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js"` 出现在 root 所有 command.*.ts + 各 type executable/index.ts。按依赖方向 thinkable 应在 builtins 上层。
- **8+ 处 xmlElement/xmlText 来自 thinkable**：`import { xmlElement, xmlText, type XmlNode } from "@ooc/core/thinkable/context/xml.js"` 在所有 readable.ts + 3 个 compressView 实现里。XML 是跨模块纯函数。
- **knowledge runtime import loadKnowledgeIndex**：knowledge/executable/index.ts:37 直接 `import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js"`——builtins 依赖 thinkable runtime 实现。
- **search runtime import grep.impl**：search/executable/index.ts:46 从 `@ooc/builtins/root/executable/command.grep.impl.js` import——builtins 子目录互相反向依赖。

---

## 4. 理想的我

### 4.1 目录结构（总纲 §3.3 对齐）

```
builtins/
├── _shared/
│   ├── executable/                # NEW — 消 §3.1 所有重复
│   │   ├── guidance.ts            # guidanceWindows() + makeBasicFormHandler() 工厂
│   │   ├── delegator.ts           # makeRootDelegator(typeName, paths?, schema?)
│   │   ├── viewport-adapter.ts    # makePrefixedViewport(prefix, defaultTail, fieldName)
│   │   ├── utils.ts               # isString / basenameOfPath / emptyIntent
│   │   └── grep-impl.ts           # 从 root/executable/command.grep.impl.ts 迁出
│   └── visible/utils.ts           # 已有
├── root/executable/
│   ├── method.talk.ts             # ← command.talk.ts 改名
│   ├── method.do.ts
│   ├── method.program.ts
│   ├── method.plan.ts
│   ├── method.todo.ts
│   ├── method.end.ts              # 自实现，保留
│   ├── method.open-file.ts
│   ├── method.open-knowledge.ts
│   ├── method.write-file.ts
│   ├── method.glob.ts
│   ├── method.grep.ts
│   ├── method.metaprog.ts         # 自实现，保留
│   └── index.ts
├── search/executable/
│   ├── method.set-results-window.ts  # 改名；合并 2 次 registerObjectType 为 1 次
│   └── index.ts
├── program/executable/history-viewport.ts   # → 改用 viewport-adapter 工厂
├── search/executable/results-viewport.ts    # → 改用 viewport-adapter 工厂
└── (删除 command_exec/ 目录)
```

### 4.2 对外 API 面

1. **type barrel**：每个子目录 index.ts re-export 自己的 types.ts + WindowDetail
2. **side-effect registration**：`import "@ooc/builtins/<type>"` 触发 builtinRegistry.registerObjectType
3. **少量 runtime helper**：runOneExec / executeProgramWindowExec / executeSearchOpenMatch 等被测试引用

不对外暴露 internal helper（guidance/delegator/viewport 等只在 builtins 子树内部共享）。

### 4.3 依赖边界

只允许依赖：`@ooc/core/_shared/*`、`@ooc/core/extendable/*`、`@ooc/core/executable/*`、`@ooc/core/persistable/*`。
禁止直接依赖 `@ooc/core/thinkable/**`（C 批次完成后）。

---

## 5. 我的优化方案

### 批次 A（死代码删除，对齐总纲）

| # | 行动 | 影响 |
|---|------|------|
| A5 | 删除 `builtins/command_exec/` 空遗留目录 | 1 目录 |

### 批次 B（重复代码抽取 + 命名统一，我的主战场）

| # | 行动 | 影响文件 |
|---|------|---------|
| B1 | 新建 `_shared/executable/guidance.ts`：guidanceWindows() + makeBasicFormHandler() 工厂；替换 19+38 处 | +1；改 15+ |
| B2 | 新建 `_shared/executable/utils.ts`：isString / basenameOfPath / emptyIntent；替换 40+ 处 | +1；改 10+ |
| B3 | 新建 `_shared/executable/delegator.ts`：makeRootDelegator() 工厂；替换 10 处 root thin delegator | +1；改 10 |
| B4 | 新建 `_shared/executable/viewport-adapter.ts`：makePrefixedViewport()；合并 history/results-viewport 95% 同构 | +1；改 2 |
| B4.1 | 修复 search 两次 registerObjectType 为一次 | 1 文件 |
| B4.2 | grep impl 抽共享：root/command.grep.impl.ts → `_shared/executable/grep-impl.ts` | +1；改 2 import |
| B5 | root/executable/command.*.ts（13 个）→ method.*.ts 改名 | 13 文件改名 + import 更新 |
| B6 | search/executable/command.set-results-window.ts → method.set-results-window.ts | 1 文件改名 |
| B7 | extendable/_shared/command-types.ts → method-types.ts（配合 executable 子方案） | builtins 改 ~15 处 import |

### 批次 C（中立共享类型，配合 shared-types 子方案）

| # | 行动 | 我要做的 |
|---|------|---------|
| C2-C7 | Intent/MethodCallSchema/XmlNode/xml helpers/ObjectMethod 迁到 _shared | builtins 所有相关 import 改路径；builtins 下 grep `from.*thinkable.*intent\|xml` = 0 |
| C6.1 | knowledge constructor 的 loadKnowledgeIndex 改走窄接口 | knowledge/executable/index.ts 改 import |

### 批次 D（命名统一，配合 executable 子方案）

| # | 行动 | 我要做的 |
|---|------|---------|
| D2 | form.command → form.method | builtins 26 处 ctx.form?.command 改名；file/search constructor 分派字符串更新 |

---

## 6. 我对其他模块的要求

### 对 shared-types 子方案

1. **C2-C3-C6-C7 必须先于我的 B1-B4**：否则我抽取 helper 时仍要从 thinkable import，抽完还得再改路径。
2. **xmlElement/xmlText 的归属**：请确定落在 `_shared/types/` 还是 `_shared/utils/`，我好定 import 路径。
3. **MethodExecutionContext.registry 稳定性**：目前我写 `(ctx.manager?.registry ?? builtinRegistry).lookupConstructor(...)` 带 fallback。如能保证 registry 永不为 undefined 或提供全局 helper，我的 delegator 可简化。

### 对 executable 子方案

1. **B7 命名（command-types → method-types）请先于我的 B5/B6**：否则我文件改名叫 method.* 但 import 还叫 command-types，违和。
2. **D2 form.command → form.method**：请在 form 读取时负责 backward-compat shim（`"command" in form ? form.command : form.method`）；我只改代码引用，不负责数据迁移。
3. **talk/do constructor 的归属确认**：目前在 core/executable/windows/{talk,do}/。如果未来计划迁到 builtins，请告知时间点以便我的 delegator 抽取时考虑。

### 对 thinkable 子方案

1. **loadKnowledgeIndex 窄接口**：请暴露仅做 "检查 path 是否在索引中" 的窄 API（或通过 persistable 暴露），让我切断对 thinkable 的 runtime 依赖。
2. **FormStatus 枚举**：若已抽成 enum 并放到 _shared/types，我的 makeBasicFormHandler 工厂可直接用类型而非硬编码字符串。

### 对 persistable 子方案

1. **versionedStoneWrite 签名稳定**：file/executable/index.ts 深度依赖。若重构请保持 backward compat 至少一版。
2. **knowledgePathExists(thread, path): boolean**：如能提供，我可替换 knowledge/executable 的 thinkable import。

---

## 附录：批次交叉依赖图

```
批次 A5（删 command_exec/）       —— 零依赖，随时可做
           │
           ▼
批次 C2-C3-C6-C7（中立类型建立）   ←── 对 shared-types 的硬要求
           │
           ▼
批次 B1-B4（重复代码抽取）         ←── 我核心工作，依赖 C 路径稳定
           │
    ┌──────┴──────┐
    ▼             ▼
批次 B5-B6     批次 B7（command-types 改名，executable 主责）
（文件改名）        │
    └──────┬──────┘
           ▼
批次 D2（form.command → form.method，executable 主责）
           │
           ▼
批次 C6.1（knowledge 窄接口，thinkable 主责）
```
