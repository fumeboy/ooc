# builtins 权威定义梳理 + ooc core 改进方向（倒推）

> 产出日期 2026-06-15。本文是 **Supervisor 的工程分析产物**（`docs/` 下、纳入 git review），**不是对象树权威**。
> 对象模型权威是 `.ooc-world-meta/.../children/class/knowledge/object-model.md` + `class/self.md`；
> 11 个 builtin 家族的权威定义在 `.ooc-world-meta/.../children/class/knowledge/builtins/<id>.md`。
> 本文只**索引**它们、并把各家族倒推出的 core 改进方向**跨家族聚类去重**，给执行层（各 AgentOfX）派单依据。
>
> 关系基准：所有方向已与 `object-model.md`（核心 1-9 + 迁移映射）与 `class/self.md`（现状 / 已知问题 / 优化方向 1-4）对照——
> 标注「new」= class 维度尚未记录的新方向；「extends §X」= 落实/细化 class self.md 已有待办；「closes」= 回流已完成的过期待办。

---

## ① 本轮产出：11 份 builtins 索引

权威定义 doc（每份 = 该 builtin 家族的设计陈述 + 五件套对照 + 子对象 + 设计-源码差异）：

| builtin | kind | 角色 | 索引 doc |
|---|---|---|---|
| `root` | class（基类，parentClass=null） | 继承链终点基类 | `.ooc-world-meta/.../children/class/knowledge/builtins/root.md` |
| `agent` | class | OOC Agent 基类（agency：talk/plan/todo/end） | `builtins/agent.md` |
| `filesystem` | object（单例 tool-object） | 字节层文件工具（open_file/write_file/grep/glob） | `builtins/filesystem.md` |
| `interpreter` | object（单例 tool-object） | 代码解释器（child interpreter_process=class） | `builtins/interpreter.md` |
| `terminal` | object（单例 tool-object） | shell（child terminal_process=class） | `builtins/terminal.md` |
| `runtime` | class（单例，语义是工具对象） | 对象世界元能力（create_object 等） | `builtins/runtime.md` |
| `knowledge_base` | class（单例） | 一 world 一份知识库（child knowledge=非单例 class） | `builtins/knowledge_base.md` |
| `feishu_app` | object（继承 _builtin/agent） | 飞书接入点 agent 实例 | `builtins/feishu_app.md` |
| `supervisor` | object（继承 _builtin/agent） | 根 parent / 治理特权 agent 实例 | `builtins/supervisor.md` |
| `user` | object（被动，非 agent） | 被动对端实体 | `builtins/user.md` |
| `example` | class | 建 class 照抄的样板 | `builtins/example.md` |

> 注：各家族 `<id>.md` 已记录其家族内 children（如 agent 含 thread/plan/todo/pr/skill_index/method_exec_form；filesystem 含 file/search；interpreter/terminal 含 *_process；feishu_app 含 feishu_chat/feishu_doc；knowledge_base 含 knowledge）。children 命名空间重组见父仓 commit 87793f06。

---

## ② 跨家族 core 改进方向（按 severity 排序）

把 30+ 条家族级方向聚类去重为 10 个跨家族主题。每条列：受影响 builtin、与 class 维度已有待办的关系、代码锚。

### T1 [HIGH] register 应由 class 自声明 parentClass / 杜绝「忘传 meta = 静默继承 root」 — new

**受影响**：interpreter / terminal / filesystem / feishu_app（+ 所有 tool-object）
**根因**：`register-builtins.ts` 逐行手工传 meta；tool-object 应 `parentClass=null`，但 `_builtin/filesystem`(:59) / `_builtin/terminal`(:60) / `_builtin/interpreter`(:61) **都没传** `{parentClass:null}` → `parentClass===undefined` → `object-registry.ts:145` 静默回退继承 root god-object，无报错无门控。对比 feishu_chat/feishu_doc(:70-71) 显式 null、feishu_app(:72) 手填 `parentClass:"_builtin/agent"`。这与 `class self.md:16,52`「tool-object parentClass=null、不继承 root」设计**直接冲突**，且 `feishu_app/package.json` 的 `ooc.class` 自引用使父类真值被外移到 register 调用、破坏 `object-model.md:77`「`_builtin/<id>`=class、bare id=instance」寻址对称。
**方向**：register 据 OocClass / `package.json` 自动判定 parentClass（class 自身声明「非继承」语义、registrar 读取），消除散落手工 meta。
**关系**：class self.md 现状段（:50-54）只记「root 未拆」过渡态，**未记录「register 手工传 meta 是结构性失配」**这一根因 → new。
**锚**：`packages/@ooc/core/runtime/register-builtins.ts:59-61,72`；`packages/@ooc/core/runtime/object-registry.ts:145`

