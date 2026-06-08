# Plan: 重新设计 OOC 的 Context + Knowledge 系统

## Context（为什么做这件事）

当前 OOC 的 context 系统在骨架层面做对了几件核心的事：**Context = 视角而非归属**的引用语义、**ContextWindow = Object in Context** 的统一抽象、**渐进式执行 + 渐进式信息披露** 的 form 生命周期。这些是 OOC 区别于其他 Agent 框架的根本特征，必须保留。

但随着能力增加，系统出现了几个结构性问题：

1. **知识来源碎片化**：protocol 常量、stone seed `.md`、pool sediment `.md`、form `knowledge()`、显式 `open_knowledge`、peer 自动注入、creator-reply hint、end-reflection reminder——每个来源有独立的生命周期、渲染路径、持久化语义和激活机制。
2. **三条激活路径互不连通**：form 的 `match(args)` 派生路径、form 的 `knowledge(args, status)` 直接注入、knowledge `.md` 的 `activates_on` trigger map。三者互不连通，精细条件的知识只能写在代码常量里（如 `REFLECTABLE_METAPROG_KNOWLEDGE`），无法放在 stone `.md` 中声明式维护。
3. **Context 构建是一个 ~350 行的巨型函数**（`collectExecutableKnowledgeEntries`）：peer 注入、skill 合成、protocol 注入、activator 匹配、form enrichment、effectiveVisibleType 计算全部堆在一起，依赖关系不可见。
4. **预算/压缩完全是启发式的**：字符数估算、基于轮数的 `_decayMeta` 计数器、没有"重要性"的语义概念。LLM 也看不到"哪些窗口被压缩了、为什么"。
5. **渲染 = XML 字符串拼接**：没有中间语义表示，测试 context 内容必须解析 XML；切换输出格式需要重写整个渲染层。
6. **类型注册是渲染期的副作用**：peer/self 的 ObjectType 在每轮渲染中懒注册到全局 module-level registry——调用方看不到、多 world 并发会污染。

本设计的目标：在严格保留 **ContextWindow / Object in Context** 和 **渐进式执行 + 渐进式信息披露** 两个核心概念的前提下，把上述问题系统性地解决掉。

**核心设计决策前置**：

1. **旧 `match()` 的意图识别去哪了**：由新接口 `ObjectMethod.intent(args) → [{name, tags?}]` 承接。intent 信号统一表达了"method 开始执行"和"method 子任务识别"两层含义——因为执行 method 本身就是一种意图。知识（stone `.md` frontmatter）直接订阅 `intent_name`。
2. **旧 `knowledge()` 的主动注入去哪了**：由 `ObjectMethod.onFormChange(change, {form, intents}) → ContextWindow[]` 完整承接。change 参数覆盖三种场景：args refine（检测"填了 content 但要 msg"类字段错误）、status 切换（open→executing→success|failed）、intent 变化。返回的 window 渲染为 form 的 `<guidance>` 子节点（form 在信息就在，不受 transcript 折叠影响）。
3. **知识激活粒度**：只保留 **intent 级**。method 自身启动 = 一个 intent（method 名本身）；子任务 = 额外的 intent（如 `program.shell`）。不做 `arg_changed` 级订阅，也不做单独的 `method:started` 事件——两者都被 intent 统一表达。
4. **性能：懒加载**。intent 计算与知识关联不是每次构造 LLM Input 都重跑，而是只在 form 更新、intent 更新时触发，结果缓存到 thread 级缓存中。
5. **知识自动卸载**：intent 变化时，自动卸载与当前 intent 无关、且没有被主动加载（provenance.kind != "explicit"）的知识 window。不引入完整的 lifecycle 机制。

---

## 设计：五个支柱

### 支柱 1：统一的 `ContextWindow` 模型 — 一切进入 context 的东西都是同一种东西

**名称保留 `ContextWindow`**（不叫 ContextItem）。所有进入 LLM 视野的实体共享一个统一的数据模型，在现有 `BaseContextWindow` 基础上扩展三个新字段（全部 optional，向后兼容）：

