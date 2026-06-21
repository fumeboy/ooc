# self.md 出 core + agency 迁 thread —— 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把 self.md 持久化逻辑彻底归 agent builtin（core 不再拥有 readSelf/writeSelf 实现、不再自动建 self.md），并把 end/todo 从 agent agency 迁回 thread。

**Architecture:** 复刻 thread 持久化下沉模式（core 经既有依赖 import builtin API）。renderer 经 registry 派发 `persistable.load` hydrate self 门面窗、agent 自定义 readable 渲 `data.self`；未用的 PUT `/self` 写端点删除；GET `/self` 薄读 + create 流程从 agent builtin import readSelf/writeSelf。

**Tech Stack:** TypeScript / bun runtime / bun:test / Elysia（后端控制面）。

**这是行为保持的 refactor，不是 TDD 新功能**：纪律是**每个 commit 源码保持可编译/连贯**，断掉的测试**只登记账本**（[[feedback_refactor_defer_test_fixes]]），最后 Task 8 统一改 import 路径 + 跑绿。派 sub-agent 须明确"中间任务只登记坏测试、不逐步修"。

**路径基准**：所有路径相对仓库根 `/Users/zhangzhefu/x/ooc-2/ooc/.worktree/self-md-to-agent-builtin`。对象树在 `.ooc-world-meta/stones/main`（独立 git 仓 → ooc-0）。

---

## 前置：基线

- [ ] **Step 0.1：装依赖**

Run: `bun install`
注意 [[project_bun_lock_bnpm_hang]]（bnpm host 卡死则 perl 替换回 npmjs.org）。worktree 无 node_modules，必须装。

- [ ] **Step 0.2：取 green 基线（锚定后续断裂归因）**

Run: `bun run test:storybook`
Expected: 0 FAIL（CI gate）。记录通过数。若已有 FAIL，先报告再决定是否继续。

---

## Task 1：end/todo 迁 thread（executable）

**Files:**
- Move: `packages/@ooc/builtins/agent/executable/method.end.ts` → `packages/@ooc/builtins/agent/children/thread/executable/method.end.ts`
- Move: `packages/@ooc/builtins/agent/executable/method.todo.ts` → `packages/@ooc/builtins/agent/children/thread/executable/method.todo.ts`
- Modify: `packages/@ooc/builtins/agent/executable/index.ts`
- Modify: `packages/@ooc/builtins/agent/children/thread/executable/index.ts`

- [ ] **Step 1.1：物理移动两文件**

```bash
git mv packages/@ooc/builtins/agent/executable/method.end.ts packages/@ooc/builtins/agent/children/thread/executable/method.end.ts
git mv packages/@ooc/builtins/agent/executable/method.todo.ts packages/@ooc/builtins/agent/children/thread/executable/method.todo.ts
```

- [ ] **Step 1.2：两文件 Data import 改指 thread types**

两文件顶部 `import type { Data } from "../types.js";` 当前解析为 agent 的 `types.ts`（`{self}`）。移动后 `../types.js` 自动解析为 thread 的 `types.ts`——**无需改动 import 语句本身**（相对路径不变、目标变）。确认两 method 体内只用 `ctx.thread`/`ctx.runtime`、不读 `self`（`endMethod.exec` 第二参 `_self`、`todoMethod.exec` 第二参 `_self` 均下划线未用）。无需改代码。

- [ ] **Step 1.3：agent/executable/index.ts 收敛 agency 为 talk/plan**

`packages/@ooc/builtins/agent/executable/index.ts`：删 `import { todoMethod } ...` 与 `import { endMethod } ...` 两行；`methods` 数组改为 `[talkMethod, planMethod]`；文件头注释里 agency 列表 `talk/plan/todo/end` 改 `talk/plan`。

- [ ] **Step 1.4：thread/executable/index.ts 注册 end/todo**

`packages/@ooc/builtins/agent/children/thread/executable/index.ts`：加
```ts
import { endMethod } from "./method.end.js";
import { todoMethod } from "./method.todo.js";
```
`methods` 数组加 `endMethod, todoMethod`；文件头注释补一行"end/todo —— thread 作用域操作（从 agent agency 迁入）"。

