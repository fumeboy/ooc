# OOC 理想设计全貌（树形完整陈述，2026-06-10）

> 性质：理想 OOC 系统的**完整形态**陈述——从 OOC 概念为根，发散到各维度分支，每个节点以肯定句描述「这个系统就是这样的」，不区分既有与待建。
> 与姊妹文档的关系：[审计报告](./2026-06-10-cognitive-audit-report.md)记录问题事实；[理想机制设计 v2](./2026-06-10-ideal-design.md)记录由问题反射的机制与 grill 定案（增量视角）；**本文是合成后的全量视角**——三者中以本文为对照基准（north star 的最终形态）。

## 全树概览

```
OOC（根：概念与公理）
├── 0. Object 本体论（一等实体 / 五件套 / class 继承 / 关系三轴）
├── 1. thinkable    —— 思考：context 即对象引用表，知识渐进激活
├── 2. executable   —— 行动：4 原语 + schema 驱动的渐进式表单
├── 3. collaborable —— 协作：消息投递 + 心跳检活 + 终态必达
├── 4. observable   —— 观测：观察者的仪器，旁路且不可被 agent 感知
├── 5. reflectable  —— 反思：super flow 唯一自我通道，演化经闸门
├── 6. programmable —— 自编程：写→测→改在 session 内闭环
├── 7. readable     —— LLM 侧外观：Object 自己控制怎样被读
├── 8. visible      —— 人类侧外观：类的脸即实例的缺省脸
├── 9. persistable  —— 持久：三层定位 + session 真相原则
└── 10. 横切层（app 控制面 / extendable / 能力可达性 / 工程自举）
```

---

# 根：OOC 概念与公理

**OOC = Object Oriented Context**：以面向对象的哲学组织上下文、构建 MultiAgent、做 GenUI、实现 Agent 自我迭代。它把「上下文工程」从 prompt 串接的手艺活，还原成一套面向对象抽象——传统 Agent 框架在写一份不断变长的 prompt，OOC 在写一个不断演化的对象图。

**第一性原理**：系统里任何东西，要么是一个 Object，要么是 Object 之间的一条关系。

**三主张**：

1. **Object 化的上下文**——LLM 看到的不是裸 prompt，而是一组 ContextWindow 对象：既是信息展示单元，也是行动挂载点。
2. **Object 化的 Agent**——一个 Agent 就是一个 Object（数据字段 + 程序方法），Object 之间协作、对话、派生，构成 MultiAgent。
3. **元编程**——Object 在运行时改写自己的类（身份/方法/知识/界面），系统因此具备自我进化能力。

**与传统 OO 的四处本质差异**：① observer 是 LLM 不是 CPU（接口 = 方法签名 + readable 输出，同等重要）；② 两个外部世界（其他 Agent 消费 readable+method，人类消费 visible+ui_methods）；③ 运行时改写自己的类是设计目标不是 hack；④ 对象图动态涌现（更像进程树而非静态类图）。

**四条公理 + 一条准则**（一切机制取舍回到这里裁决）：

| # | 公理 | 一句话 |
|---|------|--------|
| A1 | 闭环机制完备 | 每条闭环的每一跳，要么有 gate 要么有 signal；LLM 自由度在决策内容层，不在协议完整性层 |
| A2 | 单一真相源 | 任何状态只有一个权威落点，其余皆派生缓存，事件驱动失效；session 推论：在哪个 session 问，看到哪个 session 的真相 |
| A3 | 有限性 | 一切等待有检活（期限可选），一切资源有配额，一切终态必传播 |
| A4 | 全件套语义 | 继承与隔离作用于五件套整体；非对称必须显式声明可查询，但不强行对称重型 |
| 准则 | 业务能力双面可达 | 业务能力声明一次、双面投影兜底；观察者平面与治理平面不在其内 |

**维度判定轴 = self-constitutive（自我构成性）**：一个能力构成 Agent 的「自我」则为维度，否则为外接层/协议。9 维度 = 运行时底座（thinkable / executable / collaborable / observable / persistable）+ 自我塑造（reflectable / programmable）+ 外观镜像对（readable=LLM 侧 / visible=人类侧）。extendable（飞书/notion/slack 等外部集成）够的是外部世界，不构成自我，故为外接层而非第 10 维。

---