```typescript
interface ContextWindow extends BaseContextWindow {
  // 现有字段全部保留: id / type / parentWindowId / title / status / createdAt /
  // windowKnowledgePaths / sharing / compressLevel / _decayMeta / effectiveVisibleType

  // 第一-class provenance：为什么这个 window 在我的 context 里
  provenance?: {
    kind: "explicit" | "derived" | "system" | "related";
    // explicit: 用户/LLM 主动打开（open_file / open_knowledge / exec form）
    // derived:  由 signal/intent 匹配自动激活的知识
    // system:   session constants（basic、protocol、creator-reply…）
    // related:  peer discovery
    reason: {
      mechanism:
        | "user_open"      // 来自 LLM exec open_* 命令
        | "llm_exec"       // 来自 LLM exec 某业务 method
        | "intent_match"   // 通过 intent 订阅激活（声明式 .md 或 onFormChange）
        | "peer_discovery" // peer 自动注入
        | "form_bound"     // 绑到某个 form（如 guidance）
        | "session_constant";
      sourceId?: string;              // 触发它的 form id、匹配到的 intent 名等
      detail?: Record<string, unknown>;
    };
    createdAt: number;
    lastTouchedAt: number;
  };

  // 第一-class relevance：语义重要性，替代当前的 _decayMeta 轮数计数器
  relevance?: {
    score: number;                          // 0.0–1.0
    priorityHint?: "critical" | "high" | "normal" | "low";
    signalCount: number;                    // 最近 N 轮被引用次数（decaying counter）
  };

  // 绑定到某个 form id。intent 变化时，非 explicit 且 boundFormId
  // 不在活跃 form 集合中的 window 被自动卸载。
  boundFormId?: string;
}
```

**设计意图**：
- Provenance 让 LLM 和开发者都能回答"为什么我看得到这条知识"。
- Relevance 统一取代 `compressLevel`、`_decayMeta.idleRounds`、`_decayMeta.sinceExecRounds`、`_decayMeta.level1Rounds` 四个分散的状态字段。
- `boundFormId` 配合 provenance.kind 表达自动卸载规则：intent 变化时，`provenance.kind !== "explicit" && boundFormId` 指向的 form intent 已变化 → 自动卸载。不需要完整的 lifecycle 机制。
- 不引入 `persistence` 三态、`ttlRounds` 等复杂生命周期字段——先以最小机制跑通。

---

### 支柱 2：`Intent` 作为激活的统一原语 — method 作者的领域判断

**废弃**当前的三条独立激活路径。引入一个统一的抽象：**Intent**。

Intent = "当前 form 在做什么"。它是一个结构化的轻量信号，同时承载了"method 已启动"和"method 子任务识别"两层含义。

```typescript
interface Intent {
  name: string;                     // 稳定的语义标识符（如 "program"、"program.shell"、"open_file"）
  tags?: Record<string, unknown>;   // 可选的附加上下文（如 { language: "shell" }）
}
```

**Intent 信号的产生方式**：在 `ObjectMethod` 接口上新增可选的 `intent` 字段。每个 form 在创建时和每次 refine 后，系统会调用 `method.intent(args)`，得到当前的 intent 集合，并与上一轮缓存对比——**只有真正变化时才触发后续的知识重算**。

```typescript
interface ObjectMethod {
  // ... paths / exec / permission / public / for_ui_access 保留 ...

  /**
   * 从当前 args 推断 method 的意图集合（旧 match() 的继承者）。
   *
   * - method 自身名（如 "program"）总是作为默认 intent，不需要显式返回。
   * - 子任务识别返回额外 intent（如 "program.shell"、"program.typescript"）。
   * - 返回空数组 = 没有子意图，只有 method 默认 intent。
   *
   * 该函数返回的值会被缓存；只有 args 变更导致返回变化时，
   * 才会触发知识的自动卸载 + 重新激活。
   */
  intent?(args: Record<string, unknown>): Intent[];

  /**
   * Method 主动披露信息的统一入口（旧 knowledge() 的继承者）。
   *
   * 在 form 发生任何有意义的变化时被调用，包括：
   *   - args refine（参数值变化，可用于检测"填了 content 但实际要 msg"这类字段名错误）
   *   - form status 切换（open → executing → success | failed）
   *   - intent 集合变化（由 args refine 派生）
   *
   * change 参数让 method 作者精确感知变化类型；intents 参数给出当前最新的 intent 集合。
   * 返回的 ContextWindow 渲染为 form 的 <guidance> 子节点（form 在信息就在，不受 transcript 折叠影响）。
   *
   * 调用频率由缓存控制：只有 change 真正发生时才调用，不是每轮 buildContext 都调。
   */
  onFormChange?(
    change:
      | { kind: "args_refined"; added: string[]; removed: string[]; changed: string[]; args: Record<string, unknown> }
      | { kind: "status_changed"; from: MethodCallWindow["status"]; to: MethodCallWindow["status"] }
      | { kind: "intent_changed"; from: Intent[]; to: Intent[] },
    ctx: { form: MethodCallWindow; intents: Intent[] },
  ): ContextWindow[];

  /** 参数 schema（声明式，用于 form readable + refine 校验）。详见支柱 4。 */
  schema?: MethodCallSchema;
}
```