- [ ] **Step 1.4b：thread/readable 投影窗 surface end/todo（🔴 review 抓到的缺口——缺则 LLM 不可见）**

编辑 `packages/@ooc/builtins/agent/children/thread/readable/index.ts`：找 `thread` 投影窗的 `WindowClassDecl`（self-view 非 super，现 `object_methods` 含 `say` 等），把 `end`/`todo` 加进其 `object_methods`。**只加到 `thread` 投影窗**——`talk`（other-view）/ `reflect_request`（super）**不加**（end/todo 是 self-view thread 自管）。读该文件确认三个投影窗 decl 的结构再改。验证：method 注册（executable）+ surface（readable）两侧都到位，否则 end/todo 静默失效。

- [ ] **Step 1.5：grep 残留引用收口**

Run: `grep -rn "endMethod\|todoMethod\|executable/method\.end\|executable/method\.todo" packages/@ooc/builtins/agent --include="*.ts" | grep -v children/thread`
Expected: 仅 `agent/executable/index.ts` 已无引用（应空）。若别处（如旧测试）import `agent/executable/method.end`，登记进 Task 8 账本、不在此修。

- [ ] **Step 1.6：typecheck + commit**

Run: `cd packages/@ooc/builtins/agent && bunx tsc --noEmit 2>&1 | head -20`（或仓库既有 typecheck 命令）
Expected: 无新增 agent executable/thread 相关错误。
```bash
git add -A && git commit -m "refactor(agent): end/todo 从 agency 迁回 thread/executable"
```

---

## Task 2：createStoneObject 停建 self.md/readable.md（persistable）

**Files:**
- Modify: `packages/@ooc/core/persistable/stone-object.ts:173-174`（删两行写文件）+ import 行

- [ ] **Step 2.1：删空文件创建**

`stone-object.ts` `createStoneObject` 内删：
```ts
await writeFile(selfFile(ref), "", "utf8");
await writeFile(readableFile(ref), "", "utf8");
```
保留 `await writeFile(join(dir, "package.json"), ...)`。

- [ ] **Step 2.2：清理 import**

删 `import { selfFile } from "./stone-self";`。检查 `readableFile`（来自 `./stone-readable`）是否在本文件别处使用：
Run: `grep -n "readableFile\|selfFile" packages/@ooc/core/persistable/stone-object.ts`
若仅 line 5 import + 已删的 174，删 `import { readableFile } from "./stone-readable";`。`discoverStoneHierarchicalPeers` 用的是字符串字面量 `"self.md"`（非 selfFile）——保留不动。

- [ ] **Step 2.3：更新文件内 docstring**

`createStoneObject` 上方 docstring（约 133-150）描述"创建 self.md/readable.md 空文件占位"的段落改为"仅创建 package.json；self.md 仅 agent 实例由 agent persistable 写入（对象模型核心 9），readable.md 按需 lazy 写"。

- [ ] **Step 2.4：typecheck + commit**

Run: `grep -rn "createStoneObject" packages/@ooc/core --include="*.ts" | grep -v test`（确认调用方仍编译——它们后续自行 writeSelf）
```bash
git add -A && git commit -m "refactor(persistable): createStoneObject 不再自动建 self.md/readable.md(核心9)"
```

---

## Task 3：P3 renderer 去 readSelf —— agent 自定义 readable + hydrate self 窗（readable）

**Files:**
- Create: `packages/@ooc/builtins/agent/readable/index.ts`
- Modify: `packages/@ooc/builtins/agent/index.ts`（装配 readable）
- Modify: `packages/@ooc/core/thinkable/context/renderers/xml.ts`（hydrate self 窗 + 删 Step2 self-view readSelf 分支 + 删 readSelf import）

- [ ] **Step 3.1：建 agent readable module**

