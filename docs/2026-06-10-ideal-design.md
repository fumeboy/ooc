# OOC 理想机制设计（North Star，2026-06-10，grill 修订 v2）

> 性质：设计基准文档。由 [2026-06-10-cognitive-audit-report.md](./2026-06-10-cognitive-audit-report.md) 的问题**反射**出理想态——回答「如果这些机制从一开始就设计对，应该长什么样」。
> 用法：后续优化以本文为根出发（design-first），而不是逐个问题打补丁（patch-driven）；每次修复前先对照本文确认「修完后是否更接近理想态」，防止偏航。
> **修订记录**：v2（2026-06-10）经一轮 12 问 grill 逐章质询定稿——公理 3 修正表述、原公理 4 降级为准则、pool 定位重写、pending 对象砍除、visible 继承反转、debug/pause 划出 parity；定案全表见附录 C。

---

## 设计公理（四条）+ 一条准则

审计的 40+ 条发现收敛为四类根因；理想系统用以下公理把这四类根因变成**不可表示的状态**（make illegal states unrepresentable）：

1. **闭环机制完备公理**：一条设计闭环的每一跳，要么有机制保证（gate），要么有可观测的断裂信号（signal）。LLM 的自由度只存在于「决策内容」层，不存在于「协议完整性」层——LLM 可以决定写什么沉淀，但「沉淀必须可被激活」由系统保证。
2. **单一真相源公理**：任何状态只有一个权威落点；registry、渲染、快照、缓存都是派生视图，由统一事件驱动失效与重建。「写入已发生但旧视图仍在服务」是不可表示的状态。**session 推论（grill Q9）**：flow session 派生自 stones/main，则 session 内的真相就是 session worktree——在哪个 session 问，看到哪个 session 的真相，五件套无一例外。
3. **有限性公理**（grill Q2 修正）：一切等待有**检活**（期限是可选的业务语义），一切资源有配额，一切终态必传播。「永恒挂起」「无限增长」「死了没人知道」是不可表示的状态——但「活跃的长等待」（callee 心跳不断）合法且不受打扰。
4. **全件套语义公理**：继承与隔离作用于五件套整体。不存在「部分继承」「部分隔离」的静默中间态；任何非对称（某层机制弱化）必须显式声明并可被查询——公理要求的是**显式**，不是强行对称重型（grill Q8/Q11 双向检验：visible 继承豁免被推翻、pool 弱机制被显式化）。

**业务能力可达性准则**（原「双面投影公理」，经 grill Q3/Q12 两次收窄后降级）：**业务能力**默认双面可达——能力声明一次，框架投影兜底入口（agent 面 method / 人类面 endpoint+默认表单），优质体验各自手写。**范围限定**：仅业务能力层；观察者平面（debug/pause 等仪器）与治理平面（PR-Issue 决议、rollback）不在其内，agent 既不控制也不感知（见第六、七章）。

以下七章按子系统展开理想机制。

---

## 第一章：知识系统

### 1.1 知识可见性自声明（audience，三值）

知识的可见范围由**知识自己声明**，而不是由「它走哪条继承链」隐式决定。frontmatter 增加单一字段：

```yaml
audience: self | children | instances   # 缺省 self
```

- `self`：仅本对象激活（sediment 缺省值）。
- `children`：沿目录嵌套链下传（取代 `inheritable: true`）。
- `instances`：沿 class 链下传给实例（class seed 的缺省值——保留「类设计天然流向实例」的直觉，但变成显式缺省而非隐式硬编码）。

目录链与 class 链的 loader **消费同一字段**。混合继承场景的叠加顺序成为 loader 显式契约并有测试钉死。

> grill Q4 裁决：不设 `world` 档——对外公开自述的唯一载体是 readable（静态 .md / 动态 .ts），不开第三条「被外界认知」的路。未来若出现按条件对外暴露细粒度知识的真实场景，优先评估 readable.ts 动态渲染而非扩 audience。

### 1.2 写入即契约（write-time contract）

**系统边界 = 校验点**。接入激活回路的持久数据，在写入边界统一过 contract gate：

