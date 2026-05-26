# Object Custom Window + Commands 升级 plan

> **状态**：drafting，决策已拍板（§4）
> **维度归属**：主在 `programmable`，外溢到 `executable.context_window` / `executable.commands` / `executable.commands.program`
> **一句话**：把 Object 自定义的"私有函数库"（`llm_methods`）升级为 Object 自定义的 ContextWindow + 挂在它上面的 commands；`server/index.ts` 的 LLM 侧导出从 `llm_methods` 字典改为 `export const window = { ... }`（type=`"custom"`）。`ui_methods` 保持不动。`program.function` 重命名为 `program.callCommand`，参数 `function` 改为 `window_id + command`，使其可调任意 window 上的任意 command；ts/js 脚本里 `self.callMethod` 同步重命名为 `self.callCommand`，签名扩成 `(windowId, command, args?)`。**旧 `llm_methods` 一次性硬切**，由人手工改写仓内 stone，不留 shim。

---

## 1. 动机：为什么不止是改名

当前 `llm_methods` 实质是一种"二等公民"的 LLM 入口：

- LLM 看不见 method 本身，只能通过 root 的 `program.function` command 间接调；method 没有自己的 form 生命周期，没有自己的窗口实体，没有 path 激活，没有 `formStatus` 感知。
- 这与 OOC 的 executable 哲学不一致：LLM 的"行动对象"统一为 `ContextWindow`，行动单元统一为挂在 window 上的 `command`，但 Object 自定义的方法被排除在这个统一抽象之外，靠 `program.function` 这一条胶水路径接进来。
- 结果是 Object 想给自己写一个"长期持有状态、可被 LLM 多步操作"的能力时，要么挤进 `program_window`（每次 exec 后形态被冲掉），要么伪装成无状态 method（丢掉 form/path/knowledge 这些 OOC 自己最有价值的机制）。

**升级后的语义**：

- Object 在 `stones/<self>/server/index.ts` 里 `export const window = { ... }`，定义自己的 ContextWindow 形态（renderXml / basicKnowledge / commands / onClose），其中 `commands` 是头等的 `CommandTableEntry`（paths / match / knowledge / exec）。
- 该 window 类型为 **`"custom"`**（registry 中固定一种 type，运行时按 `window.objectId` 路由到具体 Object 的 `window` 定义）；thread 启动时（仅当 `thread.objectId === self`）由 `initContextWindows` 注入**单例**。
- LLM 通过 `open(parent_window_id=<customWindowId>, command="<name>", ...)` 直接调用 Object 自己的命令，与调 `do.continue` / `talk.continue` 完全同构。
- "Object 给自己写方法"和"Object 给自己写界面 / 给 do_window 加新行动"在概念上汇成一件事：**给 ContextWindow 写 commands**。

`program.callCommand`（原 `program.function`）从"只能调 self 的 llm_methods"升格为"调任意 window 上任意 command 的通用元操作通道"——既保留了 LLM 在 ts/js 脚本里编排多个调用的能力，又把"调 commands"这件事统一到 `(window_id, command, args)` 这一个签名上。

---

## 2. 边界：本 plan **不**做的事

1. 不动 `do_window` / `talk_window` / `file_window` 等内置 window 的 commands 表（它们仍由 `windows/<type>.ts` 注入）。
2. 不引入"Object 可以注册多个自定义 window 类型"——本轮 `export const window` 是单数，每个 Object 只定义一个 custom window。多 window 形态是后续演化（见 §10）。
3. 不引入 sandbox / 权限隔离；Object 的 commands `exec` 仍直接 `await import` 加载并 in-process 执行（与现状一致）。
4. 不动 visible 维度：`stones/<self>/client/index.tsx` 契约不变，`ui_methods` 字典完全保持原样、原路径、原 loader 行为。
5. **不写自动迁移脚本**：仓内现有 `llm_methods` 由人手工重写为 `export const window`；loader 不保留 shim；旧名字一次性下线（详见 §7 一次性硬切清单）。
6. 不动 `program` command 的"打开 form → refine → submit"主框架；只改它的子模式表（`function` → `callCommand`）。

---

## 3. 既有约束（不能破坏）

1. **`object.doc.ts` 上 executable.context_window 的统一抽象**：所有 ContextWindow 至少有 `id / type / title / status / parentWindowId / createdAt`，render / commands / onClose / basicKnowledge 由 `WindowRegistry` 注册。新 custom window 必须落在这个抽象内，不开新维度。
2. **`WindowRegistry` 的注册原则**：同一 type 的所有 window 实例共享同一份契约（无实例 override）。本 plan 通过"type=`custom` 的契约本身就是 dispatcher"绕过这个限制——契约是同一份，行为按 `window.objectId` 路由，仍然遵守"实例不 override 契约"的字面规定。
3. **loader 缓存契约**：`server/index.ts` 按 mtime 失效 + `?t=mtime` query string 重新 import；新 loader 必须保留这条热更路径。
4. **`initContextWindows` 幂等**：thread 反序列化和创建时都会跑，custom window 注入必须 id 稳定 + 重复跳过。
5. **`stones/<self>/server/index.ts` 的物理位置不动**：仍是 stone 级方法/窗口源，session 间共享。
6. **错误协议不动**：UI HTTP 路径 (`flows/stones.callMethod`) 的 `METHOD_LOAD_FAILED` / `METHOD_NOT_FOUND` 名称稳定（这条路径只服务 `ui_methods`，本 plan 不动）。
7. **`meta/object.doc.ts` 文档结构 + 锚点规范**：每个被改写的概念节点必须保持 `[[any, string]]` 单 source、断言锚定真实代码行（CLAUDE.md §关键约束 2、3）。

