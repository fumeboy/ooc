# OOC-4 L4 设计：活路径 prototype-chain 解析 + command→method 归一

**Date**: 2026-05-30
**Author**: Supervisor（Claude Code 主会话）
**Status**: Design spec — pending implementation plan（**实现交 fresh 会话**，见 §12）
**Branch**: `ooc-4`
**Relation**: 落地伞 spec `docs/superpowers/specs/2026-05-30-ooc-4-incremental-object-unification-design.md` §3（原型链）/ §4（方法可见性）/ §5.1（A 类迁移）/ §7（web）/ §13（词汇）的**活路径接入**部分。依赖已落地的 L2（`src/executable/prototype/` 原型链引擎，commit 6dd10cf2）+ L3（`src/extendable/base/` 8 原型源码 + `loadBuiltinRegistry`，commit d5a840a7）。

---

## §0 目标与范围

把「运行时 context window 靠 `window.type` enum 查全局 per-type registry 取 behavior」**改为**「靠 window 的 prototype canonical id，经 L2 `resolveAlongChain` + L3 base registry 沿 `extends` 链解析 behavior」。终态删除 per-type `WindowRegistry`（Option A，无永久 shim）。并把 `command` 术语归一为 `method`（context window command = object method）。

**纳入 L4**：
- prototype-chain 活路径解析（method / renderXml / readable / basicKnowledge 四个方面沿链）。
- 7 个 A 类 window behavior 转写进 `src/extendable/base/<proto>/executable/index.ts`。
- A 类原型的 `self.md` / `readable.md` 改为 **in-character**（料源 = 现有 window 的 basicKnowledge / renderXml / method knowledge 文本）。
- `loadSelfInstructions` 注入 `parseSelfMeta` 的 body（剥 frontmatter）。
- `command` → `method` 术语归一（含 agent-facing 协议，见 §4）。
- method 可见性 `public` / `for_ui_access`（spec §4）。

**不纳入 L4**（明确排除）：
- `onClose` / `compressView` 的沿链解析——这两个方面**仍由收缩中的 registry 服务**（对所有 window，含 A 类），延后到后续层。
- B 类（do/todo/talk/plan/relation）塌缩 = L5-6。
- per-type registry 的**彻底删除** = L6（B 类塌缩后）；L4 只让 A 类不再依赖它（method/render/readable/basicKnowledge 四方面）。
- visible/web 渲染（L8）。

---

## §1 基线（今天怎么工作）

运行时 window 实例只带 `type` enum（`src/executable/windows/_shared/types.ts` `BaseContextWindow.type`）。三个热路径靠它查全局单 Map：

| 调用点 | 现状 |
|---|---|
| `src/thinkable/context/render.ts:147` | `getWindowTypeDefinition(window.type).renderXml(ctx)` |
| `src/thinkable/context/render.ts:79` | `Object.keys(def.commands)` 列「可调命令」给 LLM |
| `src/executable/windows/_shared/manager.ts:82` | `getWindowTypeDefinition(parentWindow.type).commands[command]` |
| `src/executable/server/self.ts:41` | `getWindowTypeDefinition(window.type).commands` |

`getWindowTypeDefinition` 取自 `REGISTRY: Map<WindowType, WindowTypeDefinition>`（`_shared/registry.ts`）。**唯一 per-object 先例**：`custom` window 带 `objectId`，经 `loadObjectWindow(stoneRef)` 动态加载 `ObjectWindowDefinition`（与 base proto executable 同 shape）。新机制 = 把这条 per-object 路径升级为 per-prototype 沿链，并取代 type-enum 寻址。

---

## §2 核心机制

### 2.1 构件一：运行时 window 带 `prototype` id（寻址锚点）

`BaseContextWindow` 加字段：

```ts
interface BaseContextWindow {
  type: WindowType;        // 过渡期保留（B 类仍用）
  prototype?: string;      // 新增：canonical id, e.g. "ooc://stones/_builtin/objects/program"
  ...
}
```

- 寻址 key 从 `type`（enum）升级为 `prototype`（canonical id）。
- A 类 window 创建处（`manager.insertTypedWindow` 及各 window 工厂）赋 `prototype = builtinProtoId(type)`——过渡期由 `type` 桥接绑定。
- 持久化：`thread.json` window 多存一字符串；旧 window 无 `prototype` → 回退 `type`（向后兼容）。

