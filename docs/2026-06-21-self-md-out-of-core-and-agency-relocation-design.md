# self.md 出 core + agency 迁 thread —— 重构设计

> 分支 `refactor/self-md-to-agent-builtin`（基线 main `fc73b4ae`）。
> 本次同时落两个独立的"不良设计调整"：**Task 1**（self.md 持久化逻辑彻底归 agent builtin、core 不再自动建 self.md）与 **Task 2**（end/todo 从 agent agency 迁回 thread）。

## 一、动机与设计权威

两处问题都来自"框架 core 承担了本属 builtin/具体维度的职责"，与对象树设计权威冲突：

1. **self.md 是 agent 实例独有**（object 模型核心 9，`object/self.md:53`）："非 agent 的 object（工具 object、class 定义）没有 self.md"。但 `createStoneObject`（`core/persistable/stone-object.ts:173-174`）给**每个** stone 写空 self.md + readable.md——过期程序。
2. **持久化逻辑可自定义，默认是 state.json**（persistable 核心 4）。self.md 是 agent class 的**自定义**持久化（`agent.md` self×persistable）。其读写实现（`core/persistable/stone-self.ts` 的 `readSelf`/`writeSelf`/`selfFile`）却长在 core，违反"core 只提供框架+API、逻辑归 builtin"（见 [[project_persistable_framework_builtin_boundary]]，thread 持久化已先行下沉）。
3. **end/todo 是 thread 作用域操作**：`method.end` 操作 `ctx.thread`、`method.todo` 在当前 thread 上下文造 todo 子对象。它们被错放进 agent 的 agency（talk/plan/todo/end）；`agent.md` 文档自身已出现 end 在 agent 与 thread 两处重复列的不一致。

**关键架构前提（已核实）**：core **可以** import builtin 的 API——这是既有祝福模式（`core/package.json` 已声明 `@ooc/builtins/*` 依赖；`core` 非测试源 18 处 import builtins；thread 持久化 API `readThread`/`writeThread` 就在 thread builtin 由 core 直接 import）。因此 self.md 读写下沉 agent builtin、core 少数合法读者 import 回来，是与 thread 一致的模式。

## 二、终态目标

self.md 的读写实现**物理归属 agent builtin**；core 自身**不再拥有** self.md 读写实现，也**不再自动创建** self.md。具体到三个原 core 消费方：

- **renderer**（渲 self 门面窗）→ 改经 registry 派发 agent persistable.load 得 `data.self`，core 不直接 readSelf。
- **HTTP 写端点 PUT `/self`**（未被任何前端使用）→ **删除**；UI 编辑身份是未来的 visible `for_ui_access` 能力（本次范围外）。
- **HTTP 读端点 GET `/self`** + **create 流程** → 从 agent builtin import readSelf/writeSelf（薄读 / 建 agent 时写），同 thread-json 模式。

## 三、落地设计

### Task 2 —— end/todo 迁 thread（executable 维度）

- `method.end.ts` + `method.todo.ts`：`builtins/agent/executable/` → `builtins/agent/children/thread/executable/`。两 method 的 `Data` 泛型 import 由 `../types.js`（agent Data `{self}`）改指 thread 的 `../types.js`（两 method 都不实际用 `self`，仅用 `ctx.thread`）。其余 import（`notifyThreadActivated`/`hasCreatorChannel`/contract）路径不变（同为 `.../executable/`）。
- `builtins/agent/executable/index.ts`：agency 收敛为 **talk / plan**（移除 endMethod/todoMethod）。
- `builtins/agent/children/thread/executable/index.ts`：`methods` 增 endMethod / todoMethod。
- **grep 收口**：`endMethod` / `todoMethod` / `method.end` / `method.todo` 全树残留引用（测试、注册点）。
- **对象树 agent.md**（push ooc-0）：`self×executable` 段 agency 改 **talk/plan**；`children/thread` 段把 end/todo 明列为 thread object method，消解 end 重复列的旧不一致。`object/self.md` 若提 agency 列表同步核。

