# OOC-4 L5a：自视切片机制 + todo 塌缩

> 执行 sub-agent **不要自己 commit**。

**Goal:** 建立**自视切片机制**（ContextBuilder 每轮从 owner flow 文件渲染 `<self_view>` 段），并用 **todo** 作首个塌缩证明：todo_window（持久化 ContextWindow）→ `todos.json`（owner flow）+ root 方法 `todo_add/check/uncheck/remove/list`（写文件）+ 未完成 todos 自视切片。删 todo_window type。

**Architecture:** 新增 `src/persistable/flow-todos.ts`（todos.json，object-scoped：flows/<sid>/objects/<oid>/todos.json）+ `renderSelfView(thread)`（读 owner flow 文件渲染自视段，L5a=todos）插进 `renderContextXml` 的 `<context>`。root.todo（创建 window）→ 替换为 todo_* 方法（读写 todos.json）。删 todo WindowType + TodoWindow + renderTodoWindow + windows/todo/。

**权威**：L5-6 设计 spec §2（自视切片）/ §4（todo）/ §7（L5a）。基线（L4.2c 后）：1077 pass / 0 fail / 3 skip，tsc 0。

---

## 设计决策
### D1 todos.json（object-scoped owner flow）
`flows/<sid>/objects/<oid>/todos.json`（与 data.json 同级，仿 flow-data 模式）。schema：`Todo[] = { id: string; content: string; done: boolean; onCommandPath?: string[] }`。`src/persistable/flow-todos.ts`：`todosFile(ref)` / `readTodos(ref): Promise<Todo[]>`（不存在→[]）/ `writeTodos(ref, todos)`。**写经 `enqueueSessionWrite`（serial-queue，仿 flow-data.ts:57-95 防 lost-update）**（L6）。
- **object-scoped 是刻意改变（H2，affirm）**：现 todo_window per-thread（child do thread 看不到 parent todos，因 buildChildInitialWindows 只 seed creator do_window）；塌缩后 todos 属**对象**，该对象所有 thread（root + child do threads，因 deriveChildPersistence 共享 objectId）自视都渲染同一 todos。**这是期望语义**（todos = 对象级 intent），非 bug。Task 加 child-do-thread 自视渲染 todos 的测试明确之。

### D2 root 方法（写 todos.json，替换 root.todo）
ROOT_METHODS 去 `todo: todoCommand`，加：
- `todo_add(content, on_command_path?)`：append `{id: genId(), content, done:false, onCommandPath?}`。
- `todo_check(id)` / `todo_uncheck(id)`：set done。
- `todo_remove(id)`：删。
- `todo_list`：返回当前 todos（method 返回值给 LLM，亦自视常驻）。
各 method 经 `deriveFlowObjectRef(ctx.thread.persistence)` 拿 ref 读写 todos.json。method knowledge 文本说明（in-character，agent-facing）。

### D3 自视切片机制（核心新组件）
`renderSelfView(thread): Promise<XmlNode | null>`（新文件 `src/thinkable/context/self-view.ts`）：读对象 todos.json → 未完成 todos 渲染成 `<self_view><todos>...<todo id= done= on_command_path=>content</todo></todos></self_view>`。
- **插入点（L7 修正）**：`<self_view>` 是 `<context>` 的直接 child，插在 `renderSelfNodes(...)`（`<self>`，render.ts:276）之后、`<thread>` 元素之前（windows 在 `<thread>` 内嵌，不是「windows 之前」）。renderContextXml 已 async（render.ts:246），`await renderSelfView` 无需改签名。现有 context.test 用 `toContain` 子串匹配、不断言 `<context>` child 顺序，故不破。
- **nil-persistence 短路（L7）**：`renderSelfNodes` 在 `thread.persistence?.objectId` 缺失时返 []（render.ts:294，in-memory 测试模式）；`renderSelfView` 同样在无 persistence ref 时 return null（无路径读 todos.json）。
- L5a 只渲 todos 段；L5b/c 往 `<self_view>` 加 plan/talk 段（机制复用）。
- 空（无未完成 todo）→ 不渲 `<todos>`（保持紧凑）。
- on_command_path：自视里标注（`on_command_path` attr）。**MVP**：仅标注，不做「执行该 command 时动态强提醒」（现 window 在场才提醒；塌缩后降级为常驻标注——开放点，YAGNI）。