---

## 4. 已拍板的决策（取代原"开放问题"）

| # | 决策 |
|---|------|
| D1 | **type 取 `"custom"`**：WindowRegistry 注册固定 type=`custom`，其 commands / renderXml / basicKnowledge / onClose 全部是 dispatcher，运行时按 `window.objectId` 解析到该 Object 的 `ObjectWindowDefinition`。 |
| D2 | **实例化时机**：仅当 `thread.objectId === self`（即当前 thread 由该 Object 自己持有）时，由 `initContextWindows` 注入单例 custom window。其他 thread（caller object thread / super thread 等）不注入；它们若需要与本 Object 互动，仍走 `talk_window` 等既有协议。 |
| D3 | **`ui_methods` 不动**：`server/index.ts` 仍可继续 `export const ui_methods = {...}`；loader 仍照常解析、HTTP `callMethod` 仍照常工作。本 plan 与 visible 维度完全解耦。 |
| D4 | **`program.function` → `program.callCommand`**：<br>① 子模式 key 改名 `function` → `callCommand`；<br>② 必填参数 `function` → `window_id + command`，可选 `args` 不变；<br>③ ts/js sandbox 注入的 `self.callMethod(name, args)` 同步改名 `self.callCommand(windowId, command, args?)`，签名扩展；<br>④ 语义上不再绑定到 self window —— `callCommand` 可以调任意 thread.contextWindows 中存在的 window 上的任意已注册 command（do/talk/file/custom 都可以）；form 模式同理。 |
| D5 | **commands `exec` ctx 形态**：与现有 `CommandExecutionContext`（`thread / form / parentWindow / manager / args`）完全一致 + 额外注入 `self: ProgramSelf`，即 custom window 的命令 exec 同时拥有 manager 操作能力 + Object 自身 data/threadLocal 读写能力。 |
| D6 | **硬切，不留 shim**：loader 删除 `llm_methods` 解析逻辑；`loadLlmServerMethods` / `LlmMethods` / `ServerMethod` 等旧符号一次性删除（`ui_methods` 相关符号保留）。仓内现有 `stones/*/server/index.ts` 由人手工重写为新形态，作为同一 PR 的一部分。 |

---

## 5. 概念形状

### 5.1 `server/index.ts` 新形状

```ts
import type { ObjectWindowDefinition } from "ooc/executable/server";

export const window: ObjectWindowDefinition = {
  // ── window 自身 ──────────────────────
  title: "factor_workshop",                 // 出现在 context 时给 LLM 看的标题
  description: "因子开发工作台",              // 一行说明，进 basicKnowledge

  /** 出现在 thread.contextWindows 时如何渲染（同 WindowRegistry.renderXml 的契约） */
  renderXml: (ctx) => { /* ctx.window / ctx.thread */ },

  /** 该 window 出现时合成的协议知识（与 windows/registry.ts basicKnowledge 同语义） */
  basicKnowledge: ({ self }) => `... 你是 factor_workshop, 暴露以下命令: ...`,

  /** 关闭 hook；缺省 = 直接从 contextWindows 移除 */
  onClose: (ctx) => true,

  // ── 命令表（CommandTableEntry 头等公民） ─
  commands: {
    create_factor: {
      paths: ["create_factor", "create_factor.draft", "create_factor.publish"],
      match: (args) => { /* 同 CommandTableEntry.match */ },
      knowledge: (args, formStatus) => ({ /* 同 CommandTableEntry.knowledge */ }),
      exec: async (ctx) => {
        // ctx: CommandExecutionContext & { self: ProgramSelf }
        const data = await ctx.self.getData("factors");
        // ... 业务逻辑 ...
        return { ok: true, result: "..." };
      },
    },
    // 更多 command ...
  },
};

// visible 维度入口字典，本 plan 完全保持原样
export const ui_methods = { /* 同现状 */ };
```

### 5.2 `ContextWindow` 类型扩展

```ts
// src/executable/windows/types.ts
export type WindowType = "root" | "command_exec" | "do" | "talk" | ... | "custom";

export interface CustomWindow extends BaseContextWindow {
  type: "custom";
  objectId: string;     // 用来 dispatch 到 stones/<objectId>/server/index.ts
  // title 由 ObjectWindowDefinition.title 在 init 时拷过来；status 复用通用枚举
}
```

### 5.3 与 `WindowRegistry` 的拼接