### T2 [HIGH] 退役 builtin/registry API 须强制扫消费方（builtin __tests__ + 文档 drift gate） — extends MEMORY「退役符号全树回流」

**受影响**：filesystem / terminal / runtime / interpreter / example（测试侧）+ root / interpreter / knowledge_base / runtime / supervisor（文档侧）
**根因**：registry API（`getObjectDefinition`→`resolveObjectMethod`/`resolveConstructor`/`getClass`）与 readable 目录化重构后，多个 builtin 包内 `__tests__` 全红却不进任何 gate——实测 filesystem.test(4/4 fail)、file-window-method.test、terminal.test(3/3)、runtime.test(4/4)、process.test（死 import `runExec`）、example.test（引已删 `ExampleWindow`/`close`/`compressView`/`windowMethods`/`kind:"constructor"`）。文档侧锚漂移同源：self-evolution.md 退役符号、programmable sibling 旧扁平路径、knowledge-activation.md:90 旧路径、stone-pool-flow 旧 `create_object root method`、server/index.ts:291 废 `instantiate_with_new_world` 注释。`check:doc-drift` 只扫源码 + 对象树，**不扫 builtin 包测试**，`check-no-deprecated-symbols` 不含测试 import。
**方向**：(a) builtin 包 `__tests__` 纳入常驻 CI gate（或退役 registry API 时加 check 扫 builtin 测试禁用符号）；(b) `check:doc-drift` FORBIDDEN_PATTERNS 增 `export const window dict` / `exec(window_id="custom:<self>")` / `packages/@ooc/builtins/<flat>/` 旧扁平路径精确模式。
**关系**：class self.md 无此项；与全局 MEMORY「退役符号要全树文档回流 / check:doc-drift」「e2e PASS 不等于真通」同源 → extends。注意「大重构延后修测试」MEMORY：这些破测试是 deliberate 记账状态，gate 须区分「记账中」vs「漂移未发现」。
**锚**：`packages/@ooc/builtins/filesystem/__tests__/filesystem.test.ts:14`；`packages/@ooc/builtins/runtime/__tests__/runtime.test.ts:20`；`packages/@ooc/builtins/terminal/__tests__/terminal.test.ts:6`；`packages/@ooc/builtins/example/__tests__/example.test.ts:4`；`packages/@ooc/core/executable/__tests__/process.test.ts:8`

### T3 [HIGH] 组合成员注入须收敛到 thread-as-object 单一路径 + boot fail-loud — extends class self.md 优化方向 3/4

**受影响**：runtime / filesystem / terminal / interpreter / knowledge_base
**根因**：设计已切 thread-as-object（`object-model.md:79`、`class self.md:46` 明称取代旧 `ooc.members`），但代码仍只实现退役 `ooc.members` 读取、且**没有任何 builtin 声明 members**——`readDeclaredMembers` 沿链找不到返回 `[]`、`injectMemberWindowsIfObjectThread` 对 supervisor 不注入任何成员窗，致 runtime/filesystem/terminal/interpreter/knowledge_base **作为成员窗对 agent 不可达**，`runtime.create_object` 经组合路径实际不生效。专测 `member-composition.test.ts`(0/3) + `runtime.test.ts` 同时全红，现有 gate 测不到。
**方向**：先退 `ooc.members` 读取 + 落 thread-as-object 注入，再加 boot 校验——缺成员则响亮报警。
**关系**：落实 class self.md 优化方向 3「组合收敛」+ 4「实例运行时可变成员」的运行时断点；与 MEMORY「建对象闭环断裂 create→use」同源 → extends。**断点在声明侧（agent/组合维度），runtime 实现本体正确**。
**锚**：`packages/@ooc/core/thinkable/context/init.ts:294-301`（注释明示 `_builtin/agent` 应声明 members 但无包声明）

### T4 [HIGH] 接通 Class.init World 启动钩子 + 补 World 句柄面 — new