### 2.2 构件二：从 `base/<proto>/executable/` 加载 behavior（dir-based loader）

`base/<proto>/executable/index.ts` 导出 `window: ObjectWindowDefinition`（`methods` / renderXml / basicKnowledge），与 custom object executable 同 shape。新 loader 复用现有 `loadObjectWindow` 的 dir 泛化（同 L3 把 `loadObjectRecord` 泛化为 dir-based）：

```ts
async function loadPrototypeDefinition(protoId: string): Promise<ObjectWindowDefinition> {
  const record = baseRegistry.get(protoId);     // L3 base registry: protoId → { dir, extends, ... }
  return importObjectWindow(record.dir);        // import(join(record.dir, "executable/index.ts"))
}
```

base 是 committed 源码、项目直跑 `bun src/`，可一次性 import + 缓存（§10 开放点 3 钉缓存策略）。

### 2.3 构件三：沿链 resolve（兑现 L2「一套 walk 三 probe」）

L2 `resolveAlongChain(registry, startId, probe)` 在此被消费——每个方面一个 probe，probe 内部加载该原型 executable 取对应成员：

```ts
function resolveMethod(protoId, name): MethodEntry | undefined {
  return resolveAlongChain(baseRegistry, protoId,
    rec => loadPrototypeDefinition(rec.id).methods?.[name])?.value;
}
function resolveRenderXml(protoId): RenderHook | undefined {
  return resolveAlongChain(baseRegistry, protoId,
    rec => loadPrototypeDefinition(rec.id).renderXml)?.value;
}
// resolveReadable / resolveBasicKnowledge 同构
```

### 2.4 沿链 merge 的两种语义

- **单成员解析**（`resolveMethod(name)` / `resolveRenderXml`）：own-first，第一命中即返回 → **子原型覆盖父**。一个 window 只渲染一次，取最近的 renderXml。
- **全集列举**（render.ts:79 列「这个 window 能调哪些 method」+ knowledge 合成）：`resolveAllMethods(protoId)` = root→own 合并、子同名覆盖父的 method 全集 → **通用方法（如 close）写在 root 原型、每个 A 类只写自己特有的**，继承自然生效。

---

## §3 热路径改写（无永久 shim）

统一入口分流，过渡期 A 类走链、B 类走收缩中的 registry：

```ts
function resolveRender(window): RenderHook {
  if (window.prototype && baseRegistry.has(window.prototype))
    return resolveRenderXml(window.prototype);            // A 类：链解析
  return getWindowTypeDefinition(window.type).renderXml;  // B 类：收缩 registry
}
```

改写点：
- `render.ts:147` → `(await resolveRender(window))(renderCtx)`
- `render.ts:79` 列 method 元数据 → `resolveAllMethods(...)`
- `manager.ts:82` `lookupCommandEntry` → `resolveMethod(parentWindow.prototype ?? viaType, name)`
- `self.ts:41` `callCommand` → 同

**A 类调用点真正走链解析**（非把 registry 伪装成链 = 被否的 C 方案）。`getWindowTypeDefinition` 仅在 B 类分支残留；L6 B 类塌缩后连分支一起删，入口变纯链解析。

**注**：`onClose` / `compressView` 不在本机制内——它们仍由 registry 服务（对所有 window，含 A 类），L4 不动（§0 排除）。即 L4 后 A 类 window 的 method/render/readable/basicKnowledge 走链，onClose/compressView 仍走 registry。

---

## §4 `command` → `method` 术语归一

伞 spec §1.1/§13：window command = object method，统一称 `method`。三层同步改（半改 = 陷阱，见经验教训）：

1. **内部类型/符号**（纯代码 rename）：`CommandTableEntry` → `MethodEntry`；`commands: Record<…>` → `methods`；`lookupCommandEntry` → `lookupMethodEntry`；`ROOT_COMMANDS` → `ROOT_METHODS`；`command-types.ts` → `method-types.ts`。
2. **form window 原型**：`command_exec`（方法调用表单）的 type/原型名是否改 `method_exec`——agent-facing + base proto 目录改名，**load-bearing**。
3. **agent-facing 协议**：LLM emit 的 `open(parent_window_id, command, args)` 的 `command` arg、以及所有 knowledge 文本里的「command」措辞 → 「method」。**凡 LLM 按字面 emit 的都 load-bearing，unit test 测不到，只在 harness 暴露**——必须同步，否则半改。