# 0. Object 本体论

## 0.1 一个 Object 是什么

一个 OOC Object = `stones/<branch>/objects/<id>/` 下的**五件套** + 它被运行起来的 thinkloop：

| 件 | 文件 | 角色 |
|----|------|------|
| 身份 | `self.md` | 第一人称内向叙述（进 LLM instructions，自我约束）；第一行 `# 标题` 是 displayName 的显式契约 |
| readable | `readable.md` / `readable.ts` | 对外名片 + LLM 侧动态展示 |
| executable | `executable/index.ts` | object method 源码 |
| visible | `visible/index.tsx` | 人类侧 UI |
| knowledge | `knowledge/*.md` | seed 知识，按 trigger 激活 |

**ContextWindow** 是 Object 出现在 context 中的形态——不是独立数据结构，每个 window 背后都对应一个 Object。Context 是**视角不是归属**：同一 Object 可同时出现在多个 thread 的 context，状态只存一份，各 thread 持视角参数（compressLevel/order）。

## 0.2 class —— 系统唯一的继承机制

- **class 与 object 平级**：组成相同的五件套；区别只在 class 不可交互（不被 talk、不跑 thinkloop），仅供单链继承。builtin 即 class（`_builtin/<id>` 寻址，随框架发布），world 中是其实例。
- **五件套全链继承，无豁免**（A4）：method、window method、knowledge、readable（文件级）、visible（文件级）全部沿 parentClass 链回退。类的 visible 就是实例的缺省脸——file class 的渲染器服务所有 file 实例，这是继承 `toString()` 的直觉。own 文件遮蔽 class（标准 override）。
- **调用面统一**：一切方法解析（LLM exec / sandbox callMethod / HTTP callMethod）走同一条 class 链解析算法，系统中不存在第二条 lookup 路径。
- **own 身份 / 共享行为**：实例化拷 self.md 快照（own，不跟框架升级）；行为活继承。实例记录实例化时的 class 版本，class 升级后系统注入「快照已过期」提示，agent 在 super flow 自查自更——**检测是系统的，更新是 agent 的**。
- 缺省 parentClass 隐式继承 root（talk/do/plan/todo/program/open_file/glob/grep 等通用方法）；`null` 显式断链。

## 0.3 对象关系三轴

- **自我轴（super）**：Object 与自己的反思分身，归 reflectable。
- **peer 平等轴（talk）**：同级 Agent 只能说服、不能支配、不能改对方运行时状态，归 collaborable。
- **parent-child 层级轴**：物理嵌套 `children/`，层级治理；Supervisor 是 object 树的 root parent。
- **修改权 = self-scope 自治**：改自己子树自治合入；改别人子树（cross-scope）必经评审。user 的终极闸门是 git 本身。

---

# 1. thinkable —— 思考

**核心**：LLM 每轮看到的输入 = 当前 thread 的对象引用表 + 每个被引对象的 readable() 拼接。**上下文工程 = 管理对象引用表**。

## 1.1 context 与窗口

- thread 持一组 contextWindows；渲染经 pipeline（system / form / knowledge / activator / peer 等 processor）合成。
- **单一窗口真相**：LLM 实际看到的窗口集合（含 pipeline 派生窗口）只有一份权威；trigger 求值、观测快照、permission 检查消费同一集合。「窗口在 context 里但 trigger 永远无法命中」不可表示。
- Object 不知道 context 之外的任何事——context 即它的世界边界。

## 1.2 知识系统

- **双源**：seed（stone，人类预置，进 git）+ sediment（pool，运行时沉淀，写就生效）。
- **可见性自声明**：每篇知识用 `audience: self | children | instances`（缺省 self）声明可被谁继承；目录链与 class 链消费同一字段。对外公开自述的唯一载体是 readable，知识不开「对外」档。
- **写入即契约**：接入激活回路的知识写入边界过 contract gate——frontmatter 必填最小集（title/description/activates_on）缺失即 deny + 回灌模板。gate schema 归 core 协议层（与 tool 原语同级的稳定面），开放扩展字段留给 agent 的格式创新。**死知识无法产生**（A1）。
- **渐进激活**：trigger 五类（object/method/object_id/intent/super），执行推进到哪、知识激活到哪；激活级别 show_description（摘要，自带标准展开动作）/ show_content（全文）。窗口关闭，知识引用随之回收。
- **无盲区**：被预算排除的窗口在 overflow 列表中带召回指令；synthetic 资源不可被误当可操作对象。