Create `packages/@ooc/builtins/agent/readable/index.ts`：
```ts
/**
 * agent —— readable 维度。
 *
 * agent 的 self 门面窗投影：渲身份正文 `data.self`（self.md 内容）为 self 视角内容。
 * data.self 由 renderer 经 registry 派发 agent persistable.load hydrate（self 门面窗
 * 注入时 data 为空，render 前填充）。空身份 → 空窗。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/readable/contract.js";
import type { Data } from "../types.js";

const readable: ReadableModule<Data> = {
  readable: (_ctx: ReadableContext, self: Data) => ({
    class: "agent",
    content: self?.self && self.self.trim().length > 0 ? self.self : "",
  }),
  // 🔴 必带 window decl——否则 self 门面窗 agency 静默失效（review 抓到）。
  // 只列 talk/plan（end/todo 已迁 thread，不在 agent agency）。
  window: [
    { class: "agent", object_methods: ["talk", "plan"], window_methods: [] },
  ],
};

export default readable;
```
> 注 1：`ReadableModule` 的 `readable` 返回 `{class, content}`（content 可为 string 或 xml 节点数组，见 `terminal_process/readable/index.ts:25`）。空字符串 content → renderer 落空窗回退。确认 `@ooc/core/readable/contract.js` 的 `ReadableModule`/`ReadableContext`/`WindowClassDecl` 导出名 + `window` 字段结构（Run: `grep -n "export.*Readable\|WindowClassDecl\|window" packages/@ooc/core/readable/contract.ts`）。
> 注 2：**先核实 agent 现在没 readable 时，self 门面窗 agency（talk/plan/todo/end）是经哪条 window decl surface 的**（默认投影？root window？）——P3 接管后 window decl 的 `object_methods` 必须覆盖现有 agency（减去迁走的 end/todo），即 `[talk, plan]`，否则破坏 agency 可见性。这是本 Task 风险最高处。
> 注 3：`class` 字段取值需与 self 门面窗的投影 class 约定一致（self 门面窗 `inst.class=objectId`；投影 class 怎么定由现有默认投影决定）——核实后取正确值，勿臆造 `"agent"`。

- [ ] **Step 3.2：agent/index.ts 装配 readable**

`packages/@ooc/builtins/agent/index.ts`：`import readable from "./readable/index.js";`，`export const Class = { construct, executable, persistable, readable }`（加 readable 字段）。确认 Class 装配的既有结构（Run: `grep -n "export const Class\|construct\|executable\|persistable" packages/@ooc/builtins/agent/index.ts`）。

- [ ] **Step 3.3：renderer hydrate self 门面窗 data**

`xml.ts` `resolveProjection`（约 285）开头、`registry.resolveReadable` 之前插入：对 self 门面窗（`inst.win?.isSelfWindow`）先填 data——
```ts
// self 门面窗注入时 data 为空（init.ts），render 前经 registry 派发 persistable.load
// hydrate，使 agent readable module 拿到 data.self。core 不直接 readSelf。
if (inst.win?.isSelfWindow && persistence && (!inst.data || Object.keys(inst.data).length === 0)) {
  const pmod = registry.resolvePersistable(inst.class);
  if (pmod?.load) {
    const loaded = await pmod.load({
      baseDir: persistence.baseDir,
      objectId: inst.id,
      sessionId: persistence.sessionId,
      dir: "", // load 自行经 resolveStoneIdentityRef 路由，不依赖 dir
    });
    if (loaded) inst = { ...inst, data: loaded };
  }
}
```
确认 `resolveProjection` 签名里有 `registry` 与 `persistence`（Step2 已用 `persistence.baseDir`/`persistence.sessionId`、`registry.resolveReadable`，故均在作用域）。`PersistableContext` 字段名以 `contract.ts` 为准（baseDir/objectId/sessionId/dir）。

- [ ] **Step 3.4：删 Step2 self-view readSelf 分支 + import**

`xml.ts` Step2 默认投影（约 308-322）：把
```ts
const isSelfView = !!thread.persistence?.objectId && thread.persistence.objectId === inst.id;
const text = isSelfView ? await readSelf(stoneRef) : await readReadable(stoneRef);
```
改为只渲 peer-view：
```ts
const text = await readReadable(stoneRef);
```
（self 门面窗现由 Step1 agent readable 命中，不再走 Step2。）删 `xml.ts` import 行里的 `readSelf`（保留 `readReadable`/`resolveStoneIdentityRef`/`StoneObjectRef`）。更新该段 docstring（self.md 不再由 renderer 读）。

- [ ] **Step 3.5：typecheck + 定向验证**