- sediment（`pools/<self>/knowledge/`）写入：frontmatter schema parse 失败 → **deny + 回灌模板**。死知识在理想系统中**无法产生**。
- **gate schema 归 core 协议层**（grill Q1）：与 4 个 tool 原语同级的稳定面——必填最小集（title / description / activates_on）随框架版本演进，**开放扩展字段**留给 agent 的格式创新；协议演化走提案与框架发版，不走绕 gate。
- gate 只验「协议完整性」（格式与必填），不验「内容对错」——后者属 LLM 决策自由与 super flow 反思范畴。
- gate 的作用域跟随激活回路：pool 的 knowledge 子树过 gate，pool 其余部分零校验（见 4.1）。

### 1.3 激活的完全可见性

LLM 对知识系统的状态**没有盲区**：

- **摘要态可展开**：`show_description` 态的知识窗口自带标准展开动作（窗口渲染中声明 `open_knowledge` 可用），展开是协议的一部分而非 LLM 的先验。
- **被排除可召回**：预算排除的窗口在 overflow 列表中带「如何召回」指令（compress 其它窗口 / 显式 open path）。
- **synthetic 资源不可误操作**：系统合成的临时对象要么不暴露 id，要么标记 `synthetic` 并在被误操作时返回带恢复路径的错误。LLM 看到的一切 id 都应是可操作的，或明确标注不可操作。

### 1.4 单一窗口真相

LLM 每轮实际看到的窗口集合只有一份权威（含 pipeline 派生窗口）；trigger 求值、观测快照、permission 检查消费同一份集合。「窗口实际在 context 里但 trigger 永远无法命中它」是不可表示的状态。

---

## 第二章：行动协议

### 2.1 schema 是渐进式执行的动力源（grill Q5 修订）

设计愿景：**像填电子表单——每填一项，旁边弹出该项怎么写的提示**。机制分三拍：

1. **意图先行，惰性披露**：method 平时在窗口上只露名字与一句意图描述，**不渲染参数签名**（不占 context）。LLM 只传「要做什么」即可 exec。
2. **缺参即开表单**：args 不齐 → 自动开 method_exec form → 此刻才按 schema 渲染 fill_state + 字段级提示 + 该 method 的激活知识（`method::` trigger），逐 refine 逐字段披露——渐进式执行伴随渐进式知识披露。
3. **执行完即回收**：form 关闭 → 表单渲染消失 + 知识引用计数释放，context 回到轻态。

schema 因此是**注册期必备**（它是「提示永远有的可弹」的保证），但**永不常驻 context**。豁免分两档：

- **自动豁免**（框架判定，零仪式感）：不消费 args 的方法、协议推进类方法（refine/submit/wait/close）——它们不走缺参开 form 路径，天然无披露需求。
- **显式豁免**（须 reason）：消费 args 却不提供 schema 的才写 `schema: "none" + reason`（如参数完全自由形态的 program 代码体）——豁免声明不通胀，警示牌只立在真该警惕处。

存量缺口集中在零参/协议方法（审计实测 builtins 26/26 已有 schema），**注册期 fail-loud 直接上线，无需 warn 过渡期**。auto-submit（args 一次给齐、不引入新知识）依然合法，结果信封携带 `accumulatedArgs` 回执。

### 2.2 校验分级：advisory / blocking

fail-soft 保留为缺省（保护 LLM 的灵活性），但 schema 字段可标级：

- `advisory`（缺省）：invalid 标记进 fill_state，不拦 submit——LLM 看到信号自行决断。
- `blocking`：invalid 拦 submit，必须 refine 修复。用于「执行错参数的代价 >> 多走一轮 form」的字段（删除路径、外发消息目标等）。

校验在 exec 路径与 ui callMethod 路径**同点生效**（同一 schema 投影）。

### 2.3 统一结果信封（grill Q6 修订：行级截断）

所有 method 结果经统一信封返回，超限自动截断——**统一行级**：保头尾各 N 行 + 中间 `…[已截断，省略 K 行，完整结果见 <path>]`。截断标记必须醒目，杜绝 LLM 幻觉补全；完整版落盘，`open_file` 可取全量。不做结构级解析（实现简单优先）；阈值独立常量起步。截断是**信封的职责**，不是 method 作者的自觉。