典型实现：

```typescript
// program method
intent: (args) => {
  const lang = args.language ?? args.lang;
  if (lang === "shell") return [{ name: "program.shell" }];
  if (lang === "ts" || lang === "typescript") return [{ name: "program.typescript" }];
  if (lang === "js" || lang === "javascript") return [{ name: "program.javascript" }];
  return [];  // 只有默认 intent "program"
},

onFormChange(change, { form, intents }) {
  const windows: ContextWindow[] = [];

  if (change.kind === "args_refined") {
    if ("content" in change.args && !("msg" in change.args)) {
      windows.push({
        id: `guidance_${form.id}_wrong_param`,
        type: "form_guidance",
        parentWindowId: form.id,
        title: "参数名提示",
        status: "active",
        createdAt: Date.now(),
        boundFormId: form.id,
        provenance: {
          kind: "derived",
          reason: { mechanism: "form_bound", sourceId: "args_refined" },
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
        },
        relevance: { score: 0.95, priorityHint: "critical", signalCount: 1 },
      });
    }
  }

  if (change.kind === "intent_changed" || change.kind === "args_refined") {
    windows.push({
      id: `guidance_${form.id}_basic`,
      type: "form_guidance",
      parentWindowId: form.id,
      title: "program 使用说明",
      status: "active",
      createdAt: Date.now(),
      boundFormId: form.id,
      provenance: {
        kind: "derived",
        reason: { mechanism: "intent_match", sourceId: "program" },
        createdAt: Date.now(),
        lastTouchedAt: Date.now(),
      },
      relevance: { score: 0.9, priorityHint: "high", signalCount: 1 },
    });

    if (intents.some(i => i.name === "program.shell")) {
      windows.push({
        id: `guidance_${form.id}_shell`,
        type: "form_guidance",
        parentWindowId: form.id,
        title: "shell 模式提示",
        status: "active",
        createdAt: Date.now(),
        boundFormId: form.id,
        provenance: {
          kind: "derived",
          reason: { mechanism: "intent_match", sourceId: "program.shell" },
          createdAt: Date.now(),
          lastTouchedAt: Date.now(),
        },
        relevance: { score: 0.8, priorityHint: "normal", signalCount: 1 },
      });
    }
  }

  if (change.kind === "status_changed" && change.to === "failed") {
    windows.push({
      id: `guidance_${form.id}_failed`,
      type: "form_guidance",
      parentWindowId: form.id,
      title: "执行失败",
      status: "active",
      createdAt: Date.now(),
      boundFormId: form.id,
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId: "status_changed:failed" },
        createdAt: Date.now(),
        lastTouchedAt: Date.now(),
      },
      relevance: { score: 1.0, priorityHint: "critical", signalCount: 1 },
    });
  }

  return windows;
},
```

**向后兼容**：如果 method 没有 `intent()` 但有旧的 `match()`，自动从 match 输出派生 intent（每个额外 path 变成一个 intent）。如果两者都没实现，只有 method 名本身作为默认 intent。

#### 声明式知识（stone `.md`）的订阅

`activates_on` 从 trigger map 升级为 **intent pattern**。知识作者只需要写 intent 名：

```yaml
# stones/<self>/knowledge/stone-versioning.md
---
title: Stone Versioning
description: 修改 stone 目录下文件时必须走的版本化流程
activates_on:
  # 精确匹配 intent 名
  - pattern: { intent_name: "write_file.stone_scope" }
    level: show_content
  # 前缀匹配（program.* 匹配 program、program.shell、program.typescript…）
  - pattern: { intent_name: "program.shell" }
    level: show_description
---

## Stone Versioning 协议
...正文...
```

`intent_name` 支持精确匹配和前缀匹配（`"program.*"`）。不支持 `arg_changed` 级订阅。

#### 懒加载机制（性能）

```
ThreadContext
  └─ intentCache: Map<formId, {
       argsHash: string;
       status: MethodCallWindow["status"];
       intents: Intent[];
       derivedWindows: ContextWindow[];
     }>

触发重算的时机（仅此三处，对应 onFormChange 的三种 change kind）：
  1. form 创建（openCommandExec）→ 计算 intent + 激活知识 → 写入 cache
  2. form refine（manager.refine）→ 比较 argsHash → 若变化 → 重算 intent + 比较 intent → 卸载旧 derived + 激活新知识 → 更新 cache
  3. form status 切换（manager.submit 的 open→executing→success|failed，或 refine 的 failed→open）→ 触发 onFormChange({kind:"status_changed"}) → 更新 cache

buildContext（构造 LLM Input 时）：
  → 直接读 intentCache，不重算 intent，不重跑知识匹配
```