Run: `grep -n "readSelf" packages/@ooc/core/thinkable/context/renderers/xml.ts`
Expected: 空（renderer 已无 readSelf）。
Run: agent readable 相关 story 若存在则跑 `thinkable.story`（`TC-THINK-02` 验 self.md 作身份加载）——登记是否受影响进 Task 8。

- [ ] **Step 3.6：commit**

```bash
git add -A && git commit -m "refactor(readable): agent 自定义 readable 渲 data.self + renderer 经 registry.load hydrate self 窗(去 core readSelf)"
```

---

## Task 4：P4 createStone 仅 agent 写 self.md（persistable）

**Files:**
- Modify: `packages/@ooc/core/app/server/modules/stones/service.ts`（createStone 加 agent 判定）

- [ ] **Step 4.1：createStone 写 self 加 agent gate**

`service.ts` `createStone`（约 218-225）把无条件 writeSelf 改为仅 agent：
```ts
await createStoneObject(wtRef, classId ? { class: classId } : undefined);
const isAgent = classId === "_builtin/agent";
if (isAgent) {
  if (self !== undefined) {
    await writeSelf(wtRef, self);
  } else if (name !== undefined) {
    await writeSelf(wtRef, name);
  }
}
if (readable !== undefined) await writeReadable(wtRef, readable);
```
> 非 agent 不写 self.md（对齐核心 9）；displayName 对非 agent 降级到 objectId（前端 `objects/query.ts` 既有降级链，无需改）。

- [ ] **Step 4.2：commit（writeSelf 仍 import 自 core，Task 5 再迁）**

Run: `cd packages/@ooc/core && bunx tsc --noEmit 2>&1 | grep -i "service.ts" | head`
```bash
git add -A && git commit -m "refactor(persistable): createStone 仅 agent(class=_builtin/agent) 写 self.md(核心9)"
```

---

## Task 5：P1 stone-self 下沉 agent builtin + P2 import 重定向（persistable + 控制面）

> **P2 已收回（2026-06-21 裁决）**：不删任何端点。putSelf 是四对等版本化源码编辑端点之一、且 TC-PERS-02 在测——只做 import 重定向。"删端点+塌为通用 file-edit / class visible 改 data"是 spec §六 的后续独立 spec。

**Files:**
- Create: `packages/@ooc/builtins/agent/persistable/self-md.ts`（承接 stone-self.ts）
- Modify: `packages/@ooc/builtins/agent/persistable/index.ts`（用本地 self-md）
- Delete: `packages/@ooc/core/persistable/stone-self.ts`
- Modify: `packages/@ooc/core/persistable/index.ts`（删 re-export）
- Modify（import 重定向到 builtin）：`core/app/server/modules/stones/service.ts`（getSelf/putSelf/createStone 的 readSelf/writeSelf）、`core/persistable/stone-create-object.ts`

- [ ] **Step 5.1：建 builtin self-md.ts（移植 stone-self.ts 内容）**

Create `packages/@ooc/builtins/agent/persistable/self-md.ts`：
```ts
/**
 * agent self.md 读写 —— self.md 是 agent 实例独有身份（对象模型核心 9），
 * 其序列化实现归 agent builtin（core 只提供框架原语 stoneDir/resolveBuiltinReadDir）。
 *
 * 模式同 thread 持久化下沉（thread/persistable/thread-json.ts）：core 少数合法读者
 * （renderer 经 registry.load / GET /self 薄读 / create 流程）从本文件 import。
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  stoneDir,
  resolveBuiltinReadDir,
  type StoneObjectRef,
} from "@ooc/core/persistable";

/** self.md 的 canonical（写）绝对路径。 */
export function selfFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "self.md");
}

/**
 * 读 self.md，不存在返回 undefined。builtin（非 worktree ref）从框架包读（resolveBuiltinReadDir）。
 */
export async function readSelf(ref: StoneObjectRef): Promise<string | undefined> {
  const builtinDir = resolveBuiltinReadDir(ref);
  const path = builtinDir ? join(builtinDir, "self.md") : selfFile(ref);
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写 self.md，覆盖。 */
export async function writeSelf(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(selfFile(ref), text, "utf8");
}
```
> 确认 `@ooc/core/persistable` 导出 `stoneDir`/`resolveBuiltinReadDir`/`StoneObjectRef`（Run: `grep -n "resolveBuiltinReadDir\|export.*stoneDir\|StoneObjectRef" packages/@ooc/core/persistable/index.ts`）。