### 2.4 form 生命周期完备

- **executing 有租约**：form 进入 executing 时带 deadline；超时 → status=failed + 超时错误进 result，LLM 可 refine 重试。「form 永远卡 executing」不可表示。
- **close 留墓碑**：关闭带状态的窗口（form/talk/do）留可恢复摘要（tombstone：accumulatedArgs、最后状态、恢复方式）。close 有未消费消息/executing form 时返回警告，需确认参数二次提交。
- **constructor 唯一性**：注册期断言每 type 至多一个 `kind:"constructor"`，违反 fail-loud。

### 2.5 permission 的无人值守语义

ask 档的决议属观察者平面（人类经控制面决议）；无人值守时按 method 声明降级——缺省 **deny-safe**（超时拒绝 + 拒绝原因进 events，LLM 可改道），可声明 allow-with-audit。「ask 永久挂起」不可表示。deny 档真实存在且非空（自改方法集、跨界写等至少入列）。（上浮 parent 决议的方案未定，留议。）

---

## 第三章：协作与等待

### 3.1 等待契约：检活为主，期限可选（grill Q2 修订）

把「检活」和「超时」拆成两个机制：

1. **检活靠租约心跳**：子线程每轮 thinkloop 自动给 waiter 续约（「我还活着且在干活」）。心跳不断，父等多久都合法——深度子任务不被假超时打断。心跳断（callee 卡死/failed/进程没了）→ 短窗口内唤醒父 + 注入 `[callee_stalled]`。
2. **deadline 是可选业务语义**：LLM 显式传 `wait(deadline)` 才有任务级时限；缺省无 deadline、只有心跳检活。

「永恒挂起」不可表示，「活跃长协作」不受打扰。

### 3.2 终态即事件：waiters 注册表

thread 持一等字段 `waiters`（谁在等我）。终态（done/failed）发生时**立即** O(1) 推送到所有 waiter 的 inbox——不等下轮 scheduler tick 扫描，推送含终态原因。「callee 已死而 caller 不知道」的窗口期为零。等待图成为一等数据结构：可检测环（死锁）、可在观测面渲染（见第六章）。

### 3.3 回报 = 持久投递（grill Q7 修订：不做事务）

`end({result})` 的回报**不经 continue 模拟**——直接构造 ThreadMessage、走 `persistInboxMessages` 落进 creator thread 的 inbox（per-message 文件、append-only、幂等）+ `notifyThreadActivated`。inbox 写是纯本地磁盘追加，**父线程死活不影响写入成功**，父复活自然消费——「事务 vs 孤儿」的争论被釜底抽薪。

- 唯一剩余失败模式是磁盘级故障 → fail-loud 进 events（系统异常，不属协作协议）。
- **archive 是父侧自治动作**：父消费到 child-end 消息时自己收 do_window——各改各的窗口，消灭「子线程 mutate 父窗口」的层次违例。
- 子 end 即翻 done 退场，无卡滞状态；无 result 的 end 在父侧通知中显式标 `no_result`。

### 3.4 共享窗口的版本语义

`do_window.move` 的 ref/move 携带版本号（owner 侧修改计数）：ref 的 borrower 可见 `staleness` 并可请求刷新；move 归还时版本比对——无并发修改直接吸收，双边修改 fail-loud 返回双版本由 caller 显式裁决，不静默覆盖。

### 3.5 多对一回报的来源语义

同一窗口聚合多个 callee 回报时，渲染按来源分组（`<msg from="alice">` / `<msg from="bob">`），「同一窗口、多个声音」是渲染协议的一部分而非 LLM 的推断任务。

---

## 第四章：持久层与演化

### 4.1 三层定位（grill Q8 修订：pool = 自由工作区）

stone / pool / flow 各自**显式声明**机制强度（公理 4 要求显式，不要求对称重型）：