### Task 1 / P1 —— stone-self 下沉 agent builtin（persistable 维度）

- 新建 `builtins/agent/persistable/self-md.ts`：承接 `stone-self.ts` 的 `selfFile`/`readSelf`/`writeSelf`，其依赖 `stoneDir`/`resolveBuiltinReadDir`/`StoneObjectRef` 继续 import 自 `@ooc/core/persistable`（方向同 `thread/persistable/thread-json.ts`）。
- `builtins/agent/persistable/index.ts`：`readSelf`/`writeSelf` 改 import 本地 `./self-md.js`（不再从 `@ooc/core/persistable` 取）。
- 删 `core/persistable/stone-self.ts`；删 `core/persistable/index.ts:73` 的 `export { readSelf, selfFile, writeSelf }` re-export。
- `core/persistable/stone-object.ts`：`createStoneObject` 删 `writeFile(selfFile(ref),"")` + `writeFile(readableFile(ref),"")`（你定的 self/readable 一起删）；删 `selfFile` import；`readableFile` 若仅此处用则一并删 import（`stone-readable.ts` 本身**留 core**——readable.md 是任意 object 的名片，非 agent 独有）。
- **`discoverStoneHierarchicalPeers`**（同文件）以 `self.md` 存在作 object-package marker 之一——保留（主 marker 是 package.json，非 agent 无 self.md 仍可被 package.json 命中）。

### P2 —— self 读写端点仅 import 重定向（控制面，行为保持）

**关键裁决（2026-06-21）**：原拟"删 PUT `/self`"被否——核实发现 `putSelf` 是**四个对等版本化源码编辑端点家族**（`putSelf` / `putReadable` / `putServerSource` / `putKnowledgeFile`，全经 `runVersioned`→worktree commit）之一，且 storybook 能力门 `TC-PERS-02` 在测它。单独删 self 会造成 self 被特殊对待、且打断 CI gate。本分支**不删任何端点**，只做 import 重定向：

- **GET/PUT `/self`** + **`createStone`** 的 `readSelf`/`writeSelf` 改 import 自 `@ooc/builtins/agent/persistable/self-md.js`（端点、前端、TC-PERS-02 全不动）。核心目标（self.md 读写实现归 agent builtin、core 不再拥有）**仅靠 import 重定向即完全达成**。
- 端点存废与"self.md 实现归属"正交——后者是本次重构目标，前者是 §六 的后续架构。

### P3 —— renderer 不再直接 readSelf（readable 维度）

**根因**：self 门面窗在 `init.ts:184` 注入时 `data:{}` 空，persistable.load 从不为它调用，故 renderer 只能磁盘 readSelf。

**方案 P3b（dimension-pure，已定稿）**：

1. **注入时载 data**：self 门面窗注入处（`init.ts`）经 `registry.resolvePersistable(objectId)?.load(...)`（registry 派发，**非**直接 readSelf）把 agent 的 `data.self` 填进注入实例。
2. **agent 自定义 readable module**：新建 `builtins/agent/readable/index.ts`，`readable:(ctx,self,win)=>` 渲 `self.self`（身份正文）为 self 门面窗内容；空则空窗。`builtins/agent/index.ts` 装配 readable。
3. **renderer 清理**：`xml.ts` Step2 默认投影**移除 self-view 的 readSelf 分支**（agent 现由 Step1 自定义 readable 命中）；Step2 仅留 peer-view 的 `readReadable`（通用、留 core）。删 `xml.ts` 的 `readSelf` import。
- **对象树 agent.md**：`self×readable` 段由"无自定义 readable、走默认投影"改为"**自定义 readable 渲 data.self**"。

> （备选 P3a：renderer 仍持 Step2 self-view、改用注入后的 `inst.data.self`。已弃，取 P3b 让 agent 自己拥有身份投影。）

### P4 —— create 流程只给 agent 写 self.md（persistable）