argsHash 用 `JSON.stringify(accumulatedArgs)` + 稳定排序（或更轻量的稳定哈希），O(1) 比较。

#### intent 变化时的自动卸载

规则（仅一条，不引入完整 lifecycle）：

> 当 form F 的 intent 集合从 S_old 变成 S_new：
>   遍历 thread.contextWindows 中所有 provenance.kind !== "explicit" 且 boundFormId === F.id 的 window。
>   如果该 window 的 provenance.reason.sourceId（触发它的 intent 名）不在 S_new 中 → 自动卸载。
>   新 intent 匹配到的知识 → 自动加载（派生新的 ContextWindow，boundFormId=F.id）。

provenance.kind === "explicit" 的 window（LLM/用户主动 `open_knowledge` 打开的）不受影响。

---

### 支柱 3：`ContextPipeline` — 显式阶段化的构建管线（懒加载友好）

**废弃** `collectExecutableKnowledgeEntries` 巨型函数。替换为分阶段管线：

```
buildContext 被调用
  │
  ▼
Phase 1: IntentCacheReader（O(1)）
  · 从 thread.intentCache 读每个活跃 form 的已缓存 intent + derived windows
  · 不再做任何计算
  │
  ▼
Phase 2: BaseWindowLoader
  · 加载 thread.contextWindows 中所有已持久化的 base windows
    （显式打开的 file/plan/talk/do/显式 knowledge…）
  · 每个 window 带 provenance.kind
  │
  ▼
Phase 3: Processors[]（有序，可插拔）
  │
  ├─ KnowledgeProcessor（声明式知识，读 cache）
  │    · 遍历活跃 form 的 intentCache.intents
  │    · 用 knowledge frontmatter 声明的 intent pattern 匹配
  │    · 产出 provenance.kind="derived"、boundFormId=<formId> 的 knowledge windows
  │    · ⭐ 注意：命中结果按 formId 缓存，intent 不变时跳过
  │
  ├─ MethodFormProcessor（命令式知识 = 旧 knowledge() 的继承者）
  │    · 对每个活跃 form，读 intentCache
  │    · 当 form 发生 args_refined / status_changed / intent_changed 时，
  │      调 method.onFormChange(change, {form, intents}) → 返回 guidance windows
  │    · 结果挂到 form 的 <guidance> 子节点
  │    · ⭐ 注意：form 无变化时 cache hit，直接返回上轮结果
  │
  ├─ PeerProcessor
  │    · 从 stone 层级结构 + 活跃 talk 窗口收集 peers
  │    · 产出 provenance.kind="related" 的 peer windows
  │
  └─ SystemProcessor
       · 产出 session constants（basic / root guidance）
       · 产出 creator-reply protocol（如果有 creator window）
       · 产出 end-reflection reminder（如果有 end form 且非 super）
  │
  ▼
Phase 4: BudgetManager
  · 为每个 window 计算 relevance.score
  · 按 relevance 排序
  · 估算 token 预算（调用 llmClient 的实际 tokenizer）
  · 低 relevance 折叠进 overflow
  │
  ▼
Phase 5: Renderer（可插拔）
  ├─ XmlRenderer     → LLM 输入（保持向后兼容的 XML 格式）
  ├─ JsonRenderer    → 前端 context snapshot / debug API
  └─ TraceRenderer   → 人类可读的调试报告
```

**关键约束**：
- **SkillProcessor 不纳入本次改造**。skill_index 合成逻辑暂时保留在原 synthesizer 中，后续独立处理。
- Phase 1-3 的 Processor 结果都带 `(formId, intentHash)` 级缓存。`buildContext` 绝大多数轮次是 cache hit，成本 = 读取 + 拼接。
- 只有 `manager.openCommandExec` 和 `manager.refine` 这两个操作会使 cache 失效并触发重算。

---

### 支柱 4：Method Call（form）作为结构化的一等 ContextWindow — 含 MethodCallSchema

把 `CommandExecWindow`（type=`method_exec`）升级为带 schema 和 fill 状态的一等 ContextWindow。

#### MethodCallSchema 的定义（新增）

MethodCallSchema = method 的参数声明。描述每个参数的类型、是否必填、默认值、说明、校验规则。用于三个地方：
1. **form readable 渲染**：自动生成 `<schema>` / `<fill_state>` / `<next_steps>` XML 节点。
2. **refine 校验**：`manager.refine` 用 schema 校验入参，填错时在 fill_state 标注 `invalid`。
3. **intent 推断辅助**：schema 描述可以帮助 LLM 理解需要填什么（但不影响 intent 计算本身）。