## 1.3 thread 与 thinkloop

- Thread Tree：thread 派生子 thread 并行思考，OOC 的 SubAgent 底座；调度器逐 tick 推进。
- thinkloop：单 thread 一轮「构造 context → 调 LLM → 执行 tool → 写事件」。
- **预算**：BudgetManager 按相关度在 token 预算内纳入/排除窗口；LLM 自主 compress 优先，**系统兜底强制压缩殿后**——context 不可能以超硬阈值的形态打到 provider（A1 的兜底分层：自主优先，兜底必备）。

---

# 2. executable —— 行动

**核心**：以 Object 为中心的稳定行动协议。LLM 不调任意函数，只经 4 个稳定 tool 原语（exec / close / wait / compress）在窗口上调 method；新能力走 method，永不增顶层 tool。

## 2.1 method

- **两类分维**：object method（操作数据，归 executable）与 window method（只控展示，归 readable），同名 fail-loud。
- **MethodOutcome 三态**：`{ok:true,result?}` / `{ok:true,object}`（constructor，每 type 至多一个，注册期断言）/ `{ok:false,error}`——method 不抛异常，错误结构化交 LLM 决策。
- **统一结果信封**：一切结果超限自动行级截断（保头尾 + 醒目省略标记 + 完整版落盘指针）。截断是信封的职责，不是 method 作者的自觉。

## 2.2 schema 驱动的渐进式执行

像填电子表单——每填一项，旁边弹出该项的提示：

1. **意图先行、惰性披露**：method 平时只露名字与一句意图，不渲染参数签名、不占 context；LLM 只传「要做什么」即可 exec。
2. **缺参即开表单**：args 不齐 → method_exec form → 此刻才按 schema 渲染 fill_state + 字段级提示 + 该 method 的激活知识，逐 refine 逐字段披露。
3. **执行完即回收**：form 关闭，表单与知识从 context 消失。

schema 注册期必备（「提示永远有的可弹」的保证）：不消费 args 的方法与协议推进类方法自动豁免；消费 args 而无 schema 的须显式 `schema:"none" + reason`。校验分级：advisory（缺省，标记不拦）/ blocking（拦 submit，用于高代价字段）；exec 与 ui 双路径同点生效。

## 2.3 form 生命周期

open → refine（可多轮、可从 failed 复活）→ submit → done/failed。executing 带租约，超时翻 failed 可重试——form 不可能永远卡住（A3）。auto-submit（args 一次给齐）合法，结果携带 accumulatedArgs 回执。close 带状态的窗口留墓碑（可恢复摘要），有未竟事项时需确认参数二次提交。

## 2.4 permission

三档（allow/ask/deny），thinkloop 分派前查。ask 的决议属观察者平面；无人值守超时按声明降级——缺省 deny-safe（拒绝原因进 events，LLM 改道）。deny 档非空（自改方法集、越界写入列）。「ask 永久挂起」不可表示。

---

# 3. collaborable —— 协作

**核心**：协作即消息投递。thread 间不共享内存，一切跨 thread 影响经显式 inbox/outbox 与窗口（do_window.move 是唯一例外），链路永远可观察、可回放。

## 3.1 通道

- **talk_window**（peer 轴）：跨 object 持续会话，同一对端复用同一窗口；`say` 发消息可 `wait`。
- **do_window**（父子轴）：同 object fork 子线程；`continue` 双向追加。
- **creator window**：thread 指向创建方的恒在通道，不可 close，子→父回报的合法通道。
- **inbox per-message 落盘**：append-only 幂等文件，并发回报互不覆盖；消费靠派生过滤。
- 多对一回报按来源分组渲染（`<msg from="...">`）——多个声音是渲染协议的一部分。

## 3.2 等待：检活为主、期限可选

- **心跳检活**：callee 每轮 thinkloop 自动给 waiter 续约；心跳不断，等多久都合法——深度任务不被假超时打断。心跳断（卡死/failed/进程没了）→ 短窗口内唤醒 waiter 注入 `[callee_stalled]`。
- **deadline 可选**：显式 `wait(deadline)` 才有任务级时限。
- **waiters 注册表 + 终态推送**：thread 持「谁在等我」一等字段；终态即时 O(1) 推送到所有 waiter inbox（含原因）。等待图是一等数据结构，环（死锁）可检测可渲染。