> 经验（来自 readme→readable）：agent-facing 字面量是隐形 load-bearing 面。本归一务必三层一次性同步，feasibility review 重点核查 seed/knowledge/协议里的字面 `command`。

---

## §5 过渡期共存

| window 类 | L4 后 method/render/readable/basicKnowledge | onClose/compressView | registry 角色 |
|---|---|---|---|
| A 类（program/search/file/knowledge/command_exec/skill_index/custom） | 沿原型链解析 | 仍走 registry（延后） | 不再服务前四方面 |
| B 类（do/todo/talk/plan/relation） | 仍走 registry | 仍走 registry | 全量服务 |

registry 跨 L4→L6 逐步死：L4 卸下 A 类的四方面；L5-6 B 类塌缩后 registry + B 类原型 + 过渡分支全删，入口变纯链解析。

---

## §6 两个特殊原型

- **`command_exec`（→ method_exec?）**：`refine`/`submit` **就是 WindowManager 的 API**（驱动 form 状态机），不是普通 method exec。`base/<它>/executable` 里这两个只是 **thin hook 声明 + knowledge**，exec 委托回 `manager.refine`/`manager.submit`；form 状态机不搬。
- **`custom`**：新机制下其特殊性**被吸收**——一个 custom window 本质是「`prototype` = 该 object 自己的 canonical id，`extends` 某 base 原型」。链解析天然处理：own object executable → 沿 extends → base 原型 → root。L4 保留 custom 兼容，归一（去掉特殊 type）可留收尾。**这是新机制最优雅的副产品**：现存唯一 per-object 先例正是终态特例。

---

## §7 behavior 转写 + in-character 文件 + frontmatter 剥离

- 7 A 类 window 的 methods / renderXml / basicKnowledge 转写进 `base/<proto>/executable/index.ts`（复用边界见伞 spec / Explore：program.exec→runOneExec、file.edit、search.open_match spawn file_window 等，能 copy 的 copy，耦合 _shared 的复用）。
- **同步把 `base/<proto>/self.md` / `readable.md` 改 in-character**：料源 = 这些 window 现有的 `basicKnowledge` / `renderXml` 输出 / method knowledge（本就 agent-facing、语气已对）。**绝不写上帝视角实现旁白 / roadmap 术语**（L3 教训，见 docs/superpowers 历史 + 项目记忆 feedback_agent_facing_voice）。
- **`loadSelfInstructions`（src/thinkable/context/index.ts:722）改注入 `parseSelfMeta` 的 body**（剥 `---extends---` frontmatter），否则原型变 live 后 frontmatter 噪声会被当指令喂 LLM。

---

## §8 method 可见性（spec §4）

每个 method 两正交布尔（声明在 `base/<proto>/executable/index.ts` 的 method metadata）：
- `public?`（默认 false）：false=仅自己 context；true=可被跨 Object / 他者 LLM emit 调。
- `for_ui_access?`（默认 false）：true=前端可直调（不经 LLM），取代旧 `ui_methods` 概念。

dispatcher 鉴权：跨 Object（`self.callCommand`）/ 他者 LLM emit → 仅 `public=true` 放行；前端 `/call_method` → 仅 `for_ui_access=true`。与现有 `MethodEntry.permission`（allow/ask/deny 准入）正交：permission 管「执行前要不要 HITL」，public/for_ui_access 管「谁能寻址到这个 method」。

---

## §9 一条完整链路 trace

LLM 在某 program window emit `exec`：
1. `manager.submit` → `resolveMethod(window.prototype="ooc://stones/_builtin/objects/program", "exec")`。
2. `resolveAlongChain` 从 program 起：probe(program)=`loadPrototypeDefinition(program).methods["exec"]` → **命中**（转写自 `executeProgramWindowExec`）→ 返回。
3. `entry.exec(ctx)` 跑（ctx 仍是 `CommandExecutionContext`/改名后 `MethodExecutionContext`，字段不变）。