```typescript
/**
 * Method 参数 schema。
 *
 * 设计原则：
 * - 纯 JSON-serializable，不带函数，便于从 .md frontmatter 或未来的
 *   type-gen 工具中生成。
 * - 可选。未声明 schema 的 method 走当前 accumulatedArgs 裸 JSON 渲染，行为不变。
 * - 校验是 fail-soft：校验失败在 fill_state 标 invalid + error 消息，
 *   不阻断 refine（与当前 refine 的宽松语义一致）。
 */
export interface MethodCallSchema {
  args: Record<string, MethodArgSpec>;
}

export interface MethodArgSpec {
  /** 参数类型。字符串类型足够表达 form readable 和基础校验。 */
  type: "string" | "number" | "boolean" | "array" | "object" | "any";

  /** 是否必填。影响 next_steps 和 XML fill_state 的 missing/provided 标记。 */
  required?: boolean;

  /** 默认值（可选）。refine 时缺参数且有 default → 自动填入 fill_state。 */
  default?: unknown;

  /** 人类可读说明，渲染在 <schema><arg> 的 text 节点和 next_steps 中。 */
  description?: string;

  /**
   * 枚举可选值。渲染时在 description 后追加 "(可选: a, b, c)"。
   * refine 校验时若值不在 enum 中 → invalid。
   */
  enum?: Array<string | number | boolean>;

  /**
   * 基础值校验（可选，纯声明式，不支持函数）。
   * 不满足时 fill_state.status = "invalid"，并填入 error 消息。
   */
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;       // 正则字符串
    minimum?: number;
    maximum?: number;
    customMessage?: string; // 校验失败时显示的自定义错误
  };
}
```

schema 声明示例（open_file method）：

```typescript
schema: {
  args: {
    path: {
      type: "string",
      required: true,
      description: "文件路径（绝对路径，或相对 session baseDir）",
    },
    lines: {
      type: "array",
      required: false,
      description: "行范围 [start, end]，0-based，end 行不包含",
    },
    columns: {
      type: "array",
      required: false,
      description: "列范围 [start, end]，通常与 lines 配合定位",
    },
  },
},
```

#### MethodCallWindow 扩展后的类型

```typescript
interface MethodCallWindow extends BaseContextWindow {
  type: "method_exec";
  parentWindowId: string;
  command: string;                              // 保留，兼容
  description: string;                          // 保留，兼容

  // 新增：来自 ObjectMethod.schema（未声明时为 undefined）
  schema?: MethodCallSchema;

  // 新增：结构化的 fill state（替代 accumulatedArgs 的无结构 Record）
  // 未声明 schema 时为 undefined，继续用 accumulatedArgs
  fill?: {
    [argName: string]: {
      status: "missing" | "provided" | "invalid";
      value?: unknown;
      error?: string;
      source: "initial" | "refine" | "default";
      refinedAt?: number;  // 最近一次填值的时间戳
    };
  };

  // 原有字段，保留兼容
  accumulatedArgs: Record<string, unknown>;
  commandPaths: string[];
  loadedKnowledgePaths: string[];
  commandKnowledgePaths?: string[];
  status: "open" | "executing" | "success" | "failed";
  result?: string;
}
```

#### XML 渲染（XmlRenderer）

未声明 schema 的 method → 保持当前 `<accumulated_args>` 渲染不变。

声明了 schema 的 method → 在原有标签后**追加**结构化标签：

```xml
<method_call id="f_abc" command="write_file" parent_window_id="root" status="open">
  <description>将内容写入目标路径</description>
  <accumulated_args>{"path":"/path/to/stones/x"}</accumulated_args>

  <!-- ⭐ 新增：schema + fill_state（schema 声明了才渲染） -->
  <schema>
    <arg name="path" type="string" required="true">写入路径</arg>
    <arg name="content" type="string" required="true">文件内容</arg>
    <arg name="scope" type="string" required="false">stone | pool | flow（默认自动推断）</arg>
  </schema>
  <fill_state>
    <arg name="path" status="provided">/path/to/stones/...</arg>
    <arg name="content" status="missing" />
    <arg name="scope" status="invalid" value="bad_value">错误：scope 必须是 stone/pool/flow</arg>
  </fill_state>

  <!-- ⭐ form guidance（由 onFormChange 返回）——form 在信息就在 -->
  <guidance id="guid_f_abc_basic" priority="high">
    path 指向 stones/ 目录，提交前必须走 stone-versioning 流程。
  </guidance>

  <next_steps>
    <step priority="1">提供 content 参数</step>
    <step priority="2">修正 scope 参数或留空让系统自动推断</step>
    <step priority="3">submit 执行</step>
  </next_steps>
</method_call>
```