| 层 | 定位 | 试验隔离 | 合入闸门 | 回滚原语 |
|---|---|---|---|---|
| stone（身份/设计） | 高赌注 canonical | session worktree | evolve_self（self-scope ff / cross-scope PR-Issue） | git revert / rollback 端点 |
| pool（共用工作区） | **低机制自由区** | 无（by design：多 session 公用） | 仅 `knowledge/` 子树过 1.2 gate（因接入激活回路） | 不承诺（工作区语义） |
| flow（运行态） | ephemeral | 天然 per-session | 无 | 删 session |

pool 的心智模型：**多 session 公用的工作区目录**——不该合入 stone、也不该随会话回收的文档/数据文件，自由放置，不需要强机制。仅两条最小纪律：① knowledge 子树写入过 gate（协议完整性，非内容治理）；② 跨对象 pool 写（`pools/<other>/`）默认拒——一行路径检查，堵「直接改别人记忆」这个无合法场景的口子。

### 4.2 session 真相原则（grill Q9 修订：解析规则而非重构工程）

**不变量：在哪个 session 问，看到哪个 session 的真相，五件套无一例外。**

- **session 级真相**：业务 session 内一切身份/方法/UI 读取（含 exec 分派的 method 解析）指向 `flows/<sid>/objects/X/` worktree——这是主路径不是 fallback。dispatch 从 `thread.persistence.sessionId` 导出 worktree ref，经 loader 直读；loader 既有 mtime 键缓存（`?t=mtime`）天然满足「编辑即生效」，**零新增监听**。session 结束，session 级真相随 worktree 消亡。
- **全局级真相**：registry 缓存 stones/main canonical，由 `stone:changed` 事件链失效重建——该链**已半存在**（stoneRegistry 事件 + world-runtime 订阅 invalidate+registerStone），理想态只需两步：从 dev-only 提升为**常开**；evolve_self 合入成功显式触发（对称 HTTP 直写路径的 registerStone）。
- **公约代替重构**：不另立 Identity Resolver / 事件总线工程项，立两条公约进维度设计文档——「新增身份读取消费方必经 resolveStoneIdentityRef 系列原语」「新增 stone 写路径必以失效通知收尾」。升级判据：写路径或消费方超过 5 个、或再现「忘了通知」类 bug，公约升级为机制。

### 4.3 演化单元的生命周期完备

session 的「未合入改动」是**一等状态**（`evolveSelfDiff` 非空即 dirty）：

- **end 必须显式处置**：dirty session 的 end 要求三选一——`evolve`（进 super flow 合入）/ `discard`（显式放弃）/ `defer`（转 PR-Issue 挂起，supervisor 可见）。「改动静默湮灭」不可表示。
- **orphan 由租约回收**：worktree / session 分支带租约，session 存活则续约；周期 GC 收割过期租约（不只启动期）。GC 失败是一等错误（进 activity 快照与告警），不是 console.warn。
- **合入即同步**：evolve 成功 = commit + merge + 失效通知（4.2）+ GC——任何一步失败，整体状态可查询、可重试。

### 4.4 新对象的可见性（grill Q10 修订：不建 pending 机制）

**session 内 create_object 仅本 session 可见**（4.2 的 session 真相原则天然覆盖——新对象在本 session 五件套全可用）；**全局可见的唯一通道 = super flow evolve_self 合入 stones/main**（新对象 ≠ 作者 → cross-scope → PR-Issue）。

不建 pending 状态机。两个轻量配套：create_object 返回文案写明这条边界；其它 session talk 到未合入对象时返回明确错误（「对象 X 在 session s1 试验区，尚未合入」）而非静默建空 flow——边界对 LLM 可见，但不为它建机制。

---

## 第五章：外观与继承

### 5.1 五件套全链继承（grill Q11 修订：visible 必须继承）

class 链回退覆盖五件套**全部**，无豁免：method、window method、knowledge、readable（含磁盘 readable.md/.ts 文件级）、**visible（含磁盘 index.tsx 文件级）**。