### D4 删 todo_window（tsc 枚举引用）
- WindowType union（`_shared/types.ts:20`）去 `"todo"`；删 `TodoWindow` interface；**清 `generateWindowId` 前缀 map（types.ts:189）里 `todo:"w_todo"`**（M4，死引用）。
- 删 `registerWindowType("todo")` + `renderTodoWindow`（windows/todo/index.ts）+ windows/todo/ 目录 + windows/index.ts 去 import。
- **删 `registry.ts:131` 的静态 `REGISTRY.set("todo", {...})` seed**（M4，与 side-effect registerWindowType 分离的另一处，WindowType 去 todo 后是 type error/死 seed）。
- 删 command.todo.ts 旧 executeTodoCommand（替换为 D2 的 todo_* methods，重写 command.todo.ts）。
- tsc 枚举所有 `type:"todo"` / `TodoWindow` / `todoCommand` 引用补齐。

### D5 持久化迁移
旧 thread.json 含 todo_window（type:"todo"）→ WindowType 去除后 TS 不允许；运行时 JSON 仍可能有 → renderContextXml 渲染时 getWindowTypeDefinition("todo") 抛错。**dev world 重生**（gitignored），不写迁移器（YAGNI，无生产数据）。**测试**：现有建 todo_window 的测试迁移到 todos.json/todo_* 方法（无残留 todo_window）。

---

## File Structure
```
src/persistable/flow-todos.ts                     # 新增：todos.json 读写 + Todo type
src/persistable/index.ts                          # 改：export flow-todos
src/thinkable/context/self-view.ts                # 新增：renderSelfView（L5a=todos 段）
src/thinkable/context/render.ts                   # 改：renderContextXml 插 <self_view>
src/executable/windows/root/command.todo.ts       # 改：todo_* 方法（写 todos.json，去 window 创建）
src/executable/windows/root/index.ts              # 改：ROOT_METHODS 去 todo 加 todo_add/check/uncheck/remove/list
src/executable/windows/_shared/types.ts           # 改：WindowType 去 "todo"，删 TodoWindow
src/executable/windows/todo/                       # 删：整目录
src/executable/windows/index.ts                   # 改：去 import "./todo/index.js"
# 测试迁移：建 todo_window 的测试改 todos.json/todo_* + 自视断言
```

---

## Task 1：flow-todos 持久化（先单测）
- [ ] 新建 `flow-todos.ts`（todosFile/readTodos/writeTodos + Todo type）+ 单测（读不存在→[]、写后读回、append/check/remove 经 read-modify-write）。export 自 persistable index。
- [ ] `bun test src/persistable/__tests__/flow-todos.test.ts` 绿。

## Task 2：root todo_* 方法
- [ ] 重写 command.todo.ts：todo_add/check/uncheck/remove/list（MethodEntry，读写 todos.json via ctx.thread.persistence 的 flow object ref）+ in-character knowledge。
- [ ] ROOT_METHODS（root/index.ts:39）去 `todo`，加 5 个 todo_*。**更新 `ROOT_KNOWLEDGE` const 方法表（root/index.ts:68-90，line 79 的 `| todo | … | 创建 todo_window |` 行；不是 renderRoot——它返 []）**（H3，agent-facing，每轮注入 LLM）：删 todo 行，加 5 个 todo_* 行。
- [ ] 注：exec 工具 method enum 由 `getOpenableCommands()`=ROOT_METHODS keys 自动派生（exec.ts:44），增删 method **schema enum 自动更新**（14→18），无需手改 schema（H3 答开放点 4）。
- [ ] 各 todo_* method 须返回 `internal/executable/todo_<x>/basic` knowledge entry（>20 字符）——`commands.test.ts:50-57` 的 per-method knowledge-contract 循环会断言。
- [ ] 单测：todo_add 写 todos.json、todo_check 改 done、todo_list 返回。