## 3.3 回报 = 持久投递

`end({result})` 直接构造 ThreadMessage 落 creator inbox（durable append，父死活不影响写入成功）+ notifyThreadActivated；不经任何方法模拟。archive 是父侧消费到 child-end 消息后的**自治动作**——各改各的窗口。无 result 的 end 在父侧通知中显式标 `no_result`。

## 3.4 窗口共享（move）

ref（冻结快照，借方可见 staleness 可请求刷新）/ move（所有权移交，携版本号）。归还时版本比对：无并发修改直接吸收；双边修改 fail-loud 返回双版本由 caller 裁决，不静默覆盖。

---

# 4. observable —— 观测

**铁律**：旁路观测，不改变 Object 的行为。**观测是观察者的仪器，不是 agent 的能力**——debug/pause/global-pause/permission-decision 的配置，agent 既不控制也不感知（被观测者知道自己被观测，行为就变了）。唯一例外：agent 在 super flow 读自己**落盘的历史轨迹**做反思——数据可读，仪器不可感。

## 4.1 记录

- llm.input/output 快照 + loop 级 debug（每轮 input/output/meta + windowsSnapshot content hash），供 Time Machine 与 diff。
- ContextSnapshot 与 system XML 同源——UI 渲染结构化字段，不 re-parse XML。
- **观测数据有预算**（A3 自反）：loop debug 滚动上限；陈年 events 分段折叠；日志采样丢弃带 `(已省略 ×N)` 标记——丢弃本身可观测。

## 4.2 介入

PauseChecker 在 tool 分派前生效；permission-decision 对 pending call 下 approve/reject。两者都是观察者平面的仪器。

## 4.3 系统自观测

- **activity 全量快照**：jobs（running 含 ageMs / queued / 终态）+ **threads（running / waiting 含等待对象与心跳状态 / paused / 最近 failed）** + resources（debug 体积 / worktree 数 / 队列深度 / 租约过期数）。「系统看似空闲、实有线程挂起」不可表示。
- **租约模型统一治理长跑实体**：running job、executing form、waiting thread、session worktree 全部带租约，持有者续约，过期由各自回收器处置。「不死的僵尸」不可表示。
- job 队列落盘，重启恢复；yield 即自入队。
- **错误传播 ≤ 1 跳**：failure 零等待到达利益相关方；lastError 随 status 翻新。

---

# 5. reflectable —— 反思与自我演化

**核心**：业务 session 试验 → super flow 合入的自我演化闭环。reflectable 不是新机制，是 talk-delivery / stone / pool / knowledge 在受保护 super session 下的协同。

## 5.1 super flow

- 硬编码 `sessionId="super"` 的受保护通道；`talk(target="super")` 自指别名派进自己的反思分身。
- super 是 self-scoped：只观察/修改自己，从不跨 object；不开业务任务。
- 一切「自我相关」动作收敛于此：自观测（读落盘轨迹）、沉淀、合入、治理配合。

## 5.2 沉淀（sediment）

运行时事实型知识（memory/relations）落 pool，写就生效、经写入 gate 保护（见 1.2）。seed 是先天能力基底（进 git、改动走评审），sediment 是后天经验——双源并存，同名 sediment 覆盖 seed。

## 5.3 演化合入（evolve_self）

- session 内一切 stone 写落 session worktree（试穿的自我），main canonical 不动。
- `evolve_self` 是唯一身份合入闸门：commit → 分类——self-scope（只改自己）自治 ff-merge；cross-scope（改别人/建新对象）转 PR-Issue 由 supervisor 决议。
- **end 必须显式处置未合入改动**：dirty session 的 end 三选一——evolve / discard / defer（转 PR-Issue 挂起）。「改动静默湮灭」不可表示（A1）。
- 合入 = commit + merge + 失效通知 + GC，四步可查询可重试；orphan worktree 由租约回收，GC 失败是一等错误。

## 5.4 自我迭代的两个层次