**设计意图**：
- schema 完全可选，未声明的 method 行为 100% 不变。
- `<guidance>` 是 form 的子节点，继承 form 的 relevance，不会被 BudgetManager 单独溢出——解决"transcript compress 后信息丢失"问题。
- `<next_steps>` 由 schema.required + fill_state 自动派生，不需要 method 作者手写。

---

### 支柱 5：预算管理 + 多格式渲染 + 启动期注册

这三根支柱与原 plan 一致，不受本次简化影响，简述如下。

#### BudgetManager

**废弃** `_decayMeta` 四字段计数器 + 字符数粗估。替换为基于 relevance 的语义排序 + 真实 tokenizer 估算：

```typescript
class BudgetManager {
  score(w: ContextWindow): number {
    // provenance.kind 权重 + recency 时间衰减 + signalCount + priorityHint 加权求和 → 0.0–1.0
  }
  allocate(items: ContextWindow[], totalBudget: number): Allocation {
    // 按 score 降序逐个累加真实 token 估算
    // 超预算的放入 <context_overflow>
    // boundFormId 的 guidance 继承父 form 的 score，不单独溢出
  }
}
```

渲染时溢出窗口出现在统一的 `<context_overflow budget_used budget_total>` 节，LLM 可通过 `expand(window_id)` 拉回。

#### Renderers

**废弃**渲染层直接产出 `XmlNode[]`。引入 `ContextSnapshot` 中间表示：

```typescript
interface ContextSnapshot {
  thread: { id: string; status: ThreadStatus };
  self: { objectId: string };
  windows: ContextWindow[];       // BudgetManager 分配后的最终集合
  overflow: Array<{ id: string; title: string; relevance: number; reason: string }>;
  trace: {
    intents: Record<string, Intent[]>;    // formId → intents（调试用）
    perWindow: Record<string, { matchedIntent: string; producedBy: string }>;
  };
}

interface Renderer {
  render(snapshot: ContextSnapshot): string | Uint8Array | unknown;
}
// XmlRenderer / JsonRenderer / TraceRenderer
```

测试 context 构建直接断言 `ContextSnapshot`，不需要解析 XML。

#### 启动期注册

**废弃**渲染期对 `defaultObjectRegistry` 的懒注册。改为 `WorldRuntime` 启动时 `ObjectTypeRegistrar.run()` 一次性注册所有 builtin + stone-backed types，并建立热更新 watcher。pipeline 的所有 phase 只读不改 registry。

---

## 对现有系统的向后兼容策略

### 能力映射表：旧 → 新

| 旧设计 | 新设计中的对应位置 |
|--------|-------------------|
| `ObjectMethod.match(args) → string[]`（意图识别 + 特性标记） | `ObjectMethod.intent(args) → Intent[]`。method 名本身是默认 intent；子任务识别返回额外 intent。旧 `match()` 保留为 `@deprecated`，内部自动转换为 intent。 |
| `ObjectMethod.knowledge(args, status) → Record<path, body>` | `ObjectMethod.onFormChange(change, {form, intents}) → ContextWindow[]`。覆盖三种 change：args_refined（检测字段名错误等）、status_changed、intent_changed。只在 form 真正变化时调用（非每轮）。返回的 guidance 是 form 子节点，不被 transcript 折叠。 |
| knowledge `.md` `activates_on` trigger map | 升级为 intent pattern。旧 trigger 字符串（如 `"method::root::program"`）自动翻译为 `{ intent_name: "program" }`。只支持 intent 粒度，不支持 arg_changed。 |
| `form.commandPaths` | 由 intent 集合替代。intent 集合显式渲染在 form 的 `<activation_trail>` 中。 |
| `_decayMeta.{idleRounds,ageRounds,level1Rounds,lastSeenEventIdx}` | `ContextWindow.relevance`（score + signalCount + priorityHint）。旧字段在读取时迁移为 relevance 初值。 |
| `compressLevel: 0 \| 1 \| 2` | BudgetManager 的语义排序 + `<context_overflow>`。旧值映射为 relevance 初值。 |
| protocol constants | SystemProcessor 产出。内容不变。 |
| `synthesizer:derivePeerObjectWindows` | PeerProcessor。 |
| skill_index 合成 | **不纳入本次改造**，暂时保留在原位置。 |

### 分阶段落地

