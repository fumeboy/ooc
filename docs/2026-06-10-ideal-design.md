# OOC 理想机制设计（North Star，2026-06-10）

> 性质：设计基准文档。由 [2026-06-10-cognitive-audit-report.md](./2026-06-10-cognitive-audit-report.md) 的问题**反射**出理想态——回答「如果这些机制从一开始就设计对，应该长什么样」。
> 用法：后续优化以本文为根出发（design-first），而不是逐个问题打补丁（patch-driven）；每次修复前先对照本文确认「修完后是否更接近理想态」，防止偏航。
> 本文只写理想态。与现状的差距映射见末尾附录，不混入正文。

---

## 设计公理（五条）

审计的 40+ 条发现收敛为四类根因；理想系统用五条公理把这四类根因变成**不可表示的状态**（make illegal states unrepresentable）：

1. **闭环机制完备公理**：一条设计闭环的每一跳，要么有机制保证（gate），要么有可观测的断裂信号（signal）。LLM 的自由度只存在于「决策内容」层，不存在于「协议完整性」层——LLM 可以决定写什么沉淀，但「沉淀必须可被激活」由系统保证。
2. **单一真相源公理**：任何状态只有一个权威落点；registry、渲染、快照、缓存都是派生视图，由统一事件驱动失效与重建。「写入已发生但旧视图仍在服务」是不可表示的状态。
3. **有限性公理**：一切等待有期限，一切资源有配额，一切终态必传播。「永恒等待」「无限增长」「死了没人知道」是不可表示的状态。
4. **双面投影公理**（agent-native parity 的机制化）：能力定义一次，人类面与 agent 面由框架投影生成；非对称必须显式登记理由。parity 靠结构保证，不靠逐个补齐。
5. **全件套语义公理**：继承与隔离作用于五件套整体。不存在「部分继承」「部分隔离」的静默中间态；任何非对称（某件不继承、某层不隔离）必须显式声明并可被查询。

以下七章按子系统展开理想机制。

---

## 第一章：知识系统

### 1.1 知识可见性自声明（audience）

知识的可见范围由**知识自己声明**，而不是由「它走哪条继承链」隐式决定。frontmatter 增加单一字段：

```yaml
audience: self | children | instances | world   # 缺省 self
```

- `self`：仅本对象激活（sediment 缺省值）。
- `children`：沿目录嵌套链下传（取代 `inheritable: true`）。
- `instances`：沿 class 链下传给实例（class seed 的缺省值——保留「类设计天然流向实例」的直觉，但变成显式缺省而非隐式硬编码）。
- `world`：任何对象与之 talk / 引用时可见。

目录链与 class 链的 loader **消费同一字段**。两条链的差异从「两种隐式默认」变成「两种显式缺省值」——可解释、可覆盖、可测试。混合继承场景（既有目录 parent 又有 parentClass）的叠加顺序成为 loader 的显式契约并有测试钉死。

### 1.2 写入即契约（write-time contract）

**系统边界 = 校验点**。任何进入持久层的结构化数据，在写入边界统一过 contract gate：

- sediment 写入：frontmatter schema parse 失败 → **deny + 回灌模板**（错误信息里带一份合法模板，LLM 下一轮照着写）。死知识在理想系统中**无法产生**——不是「产生了再巡检」，是写不进去。
- 同理适用于 relation 文件、data 写入、一切带 schema 的持久结构。
- gate 的语义是「协议完整性」而非「内容审查」：只验格式与必填字段，不验内容对错——内容对错属于 LLM 决策自由与 super flow 反思的范畴。

### 1.3 激活的完全可见性

LLM 对知识系统的状态**没有盲区**：

- **摘要态可展开**：`show_description` 态的知识窗口自带标准展开动作（窗口渲染中声明 `open_knowledge` 可用），展开是协议的一部分而非 LLM 的先验。
- **被排除可召回**：预算排除的窗口在 overflow 列表中带「如何召回」指令（compress 其它窗口 / 显式 open path）。
- **synthetic 资源不可误操作**：系统合成的临时对象（activator 派生知识窗等）要么不暴露 id，要么标记 `synthetic` 并在被误操作时返回带恢复路径的错误。LLM 看到的一切 id 都应是可操作的，或明确标注不可操作。