- `src/executable/windows/custom.ts`（新文件）：通过 `registerWindowType("custom", { commands, renderXml, onClose, basicKnowledge })` 注册一份 dispatcher 契约。每个 hook 的实现都是：
  1. 拿 `ctx.window` 上的 `objectId`；
  2. `loadObjectWindow(stoneRef)` 拿到 `ObjectWindowDefinition`；
  3. 转发到对应字段（commands 在 dispatcher 层把 `self: ProgramSelf` 注入到 exec ctx）。
- `getWindowTypeDefinition` 签名不变（仍只接 type）；type=custom 的 dispatcher 自己在调用瞬间从 window 取 objectId 即可（dispatcher 持有当前调用的 window 引用——具体由 manager 把 window 传给 dispatcher，下面 §6.2 有细节）。

> **注**：之前草稿提过"扩 `getWindowTypeDefinition` 签名"，因为决策 D1 我们是把 dispatcher 写在 type=custom 的契约里，所以签名其实**不需要扩**——dispatcher 在被调用时已经能从入参（CommandExecutionContext / RenderContext / OnCloseContext，都带 `window`）拿到 objectId。这是本轮一个重要简化。

### 5.4 LLM 调用路径（升级后的两条）

**主路径**（与内置 window 同构）：
```
open(parent_window_id=<customWindowId>, command="create_factor", args={...})
refine(...)
submit(...)
```

**通用 callCommand 路径**（原 program.function 重命名 + 通用化）：
```
open(command="program", args={ mode: "callCommand", window_id: <anyWindowId>, command: "create_factor", args: {...} })
```
不仅可调 custom window 的 command，也可调 do_window 的 `continue`、talk_window 的 `continue` 等任意 window 上已注册的 command。这把 program 的"function 调用"模式从"绑定 self window"升格为"绑定任意 window"。

ts/js exec 模式：
```ts
// 旧：const result = await self.callMethod("create_factor", { ... });
// 新：
const result = await self.callCommand(windowId, "create_factor", { ... });
```

### 5.5 `ProgramSelf` 重塑

```ts
export interface ProgramSelf {
  dir: string;
  callCommand: (windowId: string, command: string, args?: Record<string, unknown>) => Promise<unknown>;
  getData: (key: string) => Promise<unknown>;
  setData: (key: string, value: unknown) => Promise<void>;
  getThreadLocal: (key: string) => unknown;
  setThreadLocal: (key: string, value: unknown) => void;
}
```

- `callMethod` 删除，改名 `callCommand`；签名扩成 `(windowId, command, args?)`。
- 实现：在当前 thread.contextWindows 里找到 `windowId` → 通过 manager 走 form 化路径执行该 command，或者走"裸 exec"路径直接调用注册表中的 entry.exec —— **本 plan 取后者**（与现状 `runFunctionProgram` 的"绕过 form 直调"语义对齐），但 ctx 仍然把 thread/manager 传齐，让 exec 可以创建子 window。
- 找不到 windowId 或 command 时抛 `windowId X 上不存在 command Y；当前可用：...`。

---

## 6. 落地步骤（按依赖顺序）

> 每完成一步立刻 `bun tsc --noEmit` 验证（CLAUDE.md §关键约束 2）。每改一份 `meta/*.doc.ts` 立刻验证当前文件，不要批量验证（[Doc work verify each link](memory)）。

### 6.1 类型 & loader 层（最底层）

1. 新增 `src/executable/server/window-types.ts`：定义 `ObjectWindowDefinition`（§5.1 形状）+ `CustomCommandContext = CommandExecutionContext & { self: ProgramSelf }`。
2. 改 `src/executable/server/types.ts`：
   - **删** `LlmMethods` / `ServerMethod` / `ServerMethodContext`（含 `inject` / `persistence` 字段如果只服务 llm_methods 路径）；
   - **保留** `UiMethods`（`ui_methods` 仍在用）；
   - `ProgramSelf` 按 §5.5 改：`callMethod` → `callCommand`。
3. 改 `src/executable/server/loader.ts`：
   - 解析 `mod.window`（`ObjectWindowDefinition`）+ `mod.ui_methods`；
   - **不再读 `mod.llm_methods`**；如果发现 `mod.llm_methods` 存在 → 抛清晰报错 `llm_methods is no longer supported; migrate to "export const window"`，避免静默吃掉。
   - 缓存 entry 形状改为 `{ window, uiMethods }`；导出 `loadObjectWindow(stoneRef)`、`loadUiServerMethods(stoneRef)`（保留）。
   - **删** `loadLlmServerMethods` / `loadServerMethods` 别名。