- [ ] **Step 5.2：agent persistable/index.ts 用本地 self-md**

`packages/@ooc/builtins/agent/persistable/index.ts`：把
```ts
import { readSelf, writeSelf, resolveStoneIdentityRef } from "@ooc/core/persistable/index.js";
```
拆为：
```ts
import { resolveStoneIdentityRef } from "@ooc/core/persistable/index.js";
import { readSelf, writeSelf } from "./self-md.js";
```

- [ ] **Step 5.3：删 core stone-self.ts + re-export**

```bash
git rm packages/@ooc/core/persistable/stone-self.ts
```
`core/persistable/index.ts`：删 `export { readSelf, selfFile, writeSelf } from "./stone-self";`（约 line 73）。

- [ ] **Step 5.4：重定向 core 剩余 import 到 builtin self-md**

- `core/app/server/modules/stones/service.ts`：import 里的 `readSelf`/`writeSelf` 改自 `@ooc/builtins/agent/persistable/self-md.js`（与同文件既有 `@ooc/builtins/...` import 风格一致）。
- `core/persistable/stone-create-object.ts`：`import { writeSelf } from "./stone-self.js";` 改 `import { writeSelf } from "@ooc/builtins/agent/persistable/self-md.js";`。
- 其它 core 非测试源若 import 这三符号自 `@ooc/core/persistable`，一并重定向：
  Run: `grep -rln "readSelf\|writeSelf\|selfFile" packages/@ooc/core --include="*.ts" | grep -v test | grep -v stone-self`
  逐个核对 import 来源、改到 builtin self-md。

- [ ] **Step 5.5：端点保留（不删）**

`putSelf`/`getSelf`/`api.put-self.ts`/`api.get-self.ts`/注册点**全部保留不动**——它们的 `readSelf`/`writeSelf` 已在 Step 5.4 重定向到 builtin。端点存废归 spec §六 后续 spec。

- [ ] **Step 5.6：核验 core 零 self.md 读写实现**

Run: `grep -rn "from \"./stone-self\"\|persistable/stone-self" packages/@ooc/core --include="*.ts"`
Expected: 空。
Run: `grep -rn "readSelf\|writeSelf\|selfFile" packages/@ooc/core --include="*.ts" | grep -v test | grep "@ooc/builtins"`
Expected: 仅 service.ts / stone-create-object.ts 等从 builtin import（合法）。core 自身无 readSelf/writeSelf 定义。

- [ ] **Step 5.7：typecheck（源码连贯）+ commit**

Run: `cd packages/@ooc/core && bunx tsc --noEmit 2>&1 | grep -iv "\.test\.ts" | head -30`
Expected: 无非测试源错误（测试错误是预期、Task 8 修）。
```bash
git add -A && git commit -m "refactor(persistable): stone-self 下沉 agent builtin self-md + 消费方 import 重定向(P1+P2)"
```

---

## Task 6：对象树文档回流 + 退潮（push ooc-0）

> **权威回流清单见 issue** `.ooc-world-meta/stones/main/docs/issues/2026-06-21-self-md-out-of-core-and-agency-relocation.md` 的「一致性回流清单」+「裁决」段——本 Task 逐条落实。除 agency/self.md 实现归属回流外，**还含 review 裁决的退潮项**：
> - **frontmatter**（🔴 喂 LLM）：`agent.md` 第 3 行 `description` 里 `agency talk/plan/todo/end`→`talk/plan`、「无自定义 readable」→「自定义 readable 渲 data.self」。
> - **退潮「self.md 进 instructions」三处**：`index.md:136`（readable×thinkable）+ `thinkable/self.md` identity 子模块 + `thinkable/knowledge/tests.md` TC-THINK-02 → 统一「不进 thinkloop instructions、渲为 self 门面窗 self 视角内容」（代码权威：`core/thinkable/context/index.ts:456-457`）。
> - **退潮幽灵符号**：`index.md:140` `loadSelfInstructions`（代码已无）。
> - **核心条补 plan**：`object/self.md` 核心 9/10 + `index.md:168` `## agent`：agency 显式 = talk/plan，end/todo 不属 agent agency。
> - **thread.md**：object method 清单补 end/todo/close/new_feat_branch/create_pr…；加 todo 语义说明（不改 thread Data、在 thread context 内登记 todo 对象）。
> - **index.md `## builtins`**：措辞精化为「class=_builtin/agent 实例才有 self.md」。
> - **不纳入本次**（issue 范围外，登记）：thread status=canceled、share 实现、createObjectInSession readableMd 必填、displayName 协议重设计。