- `service.ts createStone`：仅当对象是 agent（`class === "_builtin/agent"`）时写 self.md（保留 `self`/`name→首行` 逻辑）；非 agent 不写。`writeSelf` import 自 agent builtin。
- `stone-create-object.ts`：`writeSelf`/`writeReadable` import 调整（writeSelf 自 agent builtin）；selfMd 由调用方提供的语义不变（建 agent 时才有意义）。
- **displayName 降级（已验安全）**：非 agent 无 self.md → GET `/self` 返回 `{text:""}` → 前端 `fetchSelfFirstLine` 得 null → 降级到 objectId（`objects/query.ts` 既有降级链，UI 无需改）。
- **范围外（标注）**："displayName 给所有 object 读 self.md 首行" 与核心 9 的张力（理想态非 agent 的显示名应另有来源）留作后续。

## 四、工程纪律

- **测试延后统一修**（[[feedback_refactor_defer_test_fixes]]）：源码先连贯改完跑通；大量 import `readSelf`/`writeSelf`/`selfFile` 自 `@ooc/core/persistable` 的测试会断，**只登记账本**，最后统一把 import 路径改到 `@ooc/builtins/agent/persistable/self-md.js` + 跑绿。派 sub-agent 须明确"只登记坏测试、不逐步修"。
- **验证基线**：worktree 无 node_modules，实现前先 `bun install`（注意 [[project_bun_lock_bnpm_hang]]）+ 跑现有测试取 green 基线。
- **对象树改动**：`agent.md`（+ 可能 `object/self.md` agency 列表、visible/readable self.md）经 `.ooc-world-meta/stones/main` 编辑 → commit → push ooc-0；与本仓代码同一逻辑变更。

## 五、影响文件清单（实现时核对）

**core**：`persistable/stone-self.ts`(删)、`persistable/index.ts`、`persistable/stone-object.ts`、`persistable/stone-create-object.ts`、`thinkable/context/renderers/xml.ts`、`thinkable/context/.../init.ts`(self 窗注入)、`app/server/modules/stones/service.ts`(getSelf/putSelf/createStone import 重定向)、`runtime/object-registry.ts`(resolvePersistable 若需)。
**builtins**：`agent/persistable/{self-md.ts(新),index.ts}`、`agent/readable/index.ts(新)`、`agent/index.ts`、`agent/executable/index.ts`、`agent/executable/{method.end.ts,method.todo.ts}`(移走)、`agent/children/thread/executable/{index.ts,method.end.ts(入),method.todo.ts(入)}`。
**web**：无（GET /self 保留，前端不动）。
**tests**：全部 import 上述符号自 core 的测试（账本统一修）。
**对象树**：`object/knowledge/builtins/agent.md`、`children/object/self.md`、`children/readable/self.md`、`children/visible/self.md`（按需）。

## 六、范围外（本次不做，标注为后续 spec 种子）

用户 2026-06-21 articulate 的两项独立架构，各自单独 brainstorm→spec，**不混进本行为保持分支**：

1. **通用 stone-branch-file-edit 原语（塌四端点）**：把 `putSelf`/`putReadable`/`putServerSource`/`putKnowledgeFile` 四个 typed 版本化源码编辑端点，塌成**一个 file-agnostic 的 stone 分支文件编辑端点**——"像 GitHub 网页编辑文件并创建 commit 一样、不关心编辑的是什么文件"。版本化写（worktree→commit→ff-merge）抽为这一条通用原语。
2. **class visible 改 data**：OOC class 自定义 visible = 前端编辑界面 → `callMethod` API → executable 模块注册的 `for_ui_access` method → 编辑 ooc object 的 **data**（运行时数据，**非**版本化文件写）。与 #1 正交：#1 编源文件、#2 编 data。

> 二者厘清后，原 P2 的"callMethod 版本化写 snag"消失：版本化写归 #1 通用原语、callMethod 只管 #2 改 data。

其它后续：
3. displayName 协议 vs 核心 9 的张力（非 agent 显示名来源重设计）。
4. agent-native parity：`for_ui_access` 方法的 agent 侧 tool 等价路径（visible 维度已知最大债）。