4. 改 `src/executable/server/self.ts`：`createProgramSelf` 实现里 `callCommand` 走 §5.5 的"按 windowId 在 thread.contextWindows 找 window → 取 type 注册的 commands → exec(ctx)"。注入 `self` 到 ctx。
5. 改 `src/executable/server/enrich.ts`（如存在 method-knowledge 派生逻辑）：从"按 llm_methods 派生"改为"按 ObjectWindowDefinition.commands 派生"。
6. 测试：
   - 改 `src/executable/__tests__/server-loader.test.ts`：用 `export const window` 替换 `export const llm_methods`，新增"`llm_methods` 存在时抛错"用例。
   - 改 `server-self.test.ts`：`callMethod` → `callCommand` 用例升级。
   - 改 `server-enrich.test.ts`：knowledge 派生新形态用例。

### 6.2 ContextWindow 抽象层

7. `src/executable/windows/types.ts`：
   - `WindowType` 联合增加 `"custom"`；
   - 新增 `CustomWindow` 接口（type=custom + objectId）。
8. `src/executable/windows/registry.ts`：
   - REGISTRY 增加 `"custom"` 占位条目（commands: {}）；
   - 不改 `getWindowTypeDefinition` 签名（见 §5.3 注）；不改 `WindowTypeDefinition` 形状。
9. 新建 `src/executable/windows/custom.ts`：
   - 在模块加载时 `registerWindowType("custom", { commands: <dispatcher>, renderXml: <dispatcher>, onClose: <dispatcher>, basicKnowledge: <dispatcher 字符串生成器> })`；
   - dispatcher 内部统一通过 `loadObjectWindow({ baseDir, objectId: ctx.window.objectId })` 拿到 `ObjectWindowDefinition`；commands dispatcher 还要给每条 entry.exec 包一层"在 ctx 里塞 self"。
10. `src/executable/windows/manager.ts`：
    - 在 `submit` 路径中 type=custom 时，把 self 注入到 exec ctx——更干净的实现是放在 §6.2-9 的 dispatcher 包装里，**manager 不感知 custom**。
    - 对 `WindowManager.findWindow(id)` 之类查询函数确认 type=custom 不需要特殊处理（只是多一种 type）。
11. `src/executable/windows/index.ts`：把 `./custom` 加到 side-effect import 列表，确保模块加载时注册。

### 6.3 thread 注入 custom window

12. `src/executable/windows/init.ts`（`initContextWindows`）：
    - thread.objectId 已知时，幂等插入一个 `CustomWindow`，id = `custom:<objectId>`，parentWindowId = root window id；
    - **仅当 `thread.objectId === thread.ownerObjectId`**（D2：表示这个 thread 由该 Object 自己持有）—— 实际代码里这等价于 thread 自身的归属 object 就是 self；caller fork 的 do thread / super thread 不注入。
    - 注入位置：在 root window 之后、creator window 之前/之后均可，建议紧跟 root，让"本 Object 的自我门面"在 LLM 视野中位置稳定。
13. `src/executable/windows/__tests__/init.test.ts` 新增 case：注入幂等 + 仅 self thread 注入。

### 6.4 重命名 program.function → program.callCommand

14. `src/executable/program/function.ts`：
    - 文件改名 `function.ts` → `call-command.ts`；导出 `runCallCommandProgram(thread, windowId, command, args)`；
    - 实现：找到 windowId 对应的 window → 通过 registry 取 `commands[command]` → 构造 `CommandExecutionContext`（type=custom 时由 dispatcher 包 self；其他 type 直走）→ `await entry.exec(ctx)` → `formatProgramResult` 包装。
15. `src/executable/program/types.ts` 与 program form schema：
    - `mode: "function"` → `mode: "callCommand"`；
    - 必填参数 `function` → `window_id + command`；可选 `args` 不变；
    - knowledge 文案随之改写（解释"调任意 window 上的任意 command"）。
16. `src/executable/program/sandbox/`：ts/js exec 注入的 `self` 字段：删 `callMethod`，加 `callCommand(windowId, command, args?)`。
17. `src/executable/__tests__/program.test.ts`：所有 `function` 模式用例改名 `callCommand`，参数升级。
18. **grep 兜底**：全仓 `grep -rn "callMethod\b\|llm_methods\b\|program\.function\b\|loadLlmServerMethods\b\|ServerMethod\b\|LlmMethods\b"`，每一处都要么删除要么按新名字改写；不留兼容别名。

### 6.5 仓内 stone 手工重写（D6）

19. 全仓 `grep -rn "export const llm_methods" stones/ .ooc-world*/ tests/` 列出所有现有 stone 文件；
20. 逐个把 `export const llm_methods = {...}` 重写为 `export const window: ObjectWindowDefinition = { title, description, commands: {...} }`：
    - 每条 method 包成 CommandTableEntry：`{ paths: [name], match: () => [name], knowledge: <从原 method.knowledge 或 description+params 拼>, exec: ctx => fn({ self: ctx.self, thread: { id: ctx.thread.id } }, ctx.args) }`；
    - 注意：原 `ServerMethodContext.thread.inject` 这条主动注入入口在新 ctx 里通过 `ctx.manager.injectKnowledgeWindow` 等价获得；如有 method 用了 inject，要在重写时手工接通。
21. `tests/e2e/` 与单元测试 fixture 中的 stone 字面量同步重写。

### 6.6 文档与 basic-knowledge