visible 继承的决定性案例：file object——成百上千的 file 实例理应共享 file class 的通用渲染器（按实例数据参数化，props 进 `{window}`），让每个实例自定义 viewer 才是荒谬的。这就是 OO 继承 `toString()` 的直觉：**类的脸就是实例的缺省脸**，own `visible/index.tsx` 遮蔽 class（标准 override）。Stone fallback 退居「连 class 链上都没有 visible」时的最终兜底。

### 5.2 调用面统一（含 ui_methods）

一切方法解析——LLM `exec`、sandbox `self.callMethod`、HTTP `callMethod`（ui_methods）——走**同一条** class 链解析算法（resolveMethod + declaringType 校验）。系统中不存在第二条 lookup 路径。这同时是 5.1 的一致性前提：继承来的 class UI 内部调的 ui_methods 必须同链可达，否则「继承到的脸上按钮失灵」。

### 5.3 身份-行为漂移检测

实例记录实例化时的 class 版本（commit hash）。class 升级后：synthesizer 渲染 self window 时注入「你的 self.md 快照基于 class v\<old\>，class 已升至 v\<new\>」；agent 在 super flow 自查差异、自主更新 own 身份——**检测是系统的，更新是 agent 的**（自我叙事权归 Object）。

### 5.4 展示派生的显式契约

displayName 等「从身份文件派生」的 UI 字段，其派生规则是 self.md 的显式契约（写进出厂身份协议：「第一行 `# 标题` 是你的显示名」）。派生失败在 UI 标注 + 在 agent 的 super flow 提示——双面可见，不静默降级。

---

## 第六章：观测与治理

**前提铁律（grill Q12 重申）**：观测是**观察者的仪器**，不是 agent 的能力。debug/pause/global-pause/permission-decision 配置 agent **既不控制也不感知**——被观测者知道自己被观测，行为就变了，违反「旁路观测不改变行为」。唯一例外：super flow 里 agent 读自己**落盘的历史轨迹**做反思（数据，归 reflectable）——它感知不到的是开关与配置（仪器，归观察者）。

### 6.1 activity 是全量系统快照

`/api/runtime/activity` 回答「现在系统里发生着什么」的**全部**：

- **jobs**：running（含 ageMs）/ queued / 最近终态；
- **threads**：running / **waiting（含等待对象、心跳状态、已等时长）** / paused / 最近 failed——等待图可渲染，环（死锁）一眼可见；
- **resources**：debug 体积、worktree 数、队列深度、租约过期数。

「系统看似空闲、实有线程永久挂起」不可表示——waiting 是快照的一等公民。

### 6.2 一切队列落盘，一切长跑有租约

- job 队列持久化；重启恢复 queued + 按租约回收僵尸 running。
- 长跑实体（running job、executing form、waiting thread、session worktree）统一**租约模型**：持有者续约，过期由各自回收器处置。「不死的僵尸」不可表示。
- scheduler_yielded 的续跑入队不依赖外部事件——yield 即自入队。

### 6.3 观测数据有预算

观测自身受公理 3 约束：loop debug 滚动上限（保留最近 N 轮 + 关键节点）；contextSnapshot 中的陈年 events 分段折叠；采样丢弃的日志带 `(已省略 ×N)` 标记——**丢弃本身可观测**。

### 6.4 错误传播 ≤ 1 跳

任何 failure 到达其利益相关方最多 1 跳、零等待：callee failed → waiter inbox 立即注入（3.2 推送）；thread failed → 控制面状态即时可见；lastError 随 status 翻新（resume 即清旧错）。「静默失败」与「迟到的错误」都不可表示。

---

## 第七章：业务能力的双面可达（grill Q3/Q12 修订）

### 7.1 能力声明（capability declaration）

**业务能力**在定义处声明双面暴露，框架投影**可达性兜底**：

```ts
expose: {
  agent: true | false,    // 投影为 object method（LLM 经 exec 调）
  human: true | false,    // 投影为 HTTP endpoint + schema 派生的默认表单
  reason?: string,        // 任一面为 false 时必填
}
```