### 1.4 单一窗口真相

LLM 每轮实际看到的窗口集合只有一份权威（含 pipeline 派生窗口）；trigger 求值、观测快照、permission 检查消费同一份集合。「窗口实际在 context 里但 trigger 永远无法命中它」是不可表示的状态。

---

## 第二章：行动协议

### 2.1 schema 是 method 的必备件

method 注册期要求 schema：要么提供参数 schema，要么显式声明 `schema: "none"` 并附 reason（注册期 fail-loud）。schema 是单一来源，以下全部是它的投影：

- form 的 `<schema>`/`<fill_state>`/`<next_steps>` 渲染（LLM 面）；
- 参数校验；
- UI 的表单生成（人类面，对应公理 4）;
- 文档/能力目录生成。

「LLM 第一次调用某 method 靠方法名猜参数」是不可表示的状态。

### 2.2 校验分级：advisory / blocking

fail-soft 保留为缺省（保护 LLM 的灵活性），但 schema 字段可标级：

- `advisory`（缺省）：invalid 标记进 fill_state，不拦 submit——LLM 看到信号自行决断。
- `blocking`：invalid 拦 submit，必须 refine 修复。用于「执行错参数的代价 >> 多走一轮 form」的字段（删除路径、外发消息目标等）。

校验在 exec 路径与 ui callMethod 路径**同点生效**（同一 schema 投影）。

### 2.3 统一结果信封（outcome envelope）

所有 method 结果经统一信封返回：大小超限 → 自动截断 + 完整版落盘 + 信封内带指针（「完整结果在 \<path\>，可 open_file 查看」）。截断是**信封的职责**，不是 method 作者的自觉。method 作者只管返回业务结果，永远不需要考虑「会不会打爆下轮 context」。

### 2.4 form 生命周期完备

- **executing 有租约**：form 进入 executing 时带 deadline；超时 → status=failed + 超时错误进 result，LLM 可 refine 重试。「form 永远卡 executing」不可表示。
- **close 留墓碑**：关闭带状态的窗口（form/talk/do）留可恢复摘要（tombstone：accumulatedArgs、最后状态、恢复方式），误关可凭墓碑重建。close 有未消费消息/executing form 时返回警告，需确认参数二次提交。
- **constructor 唯一性**：注册期断言每 type 至多一个 `kind:"constructor"`，违反 fail-loud。
- **auto-submit 有回执**：跳过 form 直接执行时，结果信封携带 `accumulatedArgs` 回显——LLM 永远能确认「系统按什么参数执行了」。

### 2.5 permission 的完备降级链

每条 `ask` 档 method 声明无人值守时的 fallback，形成完备降级链：

```
ask → (有人) 人工决议
    → (无人，有 parent) escalate：决议请求进 parent inbox，parent LLM 或其人类决
    → (无人，无 parent，超时) 按声明降级：deny-safe（缺省）或 allow-with-audit
```

「ask 永久挂起」不可表示。deny 档真实存在且非空（自改方法集、跨界写等至少入列）。

---

## 第三章：协作与等待

### 3.1 等待契约：deadline 是 wait 的一等参数

`wait` 必须带期限（显式传入或系统缺省）。超时不是异常而是**一等结果**：超时消息注入 inbox（`[wait_timeout] 等待 <target> 超过 <n>s`），thread 翻回 running，LLM 拿到完整信息自行决策（重试 / 放弃 / 换路）。「永恒等待」不可表示。

### 3.2 终态即事件：waiters 注册表

thread 持一等字段 `waiters`（谁在等我）。终态（done/failed）发生时**立即** O(1) 推送到所有 waiter 的 inbox——不等下轮 scheduler tick 扫描。推送内容含终态原因（endReason/lastError）。「callee 已死而 caller 不知道」的窗口期为零。

由此「等待图」成为一等数据结构：可检测环（死锁）、可在观测面渲染（见第六章）。

### 3.3 回报通道的事务性

子→父回报是**事务**：`end({result})` 的语义 = 「回报送达 + 本轮结束」原子成立。