22. 改 `src/thinkable/knowledge/basic-knowledge.ts:115-254`：
    - "`llm_methods[name] = ...`"段全部换成"`export const window.commands[name] = ...`"；
    - "调你自己 server 的 `ui_methods`(注意是 ui_methods, 不是 llm_methods)" 这段：把括号里的对照说明改为"注意是 `ui_methods`，不是给 LLM 的 `window.commands`"；
    - 增加 `program.callCommand` 的协议说明、`self.callCommand(windowId, command, args)` 的脚本用法。
23. 改 `meta/object.doc.ts`：
    - **`programmable` 节点**：
      - title/content 改写："Object 持有/演化自身**自定义 ContextWindow + 命令表**的能力"；
      - children：`server_method_library` → `object_window_definition`（新形状）；`llm_invocation_paths` → `custom_window_invocation`（双路径：直接 open + program.callCommand）；`method_evolution` → `window_evolution`；
      - patches：`llm_vs_ui_methods` 改为 `custom_window_vs_ui_methods`；
      - named/sources 全部对齐新代码行号；
    - **`executable.context_window.window_types`**：增加 `"custom"` 条目；children 加 `custom_window` 节点；
    - **`executable.commands.commands`** 末尾加一段"Object 自定义 commands 通过 custom window 注册"的提示，并把 `program.function` 改为 `program.callCommand`；
    - 每改一节立刻 `bun tsc --noEmit meta/object.doc.ts`。
24. 检查 `meta/case.factor-dev.doc.ts` / `meta/cookbook.add-new-agent.doc.ts` 是否提到 `llm_methods`（grep）；提到则改写。

### 6.7 e2e + dogfood

25. 选 `tests/e2e/` 里现有最小 program.function 链路 → 升级为 `program.callCommand`，session 用 `_test_custom_window_<ts>` 前缀，验证后清 `.ooc-world/flows/`。
26. 新增一个最小 e2e：Object 自己 thread 里通过 `open(parent=customWindowId, command=...)` 走完一条命令。

---

## 7. 一次性硬切清单（D6 落地清单）

PR 提交前确认以下符号在仓内**一处都不剩**（grep 必须返回空，除了 doc 中的"历史变更说明"段落）：

- `llm_methods`（导出名 + 类型名 + 引用）
- `LlmMethods`（类型）
- `ServerMethod`、`ServerMethodContext`（类型；如果 `ui_methods` 路径还要复用其中字段，重命名为 `UiServerMethod` / `UiServerMethodContext`，**不留 alias**）
- `loadLlmServerMethods` / `loadServerMethods`（loader 函数）
- `program.function` / `runFunctionProgram`（program 子模式与入口）
- `self.callMethod`（ProgramSelf 字段）

PR 提交前确认以下新符号已就位：

- `ObjectWindowDefinition`、`CustomWindow`、`CustomCommandContext`
- `loadObjectWindow`
- `program.callCommand` / `runCallCommandProgram`
- `self.callCommand`
- WindowType 联合多了 `"custom"`，registry 已 `registerWindowType("custom", ...)`

---

## 8. 风险

1. **dispatcher 在 manager 里的接入点是否干净**：custom window 的 commands 来自动态加载，manager `submit` 现在的逻辑是"取 entry → exec"，要改成"取 entry（dispatcher 已经把 self 包好）→ exec"；只要 dispatcher 在 §6.2-9 把 self 注入封装在 entry.exec 包装层，manager 完全不需要感知 custom type。**实施时务必走这条路径**，否则会污染 manager。
2. **`ProgramSelf.callCommand` 在 thread 没有该 window 时的语义**：D4 让 callCommand 通用化为"调任意 window 上的任意 command"，但 LLM 可能传一个不在 contextWindows 里的 windowId。错误信息要明确（"windowId X 不在当前 thread.contextWindows；当前可见：..."）+ 不抛底层 import 错误。
3. **callCommand 调内置 window command 时的副作用**：例如 `self.callCommand(doWindowId, "continue", {...})` 会真的派一条 thread message。要确认 sandbox 里这种调用是被允许的（与 LLM 直接 open(do.continue) 等价）；本 plan 默认**允许**，但 e2e 要覆盖一例验证副作用对齐。
4. **`initContextWindows` 注入幂等**：`custom:<objectId>` id 必须严格稳定；历史 thread.json 没有 custom window —— 兜底插入逻辑走 spec 规定的"幂等"语义（`object.doc.ts` reflectable §1436、1550）。
5. **mtime 精度**：Object 一秒内连写 server/index.ts 两次，第二次可能因为秒级 mtime 没变而被 loader 缓存吃掉（已有 patch `mtime_resolution_caveat` 警告）。本次升级不解决，`writeServerSource` 后建议跟 1ms sleep 兜底（可选）。
6. **knowledge 通货膨胀**：custom window 的 `basicKnowledge` 会列所有 commands —— 当 commands 数量大时会膨胀 context。先观察，必要时引入"按 path 激活"（match 已经支持，basicKnowledge 写得克制即可）。
7. **手工重写漏改**：D6 不写自动迁移脚本依赖 §7 grep 清单；CI 里加一条 `grep -q llm_methods` 失败的守门，避免后续 stone 又意外回写旧名字。