层次 A = Object 改自己的 stone（上述闭环）；层次 B = Object 改 OOC 框架源码（dogfooding 终态），经「B 归约为 A」路径渐进——元循环地板（加载 stone/跑 thinkloop/连 LLM 的硬内核）使完全自我迭代是渐近线而非布尔可达，这是反射系统的本性。

---

# 6. programmable —— 自编程

**核心**：Object 为自己编写并热更方法库。自写 `executable/index.ts`（`export const window` 的 methods 字典，与内置 window method 完全同构）+ 可选 ui_methods。

## 6.1 写→测→改在 session 内闭环

session 真相原则（A2 推论）下：agent 在 session 里写自己的方法 → **当场可调、当场可测**（session 内一切 method 解析指向 worktree，loader 按 mtime 自动 re-import，编辑即生效，零新增监听）→ 改完满意 → end 时 evolve 合入 → 全局生效（合入触发失效通知，registry 重建）。试错环路不出 session。

## 6.2 注入与纪律

- ProgramSelf（dir / callMethod / getData / setData / threadLocal）注入 ts/js sandbox；shell 经 `$OOC_SELF_DIR` 指向 session worktree。
- sandbox callMethod 与 exec 同链解析（含继承方法，见 0.2 调用面统一）。
- 纪律由机制承载：列表分页是 schema 的投影；大结果截断是信封的职责；自改方法集的准入是 permission deny 档——agent 写方法只管业务逻辑。

---

# 7. readable —— LLM 侧外观

**核心**：Object 怎样被读，由 Object 自己控制。同一 Object、两个观众（LLM/人类）、两条展示线——readable 是「给 AI 看的 toString()」。

- **两面一槽**：静态 readable.md（名片：找我做什么）与动态 readable.ts（按状态算 XML）是同一 `<readable>` 槽位的两种来源，回退链：动态 hook → 磁盘 readable.ts → readable.md → **沿 class 链文件级回退** → 诊断占位符（永不静默空白）。
- **window method 只动展示态**：读 windowState、返回新 state、不碰业务数据；经 registerReadable 注册，与 executable 物理分维、同名 fail-loud。
- **compressView**：折叠/快照态渲染，预算紧张时 Object 仍给出元信息——「清晰度档位」是接口的一部分。
- readable 是对外公开自述的**唯一载体**——Object 被外界认知只有这一条路。

---

# 8. visible —— 人类侧外观

**核心**：Object 持有并演化自身 UI；**类的脸就是实例的缺省脸**。

- **继承式渲染**：实例无自有 `visible/index.tsx` → 沿 class 链取 class 的组件按实例数据渲染（file class 的 viewer 服务所有 file 实例）；own 遮蔽 class；链上全无才落 Stone fallback（self/readable/knowledge/recent flows 的自动名片）。
- **scope 二分**：stone 单页 `visible/index.tsx`（跨 session 稳定主页）/ flow 多页 `client/pages/`（session 内任务视图）——临时状态不进 stone client。
- **ooc:// 寻址**：Agent 知识侧只产出稳定 `ooc://client/...` URI，1:1 映射 SPA route，不写易漂移的物理路径。
- **ui_methods**：人类面调用通道，是 capability declaration 的人类侧投影（见 10.3），与 LLM 侧 method 同链解析——继承来的 UI 上按钮永远调得通。
- **改 UI 即演化**：session worktree 里改 tsx 当场预览（session 真相原则覆盖 visible），evolve 合入后全局生效。
- displayName 自 self.md 首行派生（显式契约）；派生失败双面提示（UI 标注 + super flow 提醒），不静默降级。

---

# 9. persistable —— 持久

**核心**：Object 的身份、事实、产物离开内存后能从磁盘恢复成同一个自己。三棵子树各有明确定位与机制强度（A4：非对称显式声明）：

| 子树 | 定位 | 隔离 | 闸门 | 回滚 |
|------|------|------|------|------|
| `stones/` | 高赌注 canonical：五件套设计源码 | session worktree | evolve_self / PR-Issue | git revert / rollback |
| `pools/` | **多 session 公用自由工作区**：不该合入 stone、也不该随会话回收的文档与数据 | 无（by design） | 仅 knowledge 子树过写入 gate；跨对象写默认拒 | 不承诺（工作区语义） |
| `flows/` | 运行态：thread / debug / session 数据 | 天然 per-session | 无 | 删 session |