- 投影保证的是「能不能做」不是「好不好用」：默认表单丑但能用；优质体验各自手写（Object 自写 visible/index.tsx、自写 method 包装），投影不侵入体验层。
- 新业务能力诞生即双面可达，「先做人类面、欠着 agent 面」的债务形态在结构上不再产生。ui_methods 与 HTTP 端点是同一 capability 的两个投影，不再两套手写。

### 7.2 范围限定与非对称登记

**不在双面可达范围内的两个平面**（by design，非缺口）：

- **观察者平面**：debug/pause/global-pause/permission-decision——观测仪器，agent 不感知（第六章铁律）。
- **治理平面**：resolve PR-Issue、rollback——人是 git 闸门的最终持有者。

业务能力层的显式单面（如 compress 为 agent 独占——人类思考无「预算」概念）进入可查询的登记表（含 reason），作为体验官与 e2e 的检查清单。审计的「17 端点缺口」按此重分类后，真缺口收缩为业务能力层的少数项（ui_methods callMethod 等）。

---

## 附录 A：理想机制 ↔ 审计发现 traceability

| 理想机制 | 化解的审计发现（编号见审计报告 §3-4） |
|---|---|
| 1.1 audience 三值 | 继承双轨语义相反、混合场景未定义 |
| 1.2 写入即契约 | Top#2 sediment 死知识 |
| 1.3/1.4 激活可见性 / 单一窗口真相 | synthetic id 陷阱、derived 窗口盲区、show_description 无导引 |
| 2.1/2.2 schema 动力源 + 分级校验 | 种子问题 2、fail-soft 无 blocking 档 |
| 2.3 结果信封 | 大结果仅 program 防护 |
| 2.4 form 生命周期 | form 卡 executing、close 不可恢复、双 constructor、auto-submit 黑箱 |
| 2.5 permission 降级 | Top#6 ask 永久阻塞 |
| 3.1/3.2 心跳检活 + 终态推送 | Top#3 wait 死等、callee failed 迟到 |
| 3.3 持久投递 | Top#5 end auto-reply 被吞（顺带修子改父窗口违例） |
| 3.4/3.5 版本语义 / 来源语义 | move 归还冲突、多对一归并 |
| 4.1 pool 自由工作区 | Top#2 pool 跨对象写（gate 范围收窄为 knowledge 子树） |
| 4.2 session 真相原则 | Top#1 自写方法 session 内不可测 + evolve 后 registry 陈旧 |
| 4.3 演化生命周期 | Top#7 改动湮灭、orphan worktree |
| 4.4 session 内可见性 | create_object 可见性窗口 |
| 5.1/5.2 全链继承 + 调用面统一 | Top#9 四轨不一致、callMethod 不走继承 |
| 5.3/5.4 漂移检测 / 派生契约 | self.md 快照漂移、displayName 静默降级 |
| 6.1-6.4 观测治理 | Top#3 waiting 盲区、Top#8 debug 无上限 + job 不落盘、错误迟到 |
| 7.x 业务能力双面可达 | Top#10 parity 缺口（经重分类后收缩至业务能力层） |

## 附录 B：演进路径建议（三波，每波 gate 全绿）

- **第一波（闭环与真相）**：1.2 写入 gate、3.3 持久投递、3.1/3.2 心跳检活+终态推送、**4.2 session 真相原则（dispatch session 解析 + stone:changed 常开 + evolve 补注册——grill 后从第二波提前）**、4.3 演化生命周期（end 处置 + orphan GC）、2.5 permission 降级、6.2/6.3 租约与预算。特征：加 gate / 加信号 / 改解析规则，改动局部、收益即时。
- **第二波（协议完备）**：2.1 schema 必备+渐进披露强化、2.3 结果信封、2.4 form 生命周期、5.1/5.2 全链继承+调用面统一、1.1 audience 三值、1.4 单一窗口真相。特征：协议与解析层升级，部分涉及存量 method 补 schema。
- **第三波（结构化）**：7.x capability declaration、3.4 共享窗口版本语义、5.3 漂移检测、6.1 activity 全量化。特征：新机制引入，依赖前两波的地基。

每项落地时同步回流对应维度对象的 self.md / knowledge（设计权威迁移），并在本文标注落地状态——本文随实现演进而收敛，最终各章内容应全部「活进」对象树，本文退役为历史快照。