---

## 9. 验收标准

- [ ] `bun tsc --noEmit` 全绿；`bun test` 全绿（含新增的 init / dispatcher / callCommand / e2e 用例）。
- [ ] §7 一次性硬切清单：旧符号 grep 全空、新符号 grep 命中预期文件。
- [ ] 一个新写法的 stone（`export const window`）能被 LLM 通过 `open(parent_window_id=<customWindowId>, command=...)` 调用并产生预期结果。
- [ ] `program.callCommand` 子模式通过 form 与 ts 脚本两种入口都能调通 custom + 内置 window 的 command。
- [ ] `meta/object.doc.ts` 关于 programmable / executable.context_window / executable.commands 的描述与新代码一致；每条断言锚定真实代码行；`bun tsc --noEmit meta/object.doc.ts` 通过。
- [ ] `basic-knowledge.ts` 中给 LLM 看的"如何为自己写命令"说明已切到新 API。
- [ ] CI grep 守门添加（防回退）。

---

## 10. 后续（不在本 plan）

- Object 注册多个自定义 window 类型：例如 `factor_workshop` 想给 LLM 一个独立的 `factor_review_window`，与 custom self window 平级（`export const windows = { ... }` 复数形态）。
- `ui_methods` 的统一抽象：把 visible 维度也纳入 "Object 给自己写 window" —— 客户端 `client/index.tsx` 直接消费 `window.ui_commands`。
- `params` schema 校验落地（`programmable.todo` 已记）。

---

## 11. 文件影响面（grep 估算）

> 实际 PR 时要先 `grep -rn` 一次确认。

- `src/executable/server/{loader,types,self,enrich}.ts`：核心改造 + 删旧符号。
- `src/executable/server/window-types.ts`：新文件。
- `src/executable/windows/{registry,types,init,manager,index}.ts`：扩 type、注入 self、side-effect import。
- `src/executable/windows/custom.ts`：新文件（dispatcher）。
- `src/executable/program/{function→call-command,types,sandbox/*}.ts`：重命名 + 参数升级 + sandbox self 字段调整。
- `src/thinkable/knowledge/basic-knowledge.ts`：LLM 协议知识更新。
- `src/app/server/modules/{stones,flows}/service.ts`：`callMethod` HTTP 路径不动（只服务 ui_methods）；只确认没有间接引用 `loadLlmServerMethods` 等已删符号。
- `src/executable/__tests__/{server-loader,server-enrich,server-self,program}.test.ts`：用例升级 + 新增 callCommand 用例。
- `src/executable/windows/__tests__/init.test.ts`：custom window 注入用例。
- `src/persistable/__tests__/stone.test.ts`：stone 字面量更新。
- `meta/object.doc.ts`：programmable + executable.context_window + executable.commands 节点改写。
- `meta/case.factor-dev.doc.ts` / `meta/cookbook.add-new-agent.doc.ts`：grep 确认无旧名引用。
- `tests/e2e/`：升级现有用例 + 新增最小 custom window 场景。
- ~~`stones/**/server/index.ts`：仓内全部 stone 手工重写。~~ → **修正**：`.ooc-world/` 与 `.ooc-world-test/` 都在 `.gitignore`，仓内**没有**任何 `stones/*/server/index.ts`；那 10 个文件都是运行时产物，硬切策略改为 §7-bis "world reset"。

---

## 12. 文件目录标准化（独立子任务，建议同 PR 合并）

### 12.1 动机

当前 `src/executable/windows/` 目录下：
- 已有 `root/` 子目录，把 root window 的 16 条 command 拆成一文件一 command（`do.ts`、`talk.ts`、`program.ts` ...）；
- 但其它 builtin window type（`do` / `talk` / `todo` / `program` / `file` / `knowledge` / `search` / `issue` / `relation`）**全部塞在单文件**里：window 自身定义 + 注册到自己 window 上的 command 全混在一个 `<type>.ts`，最大 302 行（file.ts），最少 15 行（todo.ts）。

不一致带来的问题：
- 加 custom window（§6.2）时，没有"现成的目录脚手架"可以照着放——会让"each window type 是一个文件夹"这件事更难成立。
- root/ 子目录里的命令文件也没有 `command.` 前缀，与"command 文件 vs window 自身定义文件"的边界混淆（`root/do.ts` 看起来像"`do` window 的定义"，实则是"root 上的 `do` command"）。

本子任务把"window type / command / helper"三类文件用目录 + 文件名前缀强制区分，便于 Object 自己将来照葫芦画瓢写 custom window 的目录形态时有蓝本。

### 12.2 已拍板的骨架（决策已锁定）

> **决策落定**：Q-N1=A（root/ 同改 `command.` 前缀），Q-N2=B+C 混合（跨 type 进 `_shared/`、type-private 进各自子目录），Q-N3=A（合在 index.ts），Q-N4 作废（`metaprog` 是真 command），Q-N5=A（进 `_shared/`），Q-N6=A（同 PR 落地）。