**Files（在 `.ooc-world-meta/stones/main`）:**
- Modify: `objects/supervisor/children/object/knowledge/builtins/agent.md`（frontmatter + §一/§二/§三/§四，穷举见 issue review 的 agent reviewer 清单）
- Modify: `objects/supervisor/children/object/self.md`（核心 9/10）
- Modify: `objects/supervisor/knowledge/index.md`（`## agent` / `## builtins` / `## readable × thinkable` / `## persistable × thinkable`）
- Modify: `objects/supervisor/children/thinkable/self.md`（identity 子模块退潮）、`children/thinkable/knowledge/tests.md`（TC-THINK-02）、`children/thinkable/knowledge/thread.md`（method 清单 + todo 语义）
- Modify（按需）: `children/readable/self.md`

- [ ] **Step 6.1：agent.md self×executable —— agency 改 talk/plan**

`agent.md` `### self × executable` 段：agency 四条 talk/plan/todo/end → **talk/plan**；删 todo/end 两条，标题 `（talk / plan / todo / end）`→`（talk / plan）`。`children/thread` 段把 end/todo 明列为 thread object method（与既有 `say/end` 合并、消解重复列）；§一/§四的 agency `talk/plan/todo/end` 列举同步改。

- [ ] **Step 6.2：agent.md self×readable —— 改为自定义 readable**

`### self × readable` 段：由"agent 通常无自定义 readable module（走框架默认投影）"改为"**agent 自定义 readable module 渲 data.self**；renderer 经 registry 派发 persistable.load hydrate self 门面窗 data 后交本 module 投影"。§四程序骨架的"agent 自定义了 executable + persistable + construct，无自定义 readable"改为"+ readable"，文件布局加 `readable/index.ts`。

- [ ] **Step 6.3：agent.md self×persistable —— self.md 实现归属**

`### self × persistable` 段补一句：self.md 读写实现（readSelf/writeSelf）落 agent builtin `persistable/self-md.ts`，core 经依赖 import（同 thread 持久化下沉）。

- [ ] **Step 6.4：core 9 / readable self.md 核对**

`children/object/self.md` 核心 9 关于 self.md 的论述无需改（已正确：agent 独有）；若其列了 agency 含 todo/end 则同步。`children/readable/self.md` 若断言"agent 走默认投影"则更新。

- [ ] **Step 6.5：commit + push ooc-0**

```bash
cd .ooc-world-meta/stones/main
git add -A && git commit -m "docs(agent): agency 收 talk/plan(end/todo 归 thread) + self×readable 自定义渲 data.self + self.md 实现归 builtin"
git push origin main
```
（父仓不跟踪对象树内容，无需 bump。）

---

## Task 7：grep 全树收口（退役符号）

- [ ] **Step 7.1：源码无 core stone-self 残留**

Run: `grep -rn "core/persistable/stone-self\|persistable/stone-self" packages --include="*.ts"`
Expected: 空。

- [ ] **Step 7.2：列出待修测试账本**

Run: `grep -rln "readSelf\|writeSelf\|selfFile" packages --include="*.ts" | xargs grep -l "@ooc/core/persistable\|from \"../.*persistable\"\|stone-self" 2>/dev/null | grep test`
把每个 test 文件 + 其 import 行记入下方账本（Task 8 逐个改）。

- [ ] **Step 7.3：（端点保留，无需处理 PUT /self）**

PUT /self 端点本次保留——TC-PERS-02 与 putSelf 测试**应继续通过**（仅底层 writeSelf 换了 import）。无需删/改其用例。

---

## Task 8：测试统一修 + 全绿（消化账本）