## 附录 C：grill 定案记录（2026-06-10，12 问）

| # | 议题 | 定案 |
|---|------|------|
| Q1 | gate vs 元编程 | gate schema 归 core、最小必填集（title/description/activates_on）+ 开放扩展 |
| Q2 | 等待期限 | 公理 3 修正：心跳检活为主，deadline 可选业务语义 |
| Q3 | 双面投影 | 收窄为「可达性」：投影兜底 + 体验手写 |
| Q4 | audience | 三值，砍 world；对外公开唯一走 readable |
| Q5 | schema 必备 | schema=渐进式执行动力源，注册期必备、context 惰性披露；零参/协议方法自动豁免；直接 fail-loud |
| Q6 | 截断 | 统一行级截断 + 醒目标记 + 落盘指针；不做结构级 |
| Q7 | 回报事务 | 不做事务：end → durable append 进 creator inbox；archive 父侧自治 |
| Q8 | pool | 定位修正：多 session 公用自由工作区；仅 knowledge 子树过 gate + 跨对象禁写；无版本化机制 |
| Q9 | 真相源 | session 真相原则：session 内五件套（含 method 解析）指向 worktree（loader mtime 保鲜）；全局 registry 靠 stone:changed 常开 + evolve 补注册；公约代替重构 |
| Q10 | 新对象 | 仅本 session 可见；全局唯一通道 = super flow 合入；不建 pending 机制 |
| Q11 | visible 继承 | 反转：visible 沿 class 链文件级继承（file 反例决定性）；ui_methods 解析同链；五件套全链继承无豁免 |
| Q12 | parity×安全 | debug/pause 族出圈：观察者仪器，agent 不感知；公理 4 降级为业务能力准则 |

**公理体检**：公理 1 ✓；公理 2 ✓（实现轻量化）；公理 3 ✎ 修正；原公理 4 ✗ 降级为准则；公理 5（现公理 4）✓ 经双向检验。

## 附录 D：第二轮 grill 定案（2026-06-10，6 问）+ 根本纠偏

| # | 议题 | 定案 |
|---|------|------|
| G1 | session 真相 × peer 自治 | session 内写入零拦截（含 cross-object 身份件），session=信任域；闸门只在 evolve→main；「暂时剔除」标注为有意识推迟，多方不信任场景出现时回看 |
| G2 | 心跳检活语义 | 心跳=合法状态驻留（runtime 校验非 thread 打卡）；检活沿等待链传递；环=死锁全环注入 |
| G3 | 遗弃 session 的 dirty 改动 | dirty 也直接收割，「不 end 即放弃」为写明的约定语义；「不可静默湮灭」收窄为「end 时必须显式处置」 |
| G4 | 系统兜底压缩 | 不做兜底：发送前本地预算检查失败 + 引导 LLM 自救（hard 阈值留物理余量）；屡救不应 → thread failed |
| G5 | evolve rebase 冲突 | 文件级自动重放 → 真冲突 super flow agent 自解（解自己身份的冲突是反思分内事）→ 解不了 defer |
| G6 | pool 共享张力 | 放开跨对象 pool 写（撤销首轮 Q8 的禁写），pool=真公用工作区；仅 knowledge 子树 gate 保留（格式合法性，与写者无关） |

**第二轮揭示的设计信条**（升格写入全貌树总信条）：「写入自由，合入设闸，失败响亮，事后治理」——边缘零拦截零兜底，core 硬闸门只有两道（知识写入 gate / evolve 合入闸）。

**根本纠偏（用户裁决）**：OOC 是少数简单设计的叠加涌现，不是机制的堆砌；LLM 足够聪明，框架只需让它好好为自己维护知识、实现能力、与用户互动。据此全貌树重构为「Part I Core 六闭环 / Part II 次级层（健壮性/治理/生态/打磨）」——permission、cross-scope PR-Issue 等全部移入次级层。本文（机制推导记录）保持原样作为过程文档；**全量基准以重构后的全貌树为准**。