**受影响**：feishu_app（+ 所有需后台长连接/启动钩子的 builtin）
**根因**：`ooc-class.ts:37-50` 定义 `init` 为 World 启动级初始化契约但注明「机制待实现」；`feishu_app/index.ts:32-39` 是其**唯一实现者**，运行时却不经此契约——`app/server/index.ts:238` 硬编码 `startLarkEventRelay(config)` + :202 `maybeForwardToLark` 旁路拉起，init 内还把 World 强转 ServerConfig（签名错配）。不通电则每加一个长连接 builtin 都要改 app server，违背 init 设计初衷。
**方向**：接通 Class.init World 启动钩子，并补齐传入的 World 句柄（baseDir + port + thread-activation 订阅入口）；同时为接入点 object 提供承载进程级长连接 + 投影其状态的 core 位点（当前 event-relay routing 表是 worker 进程内 Map、与 feishu_app object data 割裂，readable 只能陈述「relay 由 server 启动」、靠 console.log 观测）。
**关系**：class self.md 未记 init 契约落地 → new；与 MEMORY「超时是 observability 症状」呼应（长连接健康须可投影）。
**锚**：`packages/@ooc/core/runtime/ooc-class.ts:37-50`；`packages/@ooc/builtins/feishu_app/index.ts:32-39`；`packages/@ooc/core/app/server/index.ts:202,238`；`feishu_app/event-relay/index.ts:40-65`

### T5 [HIGH] children 短名解析约定 + instantiate fail-loud 文案 — new

**受影响**：filesystem（已造真实潜在 bug）、knowledge_base、example（死链）+ 所有引用 classId 的 method
**根因**：`runtime.instantiate("file")` → `resolveConstructor("file")===undefined`（注册键是 `_builtin/filesystem/file`），bare id 既不在注册期被拦、运行期才抛泛化 `class 'file' has no constructor registered`——已在 `search.open_match`(executable/index.ts:75) 造成真实潜在 bug（本体 open_file 用全 id、open_match 漏前缀）。同类：`open_knowledge` 硬编码全路径 `_builtin/knowledge_base/knowledge`(executable/index.ts:28)、parent 改名即静默断链；`root.example` 硬连 `_builtin/example` 但该 class **根本未注册**（register-builtins 零命中）→ 编译期过、运行期炸。
**方向**：(a) instantiate 失败文案提示「漏 `_builtin/<parent>/` 前缀 / 最近匹配键」；(b) 给 children 短名在 parent 命名空间内的解析约定（升「命名空间从属」为可校验关系，免每个 child 手抄全 id）；(c) 装载期断言「凡被 method 硬连的 classId 必须已注册」（fail-loud 死链）。
**关系**：落实 `object-model.md:59` 核心 8「children 命名空间从属」为可校验；class self.md 未记此 → new。
**锚**：`packages/@ooc/builtins/filesystem/children/search/executable/index.ts:75`；`packages/@ooc/builtins/knowledge_base/executable/index.ts:28`；`packages/@ooc/builtins/root/executable/method.example.ts:24`；`packages/@ooc/core/executable/manager.ts:127`

### T6 [MEDIUM] RuntimeHandle 完整面 + tool-object→child 委托一等原语 — extends class self.md 优化方向 3

**受影响**：agent / terminal / interpreter / knowledge_base / filesystem
**根因**：agent 核心智能入口语义散落 `deferred_hooks`——talk 的 thread 创建+thinkloop 编排靠 `ctx.runtime.instantiate` 兜底、end 的 say 派送在 runtime 缺席退化为 thread.events 登记、pr 的 runtime 投递创建无正式入口。同时「tool-object 方法→instantiate child class」每个 tool-object 各写一遍守卫、且失败语义分裂：parent run 在 `ctx.runtime` 缺席返回错误文本(executable/index.ts:37)、child construct 在 `ctx.thread` 缺席 throw(index.ts:33)——同一能力链两端降级表现分裂。
**方向**：(a) 补齐 RuntimeHandle 会话/派送/投递正式 API，使 agency 运行时语义在 method 内闭合；(b) 把「tool-object 方法→instantiate child」收成一等委托原语，带 thread/runtime 句柄完整性校验 + 统一 fail-loud vs 软返回语义；(c)[LOW] 把「runtime（对象世界语义层，元能力面）/ filesystem（字节层工具）/ persistable（落盘层）」三层契约边界划清成文——哪些能力算 runtime、哪些算 filesystem/persistable 当前无明确划分。
**关系**：落实 class self.md 优化方向 3「组合收敛」的运行时契约层；与 Wave4 对象模型重构预期过渡态一致 → extends。
**锚**：`packages/@ooc/builtins/agent/executable/method.talk.ts:54`；`method.end.ts:6`；`agent/children/pr/index.ts:6`；`terminal/executable/index.ts:29,37`