每个 type 的真实已注册命令（grep `registerWindowType` 调用确认）：

| type | 已注册命令 |
|------|-----------|
| root | do / talk / program / plan / end / todo / open_file / open_knowledge / write_file / glob / grep / create_issue / open_issue / metaprog |
| do | continue / wait / close |
| talk | say / wait / close |
| todo | （无显式注册；仅默认 close 行为） |
| program | close |
| file | set_range / reload / edit / close |
| knowledge | reload / close |
| search | open_match / close |
| issue | comment（close 行为通过默认走） |
| relation | edit（close 行为通过默认走） |
| custom | （由 Object 自己的 server/index.ts 提供，dispatcher 路由） |

```
src/executable/windows/
├── _shared/            # 跨 type 的基础设施（§12.3 Q2 决定是否单开此目录）
│   ├── command-types.ts
│   ├── manager.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── init.ts
│   ├── session-path.ts
│   └── super-constants.ts
├── index.ts            # barrel：side-effect import 各 type 子目录的 index.ts
├── root/
│   ├── index.ts        # registerWindowType("root", ...) + 跨 command 共享代码
│   ├── command.do.ts
│   ├── command.talk.ts
│   ├── command.program.ts
│   ├── command.plan.ts
│   ├── command.end.ts
│   ├── command.todo.ts
│   ├── command.open_file.ts
│   ├── command.open_knowledge.ts
│   ├── command.write_file.ts
│   ├── command.glob.ts
│   ├── command.grep.ts
│   ├── command.grep.impl.ts        # 多文件 command：command.<name>.<sub>.ts
│   ├── command.create_issue.ts
│   ├── command.open_issue.ts
│   └── command.metaprog.ts         # 单 command + action 派发，与其它 command 同形态
├── do/
│   ├── index.ts
│   ├── command.continue.ts
│   ├── command.wait.ts
│   └── command.close.ts
├── talk/
│   ├── index.ts
│   ├── command.say.ts
│   ├── command.wait.ts
│   ├── command.close.ts
│   └── delivery.ts                 # 原 windows/talk-delivery.ts → 收回 talk/ 子目录（type-private helper）
├── todo/
│   └── index.ts                    # todo 无显式 command；仅默认 close
├── program/
│   ├── index.ts
│   ├── runtime.ts                  # 原 windows/program-runtime.ts → 收回 program/
│   └── command.close.ts
├── file/
│   ├── index.ts
│   ├── command.set_range.ts
│   ├── command.reload.ts
│   ├── command.edit.ts
│   └── command.close.ts
├── knowledge/
│   ├── index.ts
│   ├── command.reload.ts
│   └── command.close.ts
├── search/
│   ├── index.ts
│   ├── command.open_match.ts
│   └── command.close.ts
├── issue/
│   ├── index.ts
│   └── command.comment.ts
├── relation/
│   ├── index.ts
│   └── command.edit.ts
├── custom/                         # §6.2 新加的 dispatcher type
│   └── index.ts                    # 不需要 command.*.ts —— commands 由 Object 的 server/index.ts 提供
└── __tests__/
    └── ...
```

**命名规则**（覆盖所有 type 子目录）：

1. `<type>/index.ts`：window type 自身定义（`registerWindowType(type, { renderXml, onClose, basicKnowledge, commands: { ...require all command.*.ts } })`）。
2. `<type>/command.<cmdName>.ts`：单条 command 的完整定义（导出 `CommandTableEntry`），文件名严格小写，与 command 注册名一致。
3. `<type>/command.<cmdName>.<subname>.ts`：单条 command 拆出来的辅助文件（如 `root/command.grep.impl.ts`），由对应 `command.<cmdName>.ts` import。
4. `<type>/<helperName>.ts`：type-private 的非 command 工具文件（如 `talk/delivery.ts`、`program/runtime.ts`），不带 `command.` 前缀。
5. `_shared/` 或不分（见 §12.3 Q2）：跨 type 的基础设施。

### 12.3 决策记录（原开放问题已锁）

| # | 问题 | 选项 | 决策 |
|---|------|------|---------|
| Q-N1 | `root/` 是否一并改名加 `command.` 前缀？ | A. 改；B. 保持现状 | **A**（统一 5 条命名铁律覆盖 root） |
| Q-N2 | helper 文件归哪？ | A. `windows/` 根；B. `_shared/`；C. 各归各家 | **B + C 混合**：跨 type 基础设施进 `_shared/`（manager / registry / init / types / command-types / session-path / super-constants）；type-private helper 收进各自子目录（talk-delivery → talk/delivery.ts；program-runtime → program/runtime.ts） |
| Q-N3 | `<type>/index.ts` 是否承担"window 注册"+"command 集合 import"？ | A. 合在 index.ts；B. 拆 window.ts | **A**（与 Object 的 `server/index.ts → export const window` 保持对仗） |
| Q-N4 | ~~`root/metaprog.ts` 怎么命名？~~ | — | **作废**：grep 确认 `metaprog` 是真 command（单命令 + action 派发），与其它 command 同形态走 `command.metaprog.ts` |
| Q-N5 | `super-constants.ts` / `session-path.ts` 归哪？ | A. `_shared/`；B. 上提 | **A** |
| Q-N6 | 与 §6 主体改造的关系？ | A. 同 PR；B. 拆两 PR | **A**（同 PR 落地，避免双重 rebase） |