**已知断裂（账本，实现时按 Task 7 grep 补全）：**
- 大量测试 import `readSelf`/`writeSelf`/`selfFile` 自 `@ooc/core/persistable` 或 `../stone-self` → 改到 `@ooc/builtins/agent/persistable/self-md.js`（部分 e2e 用 `@ooc/core/persistable` barrel——确认 barrel 是否仍 re-export；不再 re-export 则全部改 builtin 路径）。涉及：`core/persistable/__tests__/stone.test.ts`、`builtin-read.test.ts`、`session-aware-read.test.ts`、`core/executable/__tests__/{evolve-self,process,create-object}.test.ts`、`core/thinkable/__tests__/{context,real-compress,real-compress-v2}.test.ts`、`core/app/server/bootstrap/instantiate-classes.test.ts`、`tests/integration/*`、`storybook/stories/thinkable.story.ts` 等（以 Task 7.2 grep 为准）。
- PUT /self 测试（server.e2e.test.ts / service.test.ts / TC-PERS-02）：端点保留，**应继续通过**——若失败说明 writeSelf 重定向有误，修源不删测试。
- agent executable 旧测试若 import `agent/executable/method.end|todo` → 改 `children/thread/executable/...`。

- [ ] **Step 8.1：逐文件改 import 路径**

按账本把 `readSelf`/`writeSelf`/`selfFile` 的 import 改到 `@ooc/builtins/agent/persistable/self-md.js`。**不删任何端点用例**。

- [ ] **Step 8.2：跑 storybook gate**

Run: `bun run test:storybook`
Expected: 0 FAIL（≥ Step 0.2 基线通过数）。

- [ ] **Step 8.3：跑受影响维度测试**

Run: `bun test packages/@ooc/core/persistable packages/@ooc/core/thinkable packages/@ooc/core/app/server/modules/stones packages/@ooc/builtins/agent 2>&1 | tail -30`
Expected: 全绿。逐个修剩余红。

- [ ] **Step 8.4：全量回归**

Run: 仓库既有全量测试命令（Run: `grep -n "\"test\"" package.json` 取脚本）。
Expected: 全绿（或 ≥ 基线）。残红逐个归因：是本次 import 漏改 / 还是行为回归（行为回归须停下核 P3 hydrate / createStone gate 是否引入语义变化）。

- [ ] **Step 8.5：commit**

```bash
git add -A && git commit -m "test: 统一 self-md import 路径到 agent builtin + 全绿"
```

---

## Task 9：真 LLM 端到端 smoke（行为保持验证）

- [ ] **Step 9.1：起 world + 后端**

按 storybook Tier B 约定起运行中 world（`--world ./.ooc-world`，见 CLAUDE.md 关键约束1）。session 用 `_test_selfmd_<timestamp>` 前缀，验后清理。

- [ ] **Step 9.2：验 self 门面窗身份仍上屏**

派一个有 self.md 身份的 agent 跑一轮，确认 context 里 self 门面窗渲出 data.self 身份正文（P3 hydrate + agent readable 生效）、且 agency 工具面只剩 talk/plan、过程窗（thread）surface end/todo。

- [ ] **Step 9.3：验 displayName 降级**

确认非 agent object（如工具 object）无 self.md 时前端 displayName 落 objectId、无 500（GET /self 返回 `{text:""}`）。

- [ ] **Step 9.4：清理测试 session**

删 `_test_selfmd_*` flows。

---

## Self-Review 覆盖核对（spec → plan）

- spec §三 Task2 → 本 Task 1 ✓
- spec P1（stone-self 下沉 + createStoneObject 停建）→ Task 2 + Task 5 ✓
- spec P2（不删端点、仅 import 重定向）→ Task 5.4/5.5 ✓
- spec P3b（agent readable + renderer hydrate 去 readSelf）→ Task 3 ✓
- spec P4（createStone 仅 agent 写 + displayName 降级）→ Task 4 + Task 9.3 ✓
- spec §四工程纪律（测试延后 + 账本）→ Task 7/8 ✓
- spec §三对象树 agent.md 回流 → Task 6 ✓
- spec §六范围外（visible 写方法 / displayName 协议）→ 不建任务（明确不做）✓