- auto-reply（result 转 continue）失败 → end 整体失败：do_window **不 archive**、子 thread 不翻 done、失败原因同时进子方 events 与**父方 inbox**。
- 「子认为已回报、父什么都没收到、窗口还被标完成」是不可表示的状态。
- 子既不 continue 也不传 result 直接 end → 父收到的系统通知里显式含 `no_result` 标记，父 LLM 知道「结束了但没给我东西」。

### 3.4 共享窗口的版本语义

`do_window.move` 的 ref/move 携带版本号（owner 侧修改计数）：

- **ref**：borrower 读取时可见 `staleness`（owner 已演化 n 版），可主动请求刷新快照。
- **move 归还**：版本比对——无并发修改则直接吸收；检测到双边修改则 fail-loud 返回双版本，由 caller（LLM）显式裁决，不静默覆盖。

### 3.5 多对一回报的来源语义

同一窗口聚合多个 callee 回报时，渲染按来源分组（`<msg from="alice">` / `<msg from="bob">`），「同一窗口、多个声音」是渲染协议的一部分而非 LLM 的推断任务。

---

## 第四章：持久层与演化

### 4.1 三层隔离模型对称化

stone / pool / flow 各自**显式回答同三问**——试验隔离？合入闸门？回滚原语？答案可以不同，但必须有答案：

| 层 | 赌注 | 试验隔离 | 合入闸门 | 回滚原语 |
|---|---|---|---|---|
| stone（身份/设计） | 高 | session worktree | evolve_self（self-scope ff / cross-scope PR-Issue） | git revert / rollback 端点 |
| pool（事实/沉淀） | 中 | **session staging**：业务 session 沉淀先落 `flows/<sid>/.sediment-stage/`，super flow 反思时 promote 进 pool | super flow promote（与反思动作天然同点——反思的产出就是「哪些沉淀值得转正」） | pool 写带版本戳 + 保留 N 代历史，可按戳回滚 |
| flow（运行态） | 低 | 天然隔离（per-session） | 无（ephemeral） | 删 session |

跨对象 pool 写与跨对象 stone 写同级——必须经对方可见的通道（talk 说服或 PR-Issue），不存在「直接写别人记忆」的路径。

> 备选弱形态：若 staging 被验证为过重（沉淀延迟损害「写就生效」的体验），退而求其次保留即写即生效，但版本戳 + 历史 + 回滚 + 跨对象禁写四项不可省——「中赌注层完全没有回滚原语」不是可接受的取舍。

### 4.2 身份解析单点化（Identity Resolver）

所有身份/源码读取（loader、registry、renderer、shell env、visible endpoint、knowledge loader）经**同一个 resolver**；session-aware 是 resolver 的属性，不是各 caller 的责任。系统不变量：

> **在哪个 session 里问，就看到哪个 session 的真相。**

业务 session 内：自己（和自己 worktree 里的一切）读 worktree 版本——写完 method 当场可调、当场可测；super flow / 控制面读 main canonical。「同一 session 内写读不一致」不可表示。

### 4.3 写路径事件总线

一切 stone 写（HTTP 直写、evolve_self 合入、fs.watch 热更、create_object）发布同一 `stone:changed` 事件；registry、loader 缓存、前端缓存都是订阅者，事件驱动失效 + 懒重建。

- 「evolve 合入成功但全局仍在用旧定义」不可表示。
- registry 显式定位为**缓存**（公理 2）：它没有独立生命周期，只有「跟随真相源失效重建」的生命周期。

### 4.4 演化单元的生命周期完备

session 的「未合入改动」是**一等状态**（可查询：`evolveSelfDiff` 非空即 dirty）：

- **end 必须显式处置**：dirty session 的 end form 要求三选一——`evolve`（进 super flow 合入）/ `discard`（显式放弃）/ `defer`（转 PR-Issue 挂起待办，supervisor 可见）。「改动静默湮灭」不可表示。
- **orphan 由租约回收**：worktree / session 分支带租约，session 存活则续约；周期 GC 收割过期租约（不只启动期）。GC 失败是一等错误（进 activity 快照与告警），不是 console.warn。
- **合入即同步**：evolve 成功 = commit + merge + 事件总线广播（4.3）+ GC，四步事务化——任何一步失败，整体状态可查询、可重试。