### 12.4 落地步骤（在 §6 之前/之中插入）

> 强烈建议先做 §12 这一步、再做 §6 —— 因为 §6.2 的 `custom/` 子目录脚手架直接依赖此处的命名规则。

1. **建 `_shared/`**（如果 Q-N2 选 B/C 混合）：`git mv` 跨 type 基础设施进去，调整所有 import。
2. **逐 type 建子目录**：对 `do / talk / todo / program / file / knowledge / search / issue / relation` 9 个 type，每个：
   - 建 `<type>/` 目录；
   - `git mv <type>.ts <type>/index.ts`；
   - 把里面注册到该 window 上的 command 逐条拆到 `<type>/command.<cmd>.ts`；
   - type-private helper（如 `talk-delivery / program-runtime`）`git mv` 进对应子目录并按 §12.2 规则改名。
3. **`root/` 文件改名**（Q-N1=A）：`git mv root/<cmd>.ts root/command.<cmd>.ts`，`grep-impl.ts` 改名 `command.grep.impl.ts`，`metaprog.ts` 按 Q-N4 决定。
4. **`windows/index.ts`**：side-effect import 链路从 `import "./do"` 等改为 `import "./do/index"` / `import "./talk/index"` ...（或更显式的 `import "./do"` 由 TS resolve 到子目录的 `index.ts`，验证 bun 的 resolve 行为）。
5. **每移动一组就 `bun tsc --noEmit` + `bun test`**，确保 import 路径完全跟上，再移下一组。
6. **`__tests__/` 内的 import 路径修正**：grep 命中只有 4 处（`super-flow-channel.integration.test.ts` / `relation-window-edit-session.test.ts` 等），逐一改。

### 12.5 风险

1. **bun import resolution**：`import "./do"` 是否会被 bun 解析为目录的 `index.ts`？现有 `import "./root"` 已经是这种用法，✅ 验证过。但要 `bun tsc --noEmit` 兜一遍。
2. **git history 跟踪**：用 `git mv`（不要 cp+rm），让 blame / log 仍可追溯。
3. **改名风暴对正在飞的 PR/分支不友好**：本 plan 一旦执行，任何并行 PR 在 rebase 时都要解决路径冲突。**建议在仓库当前没有 active feature PR 时窗口期落地**；如果有，先与对方协调 merge 顺序。
4. **`command.<x>.ts` 文件名限制**：bun/Vite 等工具对带点的文件名通常都支持，但有些 IDE 的"按文件名跳转"对带点的名字排序不稳。这是接受的代价，换来的是 tab 切换时一眼分辨"command vs helper"。

### 12.6 验收标准

- [ ] `windows/` 下每个 builtin type 都有自己的子目录；目录内部至少含一个 `index.ts`；命令每条对应一个 `command.<name>.ts`。
- [ ] 多文件 command 命名为 `command.<name>.<sub>.ts`（grep 当前唯一例子是 `grep-impl.ts`）。
- [ ] type-private helper 不带 `command.` 前缀；跨 type 基础设施位于 `_shared/`（按 Q-N2=B+C 决定）。
- [ ] `root/` 也遵守同一规则（`command.<name>.ts`）。
- [ ] `bun tsc --noEmit` 全绿；`bun test` 全绿；`bun run` app server 启动正常（registry 注册顺序未被 import 改名打散）。
- [ ] `git log --follow` 能跟踪每个被 `git mv` 的文件历史。

---

## 13. §7-bis：world reset 操作（取代原 §6.5 仓内手工重写）

`.ooc-world/` 与 `.ooc-world-test/` 都在 `.gitignore`，仓内不持有任何 stone 源码。硬切策略：

1. PR merge 前，确认本机 `.ooc-world*/` 不持有不可重建的工作产物（如有，先备份）；
2. PR merge 后：`rm -rf .ooc-world .ooc-world-test`；
3. 用新 API 跑一遍 bootstrap（meta-programming integration test 或 `scripts/dialog-experience.ts` 的 setup 逻辑），让 super flow 重新写出新形态的 `stones/*/server/index.ts`（`export const window`）。
4. 这一步同时验证 §6 的"Object 元编程链路"端到端工作。

> **AgentOfExperience 派单约束**：world reset 之后必须真跑一条 e2e 场景验证 custom window + program.callCommand 链路，不能只看 `bun tsc --noEmit` 通过就报 done（[Supervisor 派 form 错误文案前看状态机](memory) 同源教训：硬切类改动状态过渡很容易在 form/state 处出 bug）。