| 阶段 | 落地内容 | 兼容策略 |
|------|----------|----------|
| P1 | 支柱 5 之启动期注册 + per-world registry | 保留 `defaultObjectRegistry` 兼容导出 |
| P2 | 支柱 1：`ContextWindow` 扩展 provenance / relevance / boundFormId | 三个新字段全部 optional，旧代码不感知 |
| P3 | 支柱 2：Intent 原语 + onFormChange + MethodCallSchema 类型 + 懒加载缓存 | 保留 `match()` / `knowledge()` 为 deprecated，内部自动转换。schema 可选。 |
| P4 | 支柱 4：MethodCallWindow 结构化渲染 | 新 XML 标签是**追加**的，旧标签完整保留 |
| P5 | 支柱 3：ContextPipeline（不含 SkillProcessor） | `collectExecutableKnowledgeEntries` 变成 pipeline 的薄 wrapper，skill_index 暂时从原路径注入 |
| P6 | 支柱 5 之 BudgetManager + Renderers | XML 格式保持不变（追加 `<context_overflow>`） |
| P7 | 清理 deprecated alias | `match` / `knowledge` 旧签名、module-level registry 等 |

---

## 关键文件（按落地阶段）

**新增文件**：
- `packages/@ooc/core/thinkable/context/types.ts` — ContextWindow 扩展字段（provenance/relevance/boundFormId）的类型导出
- `packages/@ooc/core/thinkable/context/intent.ts` — `Intent` 类型、`intentCache` 管理（read/write/invalidate）、`MethodCallSchema` + `MethodArgSpec` 类型
- `packages/@ooc/core/thinkable/context/pipeline.ts` — `ContextPipeline` 骨架 + Phase 接口
- `packages/@ooc/core/thinkable/context/processors/knowledge.ts` — KnowledgeProcessor（intent pattern → knowledge windows）
- `packages/@ooc/core/thinkable/context/processors/method.ts` — MethodFormProcessor（`onFormChange` 调用，含 args_refined/status_changed/intent_changed 三种 change 分发）
- `packages/@ooc/core/thinkable/context/processors/peer.ts` — PeerProcessor
- `packages/@ooc/core/thinkable/context/processors/system.ts` — SystemProcessor
- `packages/@ooc/core/thinkable/context/budget.ts` — BudgetManager
- `packages/@ooc/core/thinkable/context/snapshot.ts` — ContextSnapshot 类型
- `packages/@ooc/core/thinkable/context/renderers/xml.ts` — XmlRenderer
- `packages/@ooc/core/thinkable/context/renderers/json.ts` — JsonRenderer
- `packages/@ooc/core/thinkable/context/renderers/trace.ts` — TraceRenderer
- `packages/@ooc/core/runtime/object-type-registrar.ts` — World-level registrar

**修改文件**：
- `packages/@ooc/core/executable/windows/_shared/command-types.ts` — `ObjectMethod` 加 `intent()` + `onFormChange()` + `schema`（保留 `match`/`knowledge` 为 deprecated）。导出 `MethodCallSchema` 类型
- `packages/@ooc/core/executable/windows/_shared/types.ts` — `BaseContextWindow` 加 provenance/relevance/boundFormId（optional）
- `packages/@ooc/core/executable/windows/method_exec/types.ts` — `MethodCallWindow` 加 schema/fill 字段（optional）
- `packages/@ooc/core/executable/windows/_shared/manager.ts` — `openCommandExec` / `refine` / `submit` 三处触发 onFormChange（分别对应 intent_changed / args_refined / status_changed）+ 写 intentCache；refine 时按 schema 做校验（fail-soft）填充 fill_state
- `packages/@ooc/core/thinkable/knowledge/triggers.ts` — 升级为 intent pattern 解析器（只支持 intent_name 精确/前缀），保留旧 trigger 格式自动迁移
- `packages/@ooc/core/thinkable/knowledge/synthesizer.ts` — 逐步下线，**skill_index 合成暂时保留**
- `packages/@ooc/core/thinkable/context/render.ts` — 逐步替换为 XmlRenderer，旧实现保留为 fallback
- `packages/@ooc/core/thinkable/context/index.ts` — `buildInputItems` 改为 ContextPipeline 的薄 wrapper
- `packages/@ooc/core/runtime/world-runtime.ts` — 启动时调用 ObjectTypeRegistrar
- `packages/@ooc/core/runtime/object-registry.ts` — 从 module-level default 改为 per-world 实例（保留兼容导出）

---

## 验证策略

### 单元测试