### 4.5 新对象的可见性分级

worktree 内新建的对象对世界呈现为 **pending 状态**：

- 可被发现（stone registry 列出，标 `pending: <sessionId>`）；
- 可接收消息（talk 投递进其 inbox 排队）；
- 身份不可读（self/readable 未合入，读取返回 pending 说明）；
- 合入后转正，排队消息开始消费。

协作方拿到的是明确的「它存在但还没出生」语义，而不是「时灵时不灵」的解析结果。

---

## 第五章：外观与继承

### 5.1 五件套全链继承

class 链回退覆盖五件套**全部**：method、window method、knowledge、readable（含磁盘 readable.md/.ts）、visible（含磁盘 index.tsx）。resolution 是 stone 级语义（读得到父类磁盘文件），不只是 registry 级语义（查得到内存定义）。

实例的体验是完整的：继承一个 class，就得到一个**能调、能看协议、有名片、有 UI**的完整对象；own 覆盖任何一件即遮蔽该件。不允许「继承了行为但没继承长相」的静默中间态（公理 5）；若某件设计上不继承，在 class 定义中显式声明并可查询。

### 5.2 调用面统一

一切方法调用——LLM `exec`、sandbox `self.callMethod`、HTTP `callMethod`——走**同一条** `resolveMethod`（沿 class 链回退 + declaringType 校验）。系统中不存在第二条 method lookup 路径。「同一个方法，exec 调得到、脚本里调不到」不可表示。

### 5.3 身份-行为漂移检测

实例记录实例化时的 class 版本（commit hash / 版本号）。class 升级后：

- synthesizer 渲染 self window 时注入一条系统提示：「你的 self.md 快照基于 class v\<old\>，class 已升至 v\<new\>」；
- agent 在 super flow 自查差异、自主更新 own 身份——**检测是系统的，更新是 agent 的**（自我叙事权归 Object，符合元编程哲学）。

### 5.4 展示派生的显式契约

displayName 等「从身份文件派生」的 UI 字段，其派生规则是 self.md 的显式契约（写进出厂身份协议：「第一行 `# 标题` 是你的显示名」）。agent 改坏格式时：派生失败在 UI 标注（「显示名派生失败，回退 id」）+ 在 agent 的 super flow 提示——双面都看得见，不静默降级。

---

## 第六章：观测与治理

### 6.1 activity 是全量系统快照

`/api/runtime/activity` 回答「现在系统里发生着什么」的**全部**：

- **jobs**：running（含 ageMs）/ queued / 最近终态;
- **threads**：running / **waiting（含等待对象与已等时长）** / paused / 最近 failed——等待图可渲染，环（死锁）可一眼看出；
- **resources**：debug 体积、worktree 数、队列深度、租约过期数。

「系统看似空闲、实有线程永久挂起」不可表示——waiting 是快照的一等公民。

### 6.2 一切队列落盘，一切长跑有租约

- job 队列持久化；重启恢复 queued + 按租约回收僵尸 running。
- 长跑实体（running job、executing form、waiting thread、session worktree）统一**租约模型**：持有者续约，过期由各自的回收器处置（fail / timeout-message / GC）。「不死的僵尸」不可表示。
- scheduler_yielded 的续跑入队不依赖外部事件——yield 即自入队。

### 6.3 观测数据有预算

观测自身受公理 3 约束：loop debug 滚动上限（保留最近 N 轮 + 关键节点）；contextSnapshot 中的陈年 events 分段折叠；采样丢弃的日志带 `(已省略 ×N)` 标记——**丢弃本身可观测**。

### 6.4 错误传播 ≤ 1 跳

任何 failure 到达其利益相关方最多 1 跳、零等待：callee failed → waiter inbox 立即注入（3.2 的推送）；thread failed → 控制面状态即时可见；lastError 随 status 翻新（resume 即清旧错）。「静默失败」与「迟到的错误」都不可表示。

---

## 第七章：parity 的机制化

### 7.1 能力声明（capability declaration）

每个能力在定义处声明双面暴露，由框架投影：

```ts
expose: {
  agent: true | false,    // 投影为 object method（LLM 经 exec 调）
  human: true | false,    // 投影为 HTTP endpoint + UI 表单（schema 投影，见 2.1）
  reason?: string,        // 任一面为 false 时必填
}
```