### T7 [MEDIUM] 单例工具对象 kind 口径统一 + 单例性 fail-loud 于注册期 — extends object-model.md 细节补充 / closes builtins.md 脚注歧义

**受影响**：runtime / knowledge_base（kind=class） vs filesystem / interpreter / terminal（kind=object）
**根因**：五个同构单例工具对象 kind 两套并存；`object-model.md:76`（kind 答「类还是实例」、单例 class 的 kind 仍是 class）与 supervisor builtins 索引脚注（倾向 object）两份权威**互斥**，无机制阻止漂移。register-builtins 全程不读 `package.json.kind`、单例性只活在源码注释（`runtime/types.ts:8`、`knowledge_base/index.ts:5`），运行期 instantiate 失败才暴露、注册期无断言。
**方向**：(a) **先在 object-model.md 拍死 kind 口径**（单例工具对象统一取值，不预设 object 为唯一正解）；(b) 定稿后 core 加 kind 与 construct/单例性一致性校验 + 显式单例标记使 fail-loud 于注册期；(c) 消除「by-reference 注入」推断与现状的措辞歧义（runtime 当前无 by-reference 注入路径）。
**关系**：订正 `object-model.md` 细节补充 + 收编 builtins 索引脚注的 class-vs-object 歧义 → extends + closes（注：原家族 doc 把 object 当唯一正解站不住，降为「先定口径再 lint」）。
**锚**：`packages/@ooc/builtins/runtime/package.json:13`；`packages/@ooc/builtins/knowledge_base/index.ts:6`

### T8 [MEDIUM] 治理特权 / 被动性 / 白名单 升为对象模型可推导，取代散点字面量 — new（呼应对象关系三轴）