1. **intent() + intentCache**：对 program / do / say / continue / todo / search / feishu.send 等内置 method，测试 intent() 在典型 args 下的输出与旧 match() 语义一致。测试 args 不变时 cache hit（不重算）、args 变时 cache miss（重算）。
2. **onFormChange 三种 change kind**：
   - `args_refined`：talk method 填了 `content` 但缺 `msg` → onFormChange 返回参数名纠错 guidance
   - `status_changed`：form open→executing→failed → onFormChange 返回失败恢复 guidance
   - `intent_changed`：program refine `language=shell` → 返回 shell-specific guidance
3. **intent 变化 → 自动卸载**：form 从 `intent={program, program.shell}` refine 到 `intent={program, program.typescript}` → 断言 provenance.kind=derived、boundFormId=该 form、sourceId=`program.shell` 的 window 被卸载；`program.typescript` 匹配到的新 window 被加载。
4. **explicit window 不被自动卸载**：同上场景，但某个 shell 知识是 LLM 主动 `open_knowledge` 打开的（provenance.kind="explicit"）→ 断言它不被卸载。
5. **KnowledgeProcessor（intent pattern）**：构造假 knowledge 索引 + Intent[]，断言匹配到的 ContextWindow 数量、provenance、boundFormId。覆盖精确匹配和前缀匹配（`program.*`）。
6. **MethodFormProcessor（onFormChange guidance）**：构造 method 返回 guidance windows，断言它们渲染为 form 的 `<guidance>` 子节点，且 transcript 折叠时 guidance 不丢失。
7. **MethodCallSchema + fill_state**：给定 schema + refine 序列，断言 fill_state 的 status 变化（missing→provided、invalid 错误消息）、next_steps 内容。未声明 schema 的 method 断言走 accumulatedArgs 旧路径。
8. **BudgetManager**：构造不同 provenance/priority/recency 的 windows，断言排序顺序和 overflow 边界。测试 form 的 guidance 继承 form relevance，不被单独溢出。
9. **Renderers**：同一个 ContextSnapshot 喂给三个 Renderer，断言各自输出格式。XmlRenderer 断言 `<guidance>` 出现在 `<method_call>` 内部。
10. **懒加载正确性**：连续调用 `buildContext` 3 次（form / thread 无变化），断言 Processor 的匹配函数只被调用 1 次（后两次 cache hit）。

### 集成测试（端到端）

1. **渐进披露链路（program method）**：启动 thread → exec `program`（缺参）→ refine `language=shell` → refine `code="ls"` → submit。每轮检查 fill_state、intent signal、stone knowledge 激活、`<guidance>` 节点、失败修复知识。
2. **glob vs grep 意图识别**：exec `search` 带 `path` → intent = `grep`；仅带 `glob` → intent = `glob`。对应知识正确激活。
3. **guidance 不被 transcript 折叠**：超长 transcript（>100 events，触发 events_summary 折叠）+ 含 guidance 的 form。断言 transcript 被折叠但 guidance 完整保留。
4. **预算溢出行为**：50+ 个低 relevance 旧窗口 + 1 个高 relevance todo → todo 在主 context，旧窗口在 overflow。
5. **向后兼容**：旧格式 thread.json（含 `_decayMeta`、`command_exec` type、旧 `activates_on` trigger 字符串、旧 `match()` 实现）启动，断言正常加载渲染，旧 match 输出自动转 intent。

### 人工验证（TraceRenderer）

跑 e2e 场景后检查 TraceRenderer 输出：
- 每个 window 的"为什么在 context 里"是否一句话能解释
- intent 集合是否与实际操作顺序一致
- Budget 排序是否符合直觉（explicit > derived > system > 长时间闲置的旧窗口）

---

## 风险与取舍

| 风险 | 缓解 |
|------|------|
| 去掉 arg_changed 粒度，声明式知识的表达力下降 | intent 已经是 method 作者的领域判断，比 arg_changed 更稳定。真需要精确参数值匹配或字段纠错的场景，method 作者在 `onFormChange` 的 `args_refined` change kind 里命令式判断。 |
| onFormChange 三种 change kind 让 method 作者需要判断 dispatch 路径 | 提供约定：① 参数纠错 / 输入提示 → `args_refined`；② 执行状态反馈 → `status_changed`；③ 子任务特定知识 → `intent_changed`。写在 ObjectMethod 接口 JSDoc 中。 |
| MethodCallSchema 增加 method 作者定义成本 | schema 完全 optional，未声明时行为不变。后续可从 TypeScript 函数签名自动生成。 |
| provenance/relevance 让 ContextWindow 体积膨胀 | 持久化时 strip provenance.detail、只保留 relevance.score，不保留权重分项。 |
| intent 名改动导致知识 frontmatter 静默失效 | 知识加载时校验引用的 intent_name 是否在该 method 已知 intent 集中，不存在则 warn（fail-soft）。 |