- 缺省双面 true。parity 由**结构**保证：新能力天然双面，不存在「先做人类面、欠着 agent 面」的债务形态。
- ui_methods 与 HTTP 端点不再是两套手写——同一 capability 的两个投影。

### 7.2 非对称登记表

显式单面的能力进入可查询的登记表（含 reason），成为体验官与 e2e 的检查清单：

- 合理的人类独占：治理裁决（resolve PR-Issue、rollback）——人是 git 闸门的最终持有者。
- 合理的 agent 独占：context 自我管理（compress）——人类思考没有「预算」概念。
- 其余一切（pause/resume、debug 开关、UI 方法、观测查询）：双面。agent 能暂停自己、能开自己的 debug、能调自己的 UI 方法、能查 activity——自我观测与自我控制本来就是 observable/reflectable 维度对 agent 的承诺。

---

## 附录 A：理想机制 ↔ 审计发现 traceability

| 理想机制 | 化解的审计发现（编号见审计报告 §3-4） |
|---|---|
| 1.1 audience 自声明 | 继承双轨语义相反、混合场景未定义 |
| 1.2 写入即契约 | Top#2 sediment 死知识（部分） |
| 1.3/1.4 激活可见性 / 单一窗口真相 | synthetic id 陷阱、derived 窗口盲区、show_description 无导引 |
| 2.1/2.2 schema 必备 + 分级校验 | 种子问题 2、fail-soft 无 blocking 档 |
| 2.3 结果信封 | 大结果仅 program 防护 |
| 2.4 form 生命周期 | form 卡 executing、close 不可恢复、双 constructor、auto-submit 黑箱 |
| 2.5 permission 降级链 | Top#6 ask 永久阻塞 |
| 3.1/3.2 等待契约 + 终态推送 | Top#3 wait 死等、callee failed 迟到 |
| 3.3 回报事务性 | Top#5 end auto-reply 被吞 |
| 3.4/3.5 版本语义 / 来源语义 | move 归还冲突、多对一归并 |
| 4.1 隔离对称化 | Top#2 pool 零隔离、跨对象 pool 写 |
| 4.2 Identity Resolver | Top#1 自写方法 session 内不可测 |
| 4.3 写路径事件总线 | Top#1 evolve 后 registry 陈旧 |
| 4.4 演化生命周期 | Top#7 改动湮灭、orphan worktree |
| 4.5 pending 对象 | create_object 可见性窗口 |
| 5.1/5.2 全链继承 + 调用面统一 | Top#9 四轨不一致、callMethod 不走继承 |
| 5.3/5.4 漂移检测 / 派生契约 | self.md 快照漂移、displayName 静默降级 |
| 6.1-6.4 观测治理 | Top#3 waiting 盲区、Top#8 debug 无上限 + job 不落盘、错误迟到 |
| 7.1/7.2 capability 投影 | Top#10 parity 17 端点缺口 |

## 附录 B：演进路径建议（三波，每波 gate 全绿）

理想态不是一次重写，按「先堵闭环、再统一真相、后机制化 parity」三波渐进——每波结束系统都比上一波更接近公理，且 storybook Tier A + e2e 全绿：

- **第一波（闭环与安全）**：1.2 写入契约、2.5 permission 降级链、3.1-3.3 等待与回报、4.4 演化生命周期、6.2/6.3 租约与预算。特征：多为加 gate / 加信号，改动局部、风险低、收益即时。
- **第二波（单一真相源）**：4.2 Identity Resolver、4.3 事件总线、1.4 单一窗口真相、5.2 调用面统一。特征：结构性重构，需要先有第一波的观测兜底。
- **第三波（语义完备）**：1.1 audience、2.1 schema 必备、4.1 pool staging、4.5 pending 对象、5.1 全链继承、7.x capability 投影。特征：协议/语义升级，部分涉及存量数据迁移与出厂协议文本更新。

每项落地时同步回流对应维度对象的 self.md / knowledge（设计权威迁移），并在本文标注落地状态——本文随实现演进而收敛，最终各章内容应全部「活进」对象树，本文退役为历史快照。