## Task 3：自视切片机制 + 接 render
- [ ] 新建 self-view.ts：`renderSelfView(thread)` 读 todos.json → 未完成 todos → `<self_view><todos>...` （on_command_path attr）。
- [ ] renderContextXml（render.ts:246+）：`<context>` children 在 `<self>` 后插 `await renderSelfView(thread)`（非空时）。
- [ ] 单测：含未完成 todos 的 thread → context XML 有 `<self_view><todos>`；无 todos → 无该段。

## Task 4：删 todo_window（tsc 枚举）
- [ ] WindowType union 去 "todo" + 删 TodoWindow；删 registerWindowType("todo")/renderTodoWindow/windows/todo/ 目录 + windows/index.ts 去 import；删 command.todo.ts 旧 executeTodoCommand（已被 D2 替换）。
- [ ] tsc 枚举补齐所有 todo_window/TodoWindow/type:"todo" 引用（含测试 fixture）。

## Task 5：测试迁移 + meta 内容 + 回归
- [ ] **测试迁移完整 7 文件（C1，gate 前提）**——迁移到 todos.json + todo_* + 自视断言：
  - `tests/integration/todo-driven-multistep.integration.test.ts`、`src/executable/__tests__/step2-windows.test.ts`（todo 段）
  - `src/executable/__tests__/commands.test.ts`（:11/:24 `toContain("todo")`、**:32-47 精确 sorted `toEqual` 须删 todo 插 todo_add/check/list/remove/uncheck 保排序**、**:50-57 per-method knowledge 循环**、:99-104 `deriveRootMethodPaths("todo")`）
  - `src/executable/__tests__/commands-execution.test.ts`（:12 遍历 ROOT_METHODS、:46-57/:182 `execRootMethod("todo")` 断言建 window→改建 todos.json）
  - `src/thinkable/__tests__/context.test.ts`（:317-339 「renders todo_window」测试→改 `<self_view><todos>` 路径或删）
  - `src/thinkable/__tests__/thinkloop.test.ts`（:266-296 驱动 `method:"todo"` + 断言 `w.type==="todo"`→改 todos.json/自视）
  - `src/executable/windows/root/__tests__/command.refine-hint.test.ts`（:37 method 名列表）
- [ ] **meta 内容更新（M5，tsc 不抓字符串）**：`meta/object.doc.ts:831`（「共 14 个全局 method」→18）+ `:850`（删 `"todo": "创建待办窗口的 method"`，加 todo_* 描述）。改后 `bun tsc --noEmit meta/object.doc.ts`。
- [ ] `bun test src/`（新 todo/self-view 测试、0 fail）、`bun tsc --noEmit`（0）、`bun tsc --noEmit meta/*.doc.ts`、`RUN_BACKEND_E2E=1 NO_PROXY=localhost,127.0.0.1,::1 bun test tests/e2e/backend/route-audit.e2e.test.ts`。

---

## 验证 gate
- [ ] todo_add→todos.json 落盘；todo_check 改 done；todo_list 返回。
- [ ] 自视切片：含未完成 todos 的 context 有 `<self_view><todos>`；done/空不渲。
- [ ] todo_window type 彻底删（WindowType 无 "todo"，windows/todo/ 删，tsc 0 残留）。
- [ ] 自视是 owner 自视（ContextBuilder 渲染），不走 readable。
- [ ] bun test src/ 0 fail；tsc 0；meta tsc PASS；route-audit PASS。

## 开放点（feasibility review 核查）
1. todos.json object-scoped（flow 对象级，跨 thread 共享）vs per-thread——现 todo_window 是 per-thread（thread.contextWindows）。object-scoped 是否改变语义（child do thread 看不看到 parent todos）？
2. on_command_path 强提醒降级为常驻标注是否丢功能（现靠 window 在场）。
3. renderSelfView 读 todos.json 是 per-render 磁盘 IO——热路径性能（缓存？）。
4. ROOT_METHODS 去 todo 加 5 method 对 getOpenableMethods/exec schema enum 的影响（LLM emit 的 method 名变化，agent-facing）。
5. `<self_view>` 与现有 `<self>` / windows 区的 XML 结构协调（render snapshot 测试）。