**受影响**：supervisor / user（+ feishu_app 并列于白名单）
**根因**：两类「对象性质」散落硬编码——(a) supervisor 治理特权靠 ~6 处字面量 `"supervisor"`（stone-versioning:438 / stone-feat-branch:103 reviewer 恒含 / super-actor:22 兜底 / recovery-check:104 / service:574 / thread.ts:85 白名单），任一漂移即破契约、无法换 object 当根 parent；(b) user 被动性靠 ~8 处 `objectId==="user"`（worker/init/flows.service×2/object-windows×3/thread.ts）；(c) `BUILTIN_OBJECT_IDS = new Set(["supervisor","user","feishu_app"])` 把 agent 实例/被动 object/继承 agent 的接入点塞进同一解析白名单、与 builtins 清单两处真相易漂移。
**方向**：(a) 显式 root-parent-object 角色——治理/reviewer/super-actor fallback 依「是否 world 根 parent」判定；(b) 被动性从对象模型推导（无 executable⇒不被 exec、非 agent⇒不跑 thinkloop/不进 worker 队列/**不自身投影 self 窗**——精确保留：talk 派生 peer 仍带 user）；(c) 白名单由 `_builtin/<id>` 前缀 + kind/继承统一推导寻址，替手工实例表。
**关系**：与 MEMORY「对象关系三轴 parent-child + Supervisor=最顶层 parent」既定设计一致；class self.md 未把这些升为模型性质 → new。
**锚**：`packages/@ooc/core/persistable/stone-versioning.ts:438`；`packages/@ooc/core/_shared/types/thread.ts:85`

### T9 [MEDIUM] agent 实例初始 data 单一来源 + bootstrap 经 class construct + self.md 磁盘读单一寻址原语 — extends object-model.md 核心 9

**受影响**：supervisor / feishu_app / agent
**根因**：agent 实例初始 data 有两套机制并存——`construct`（agent/index.ts:29 exec 产 {self}）与 bootstrap-copy（instantiate-classes.ts:64 readFile self.md + :72 createStone），bootstrap 不调 construct → construct 在 bootstrap 场景成**死代码**；同时 builtin 五件套磁盘读有两套路径（前缀走 `resolveBuiltinReadDir`、bare-id-bootstrap 走裸 readFile，:60-61 注释自承）。更严重：feishu_app kind=object + 继承 agent 链（可被 talk 的 agent 实例）但**包内无 self.md**，instantiate-classes.ts:62-67 静默 catch 落空字符串，建出无磁盘身份的可-talk agent（复现 `object-model.md:42/62` 已收敛过的 supervisor LLM 即兴演角色根问题）。
**方向**：(a) bootstrap 也走 class construct（self.md 文本作 args.self）以同源、消 construct 死代码；(b) 统一两套磁盘读经单一寻址原语；(c) 实例化继承 agent 链的 builtin 时对缺失 self.md **fail-loud**（warn 或拒），不静默落空。
**关系**：落实 `object-model.md:40,62` 核心 9「实例初始 data 由 construct 产、self.md 是 agent 实例身份」契约 → extends；与 MEMORY「builtin self.md 磁盘读不到」同源。
**锚**：`packages/@ooc/core/app/server/bootstrap/instantiate-classes.ts:62-67`；`packages/@ooc/builtins/feishu_app/`（无 self.md）；`packages/@ooc/core/persistable/builtin-dir.ts:35`

### T10 [LOW/MEDIUM] 退役机制下线流程 + 派生窗一等模型 + readable 投影模板 + class 链文件级回退 — 混合（部分 extends class self.md 优化方向 2）

**受影响**：agent（method_exec_form / skill_index / class 链回退）、interpreter（readable 模板）、example/example_class 注册护栏
**根因（聚四小项）**：
- **退役类型下线**：`method_exec_form/index.ts:11` 注册空 `Class={}`（form 机制 Wave4 已废、types.ts:14），仅为旧类型归位保留——core/builtins 缺退役类型下线路径，废弃物以空壳累积熵增（涨潮后未退潮）。
- **派生窗一等模型**：`skill_index` 无 construct、不导出 persistable（synthesizer 每轮重建不落盘），却仍以 ooc stone 注册且 `package.json:16` 误标 `kind:object` → core 缺「介于 class 实例与纯渲染之间的派生窗」形态，kind 字段与实际语义打架（应 kind:class）。
- **readable 投影模板**：纯方法面 tool-object（interpreter）readable content 仅「解释器」、菜单全靠 method description 撑——core 缺「从 window 声明的 object_methods 自动渲染可调菜单」标准模板，每个无业务数据 tool-object 各写贫瘠 content。
- **class 链文件级回退**：registry 级 method/window/visible 回退已落（`object-registry.ts:261/:299`），但 stone **文件**级回退（沿 parentClass 链读父类磁盘 readable.md/visible.tsx 渲染 self window）未实现——继承 agent 的具体 agent 需 self-window 投影即受制约。
- **注册漂移护栏**：example 有完整五件套包却漏在 register-builtins 手维护 import 列表 → 应「import 列表 ↔ `packages/@ooc/builtins/*` 实际包对账」fail-loud（有包无注册/有注册无包）。
**方向**：建退役 builtin class 下线流程；为派生窗补一等模型表达；core readable 提供纯方法面投影模板；补 class 链文件级 readable/visible 回退；register import 列表与实际包对账。
**关系**：class 链文件级回退 = 落实 class self.md 优化方向 2 + 已知问题「stone-文件级回退未实现」→ extends；其余 new。
**锚**：`packages/@ooc/builtins/agent/children/method_exec_form/index.ts:11`；`packages/@ooc/builtins/agent/children/skill_index/package.json:16`；`packages/@ooc/builtins/interpreter/readable/index.ts:22`；`packages/@ooc/core/runtime/object-registry.ts:261,299`

### T11 [LOW] root god-object 现状回流（措辞已过期，method 层重复已退场） — closes

**受影响**：root（class self.md:50-54 + builtins 索引措辞）
**根因**：class self.md:54 + builtins 仍称「root god-object 未拆 / 与成员重复持有 file/program 工具 / 移除一步破约 30 测试 / makeRootDelegator」，但 root executable 源码**只剩 exampleMethod**——agency 已搬 `_builtin/agent`、文件/进程工具在 filesystem/interpreter/terminal 成员、飞书收口 feishu_app；grep `open_file/write_file/grep/glob` 在 root 源码无命中、`makeRootDelegator` 在 core 源码零引用（仅残于 class self.md:48 措辞 + 旧 docs）。method 层重复已基本退场，**残留仅 knowledge 措辞 + register 仍隐式回退 root（T1）**。
**方向**：回流 class self.md:48,54 + builtins root 条目——移除过期 god-object 现状、改为「method 层重复已退场、残留仅 register 隐式回退 root 链终点（待 T1 显式 parentClass 后收敛）」。同时回流 object-model.md:92 迁移待办（`instantiate_with_new_world` flag 已移除、改 `pkg?.ooc?.kind!=='object'`）+ root 单例基类不参与 init/destruct 生命周期边界（ooc-class.ts:48-50 契约未对单例基类落定）。
**关系**：closes 多条过期/虚假待办；root 拆解的**实质**残留已收编进 T1（register 隐式回退 root）→ 此项纯文档回流。
**锚**：`packages/@ooc/builtins/root/executable/index.ts:20`；`object-model.md:92`；`ooc-class.ts:48-50`

---

## ③ 设计-源码差异清单（按 severity）

> 「待办状态」：**回流** = 文档/注释/索引说法过期，须改文档对齐源码；**修源码** = 源码与设计冲突须改源码；**记账** = 已知过渡态/延后修测试。

### HIGH

| # | 差异 | builtin | 锚 | 待办 |
|---|---|---|---|---|
| H1 | tool-object 注册未传 `{parentClass:null}` → 静默继承 root god-object（与 class self.md:16,52 冲突） | terminal/filesystem/interpreter | `register-builtins.ts:59-61` | 修源码（T1） |
| H2 | self-evolution.md 用退役符号（`export const window dict` / `exec(window_id="custom:<self>")`）+ write_file/open_file 当 root 直调；经 protocol.ts 注入所有 thread = 把退役 API 教给每个 agent | root | `root/knowledge/self-evolution.md:42` | 回流 md + 补 drift pattern（T2） |
| H3 | skill_index `package.json` 误标 `kind:object`，实为每 thread synthesizer 重建注入的派生 class（应 kind:class） | agent | `agent/children/skill_index/package.json:16` | 修源码（T10 派生窗模型） |
| H4 | `search.open_match` 用裸 id `instantiate("file")` → constructor-not-found（本体用全 id、此处漏前缀），潜在功能 bug | filesystem | `filesystem/children/search/executable/index.ts:75` | 修源码（T5） |
| H5 | builtin 包 `__tests__` 全红未被任何 gate 捕获（filesystem 4/4、terminal 3/3、runtime 4/4、file-window-method） | filesystem/terminal/runtime | `filesystem/__tests__/filesystem.test.ts:14` 等 | 记账 + 加 gate（T2） |
| H6 | feishu_app `ooc.class="feishu_app"` 自引用、父类真值外移到 register；破 `_builtin/<id>`=class、bare=instance 寻址对称 | feishu_app | `feishu_app/package.json:14-18`+`register-builtins.ts:72` | 修源码（T1/T7） |
| H7 | feishu_app kind=object+继承 agent 但无 self.md，bootstrap 静默落空字符串 → 无身份可-talk agent | feishu_app | `feishu_app/`（无 self.md）+`instantiate-classes.ts:62-67` | 修源码 fail-loud（T9） |
| H8 | Class.init 未接线：feishu_app 是唯一实现者却被 app server 硬编码旁路拉起；init 把 World 强转 ServerConfig | feishu_app | `ooc-class.ts:37-50`+`server/index.ts:202,238` | 修源码（T4） |
| H9 | `root.example` 硬连未注册的 `_builtin/example` → 编译期过、运行期炸死链 | example | `register-builtins.ts:16`+`root/executable/method.example.ts:24`+`manager.ts:127` | 修源码（T5） |
| H10 | 组合成员注入断：无 builtin 声明 members、`readDeclaredMembers` 返回 []、runtime/filesystem/terminal 对 agent 不可达（member-composition.test 0/3） | runtime+tool-objects | `init.ts:294-301` | 修源码（T3） |

### MEDIUM

| # | 差异 | builtin | 锚 | 待办 |
|---|---|---|---|---|
| M1 | root god-object 现状措辞过期（method 层重复已退场，只剩 exampleMethod / makeRootDelegator 零引用） | root | `root/executable/index.ts:20` | 回流（T11） |
| M2 | thread 包注释/类型仍写旧名 `_builtin/thread`（87793f06 前残留），实际 `_builtin/agent/thread` | agent | `agent/children/thread/readable/index.ts:6`,`types.ts:7` | 回流（T2） |
| M3 | method_exec_form 注册空 `Class={}`（form 机制 Wave4 已废），废弃物空壳累积 | agent | `agent/children/method_exec_form/index.ts:11` | 修源码下线（T10） |
| M4 | agency/thread 沉淀 method 留 deferred_hooks（talk/end/pr runtime 语义未在 method 内闭合） | agent | `method.talk.ts:54`,`method.end.ts:6`,`pr/index.ts:6` | 记账（T6 过渡态） |
| M5 | tool-object 设计称 parentClass=null，实际隐式继承 root（无 tool-object 注册父类） | filesystem | `register-builtins.ts:50` | 修源码（T1）；doc 已据源码纠正 |
| M6 | programmable sibling doc 旧扁平路径 + 旧签名 `createInterpreterSelf(stoneRef,thread,registry?)` | interpreter | `interpreter/children/interpreter_process/executable/self.ts:44` | 回流（T2） |
| M7 | process.test.ts 死 import `runExec`（无此导出） | interpreter | `core/executable/__tests__/process.test.ts:8` | 记账+gate（T2） |
| M8 | construct/method 入参 schema 缺单一来源（run/construct/exec 三份近同 `{language,lang,code}`+normLang） | interpreter | `interpreter_process/index.ts:22`+`executable/index.ts:25` | 修源码（T6 委托原语） |
| M9 | construct/method 失败语义分裂（parent run 软返回错误文本 vs child construct throw） | interpreter/terminal | `terminal/executable/index.ts:37` vs `*_process/index.ts:33` | 修源码（T6） |
| M10 | knowledge-activation.md:90 引旧路径 `builtins/knowledge/types.ts`（实际已迁 knowledge_base/children/knowledge） | knowledge_base | `knowledge_base/children/knowledge/types.ts:21` | 回流（T2） |
| M11 | runtime kind=class 但语义单例工具对象，与 filesystem 系（object）取值相反 | runtime | `runtime/package.json:13` | 先定口径再 lint（T7） |
| M12 | server/index.ts:291 注释残留废弃 flag `instantiate_with_new_world`，与实现 `kind==="object"` 矛盾 | supervisor | `server/index.ts:291` | 回流（T2/T11） |
| M13 | supervisor bootstrap 绕过 agent construct（readFile self.md + createStone）→ construct 成死代码 | supervisor | `instantiate-classes.ts:62` | 修源码同源（T9） |
| M14 | 治理特权靠 ~6 处字面量 `SUPERVISOR_OBJECT_ID="supervisor"`（非 class 模型表达） | supervisor | `stone-versioning.ts:438` | 修源码升模型（T8） |
| M15 | user 被动性靠 ~8 处 `objectId==="user"` 散点判断 | user | `_shared/types/thread.ts` 等 | 修源码升模型（T8） |
| M16 | example.test.ts 整体旧契约化石（ExampleWindow / close / compressView / windowMethods / kind:"constructor" / 旧平铺投影） | example | `example/__tests__/example.test.ts:4` | 记账+stale-test 扫描（T2） |

### LOW

| # | 差异 | builtin | 锚 | 待办 |
|---|---|---|---|---|
| L1 | object-model.md:92 称 `instantiate-classes.ts` 旧 flag 待回流移除，实际已移除（改 `pkg?.ooc?.kind!=='object'`） | root | `instantiate-classes.ts:51` | 回流虚假待办（T11） |
| L2 | class self.md:48 + 旧 docs 把 makeRootDelegator 当 live 描述（核心源码+__tests__ 零引用） | root | `class/self.md:48` | 回流（T11） |
| L3 | root 单例基类 init/destruct 生命周期边界未在 doc 落定（ooc-class.ts:48-50 契约对单例基类未跳过） | root | `ooc-class.ts:48-50` | 回流+机制跳过（T11） |
| L4 | executable knowledge `root-methods-and-forms.md:17` 仍称 agent 经 `ooc.members` 持成员（已退役） | filesystem | sibling doc | 回流（T2/T3） |
| L5 | feishu_app/feishu_chat/feishu_doc index.ts 顶注称注册在已解散的 `windows/index.ts` | feishu_app | `feishu_app/index.ts:9` | 回流（T2） |
| L6 | commands.test.ts 断言 root 含 `open_feishu_chat/open_feishu_doc`（已迁 feishu_app）+ import 已删 `getOpenableMethods` → 加载即 SyntaxError | feishu_app | `core/executable/__tests__/commands.test.ts:62-70` | 记账（T2） |
| L7 | feishu subscribe poller 未集成 + event-relay 非文本占位 + routing 内存级、SDK 无 close | feishu_app | `feishu_chat/executable/index.ts:304` | 记账（已知功能边界） |
| L8 | builtins.md 脚注把「单例」与「kind=object」挂钩（旧认知遗留，单例 class 的 kind 仍是 class） | knowledge_base | `knowledge_base/index.ts:6` | 回流订正（T7） |
| L9 | `create_object` 已迁 runtime，但 `stone-pool-flow-three-trees.md:29` 仍称「create_object root method」 | runtime | `runtime/executable/index.ts:6` | 回流（T2） |
| L10 | 命名拥挤：投影 class `runtime` / registry 键 `_builtin/runtime` / ExecutableContext 句柄 `ctx.runtime` 共词根 | runtime | `runtime/readable/index.ts:20` | 记账（非阻塞） |
| L11 | BUILTIN_OBJECT_IDS 把 supervisor/user/feishu_app 异质实体并列硬编码进解析白名单 | user/supervisor | `_shared/types/thread.ts:85` | 修源码升推导（T8） |
| L12 | user/readable.md 实写「发给 user 对端消息怎么渲染」（inline UI token 协议），非 user 自身投影——槽位与对象模型角色错位 | user | `user/readable.md` | 回流+区分两类 agent-facing 文本（T10） |
| L13 | example 五件套主体完全符合 OocClass 契约（无偏离，作正向锚） | example | `example/index.ts:14` | 无（正例） |
| L14 | agent/supervisor 接线干净（kind/class/construct 槽 / data 经继承合成）无偏离（正向锚） | agent/supervisor | `agent/package.json:13`、`supervisor/package.json:13` | 无（正例） |
| L15 | `object-model.md` 仍用术语 `constructor`（行 36/47/78）指非单例构造槽，落地契约统一是 `construct`（`ooc-class.ts:43-45` 因 `Object.prototype.constructor` 遮蔽改名）；多个 builtin doc 已用 `construct`，模型权威术语未对齐 | 模型层（agent/interpreter/runtime/example 均撞到） | `object-model.md:36,47,78`+`ooc-class.ts:43-45` | 回流 object-model.md 统一术语（T11/回流批） |

---

## 派单建议（Supervisor → AgentOfX）

- **AgentOfClass + AgentOfExecutable（collaborable）**：T1（register 自声明 parentClass，最高发隐性漂移根因）、T3（thread-as-object 成员注入，阻断 create_object 闭环）、T6（RuntimeHandle + 委托原语）。
- **AgentOfPersistable + AgentOfCollaborable**：T4（Class.init 接线 + World 句柄）、T9（agent 实例 data 单一来源 + self.md fail-loud）。
- **AgentOfClass（模型裁决）**：T7（kind 口径先定稿再 lint）、T8（治理/被动/白名单升模型，呼应对象关系三轴）。
- **横切（工具/gate）**：T2（builtin __tests__ 进 gate + doc-drift 扩 pattern）、T5（instantiate fail-loud + children 短名约定 + classId 装载期校验）。
- **回流批（低成本、Supervisor 可直接处理对象树）**：T11 + ③ 中所有「回流」项（H2/M1/M2/M6/M10/M12/L1/L2/L4/L5/L8/L9/L12）。
- **熵减**：T10（method_exec_form 下线 / skill_index kind 正名 / readable 模板 / 文件级回退 / register 对账）。

**仍需 Supervisor 拍板的风险点**：
1. T7 单例工具对象 kind 取值（object vs class）——需在 object-model.md 与 supervisor builtins 索引间裁决唯一口径，**不能在两份互斥权威上加 lint**。
2. T1 register 自动判定 parentClass 的实现路径（读 OocClass 声明 vs 读 package.json）——涉及「class 自身声明非继承语义」的接口位点。
3. T2 中「延后修测试」记账 vs「漂移未发现」的 gate 边界——避免 gate 把 deliberate 记账态误报为红。