同 window emit 通用 `close`：
1. `resolveMethod(program, "close")`：probe(program) miss → 沿 `extends: root` → probe(root) 命中 → 返回。
2. **专有方法写子原型、通用方法继承自 root**——原型链价值的直接体现。

---

## §10 开放实现问题（留给 writing-plans；已剔除 onClose/compressView）

1. **root 原型 executable 在 L4 放什么**：通用控制（close 等）放 root；talk/do/todo/plan 是 B 类、L5-6 才塌缩进 root 方法。L4 root executable = 占位 + 通用 close，明确边界避免与 B 类塌缩打架。
2. **`prototype` 字段赋值时机 + thread.json 向后兼容**（旧无字段回退 type）。
3. **proto definition 缓存策略**（源码一次性 vs 开发期 mtime hot-reload）。
4. **`resolveAllMethods` 的 merge 顺序与去重**（root→own，子覆盖父）。
5. **`command`→`method` 的 agent-facing 字面量清单**（seed/knowledge/协议里所有字面 command；feasibility review 必须穷举，否则半改）。
6. **`command_exec`/`method_exec` 原型是否随归一改名**（agent-facing + base dir 改名的连锁）。
7. **`MethodEntry` 加 `public`/`for_ui_access` 的声明形态** + dispatcher 鉴权接入点。

---

## §11 测试 gate

- A 类 window 经 prototype-chain 解析 render + method 调用（不再经 per-type registry 的 commands/renderXml）——单测 + e2e。
- 沿链兜底：子原型缺某 method → 解析到 root（如 close）。
- `command`→`method` 归一后 harness 全绿（含 agent-facing 协议 e2e）。
- method 可见性：`public=false` 跨 Object/他者 emit 被拒、同 Object OK；`for_ui_access` 控前端直调。
- route-audit：A 类原型 public method 有 HTTP 真路由。
- `loadSelfInstructions` 注入 body 不含 frontmatter。
- self.md/readable.md in-character（无 roadmap/实现术语）。
- `bun test src/` 全绿 + tsc 0 error + `bun tsc --noEmit meta/*.doc.ts`。

---

## §12 拆成子增量（fresh 会话逐个，每步 bun test 绿）

L4 是动 render+command 热路径的深度多文件手术，按纪律「真架构各自 fresh 会话、避免深上下文做跨多文件架构」拆：

| 子增量 | 内容 | gate |
|---|---|---|
| **L4.0** | `command`→`method` 术语归一（三层同步：内部符号 / form 原型 / agent-facing 协议）。行为不变、纯归一。 | harness 全绿（含 agent-facing 协议 e2e）|
| **L4.1** | 核心机制：`prototype` 字段 + dir-based proto loader + `resolveMethod`/`resolveRenderXml`/`resolveReadable`/`resolveBasicKnowledge` + 热路径分流改写。用**最简原型 `skill_index`**（0 method、纯渲染）端到端打通；含其 in-character 文件 + `loadSelfInstructions` 剥 frontmatter。registry 仍服务其余 + onClose/compressView。 | skill_index 经链渲染；registry 服务余下；bun test 绿 |
| **L4.2** | 转写其余 6 A 类（program/search/file/knowledge/command_exec/custom）behavior + in-character 文件，逐个。 | route-audit + A 类 method 调用 e2e |
| **L4.3** | method 可见性 `public`/`for_ui_access` + dispatcher 鉴权。 | 可见性 e2e |

每子增量：plan → feasibility review（对抗式）→ sub-agent 执行（不自 commit）→ harness 回归 → Supervisor 整合 commit。

**执行交接**：本会话只产出本设计 spec。L4 实现在 fresh 会话起，从 L4.0 开始（kickoff 交接模式）。

---

## §13 词汇对照（本层引入）

| 旧 | 新 |
|---|---|
| `CommandTableEntry` | `MethodEntry` |
| window `commands` 字段 | `methods` |
| `lookupCommandEntry` | `lookupMethodEntry` |
| `getWindowTypeDefinition(type)` | `resolveMethod/resolveRenderXml(prototypeId)`（沿链）|
| per-type `WindowRegistry` | base registry + 沿链解析（registry L6 删）|
| `ui_methods` | `for_ui_access` method |
| LLM emit `open(window, command, args)` | `open(window, method, args)` |