## 9.1 session worktree 模型

- 每个业务 session = 从 stones/main eager 派生的 git worktree（分支 `session-<sid>`，物理落点 `flows/<sid>/`），身份与运行时同落 `objects/<id>/`。
- **session 真相原则**：session 内五件套读取（含 method 解析、身份注入、UI 预览、shell env）一律指向 worktree——主路径而非 fallback。「在哪个 session 问，看到哪个 session 的真相」是无例外的系统不变量。
- **两条进入 canonical 的通道**：LLM 演化（worktree → evolve_self）与人类控制面（HTTP 直写 commit main）。**一切 canonical 写以失效通知收尾**（公约）：写入即广播，registry/loader/前端缓存订阅重建——「写入已发生但旧定义仍在服务」不可表示（A2）。
- **新对象**：`create_object` 落 session worktree，仅本 session 可见（worktree 真相原则覆盖五件套）；全局可见的唯一通道 = evolve 合入。其它 session 触达未合入对象时得到明确错误，不静默降级。

## 9.2 边界纪律

一切路径计算与 IO 集中在 persistable；其它维度只经 ref 原语（StoneObjectRef / FlowObjectRef / PoolObjectRef / ThreadPersistenceRef）访问磁盘，**永不自拼路径**——新增消费方必经 resolve 原语（公约）。thread-context.json 是 contextWindows 的唯一权威落盘，writeThread 单点刷。

---

# 10. 横切层

## 10.1 app —— 控制面

人类面入口：HTTP 控制面（Elysia）+ Web 前端（Vite+React）。

- 显式 runtime orchestration：建线程、入队 job、pause/resume 经 job 语义串起；**job 队列落盘**，重启恢复；不发明第二状态源——只把 world/thread/runtime 既有状态翻译成人读界面。
- URL 是前端单向真相（导航字段从 route 派生）；服务端推送（SSE）为主、轮询降级——长任务期间用户可见性无间隙。
- 错误统一 AppServerError 信封；启动必须显式 `--world`。

## 10.2 extendable —— 外接集成层（非维度）

外部世界（飞书/notion/slack/github）按统一模板接入为 Window + 共用 helper：单层 Window 不建 Adapter 对象（外部系统不构成自我）；写类命令强制 dry-run gate（首次 submit 只预览，confirm 才真发）；OAPI 细节物理隔离在 `extendable/<name>/`，不污染核心维度。

## 10.3 业务能力可达性（capability declaration）

业务能力在定义处声明 `expose: {agent, human, reason?}`，框架投影**可达性兜底**：agent 面 method、人类面 endpoint + schema 派生默认表单。投影保证「能不能做」；优质体验各自手写（visible 组件 / method 包装），投影不侵入。显式单面进非对称登记表（含理由），作为体验官与 e2e 的检查清单。观察者平面与治理平面（人是 git 闸门的最终持有者）整体不在此准则内。

## 10.4 工程自举（dogfooding）

OOC 用自己组织自己的工程：Supervisor（哲学层，对象树 design）+ 9 AgentOfX（维度落地）+ AgentOfExperience（真用户视角横切体验，现实校准源）。外循环（哲学→design→指导→汇总）套内循环（调研→设计→实现→测试→反馈），**每轮以经验沉淀收尾**（docs 复盘 / memory / 对象树回流）。质量基线：e2e 双观察孔（用户视角 + 机制视角同时过）、三档评分（Good/OK/Bad，门槛 ≥OK，Bad 是真信号）、storybook 双 tier（控制面确定性进 CI + agent-native 真 LLM）。自托管链路本身是 OOC 最强测试场：撑不起自己的工程协作，就撑不起任何外部 multi-agent 场景。

---

## 收束

整棵树自洽于一句话：**OOC 是一个让 Object 在被观察、被治理的前提下，安全地思考、行动、协作并改写自己的系统**——思考有预算、行动有协议、协作有检活、观测不扰动、演化经闸门、真相只有一处、能力双面可达、机制的每一跳要么有保证要么有信号。

本文是对照基准：实现与本文分歧时，要么改实现，要么经 grill 修订本文——不允许第三种状态（静默漂移）。各节内容随落地逐步回流对象树各维度对象（self.md / knowledge），本文最终退役为历史快照。
