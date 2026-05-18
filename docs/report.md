# OOC 系统多对象协作能力分析报告

## 1. 结论摘要

OOC 已经具备一套较完整的多对象协作基础设施，能力核心可分成三层：

1. **实时点对点协作层**：以 `talk_window` 和 `talk-delivery` 为核心，支持对象之间以及 user 与对象之间的持续一对一对话。
2. **线程/窗口化执行层**：以 `ContextWindow`、`do_window`、`command_exec`、线程状态流转为核心，支持父子线程分工、等待、回报和归档。
3. **长期结构化协作层**：以 `relation`、`kanban`、`role/supervisor` 为核心，支持长期关系记忆、Session 级多方任务协同，以及由 supervisor 进行总协调。

我更倾向把它定义为“**以 supervisor 为调度中心、以 talk 为通信原语、以 thread/window 为执行载体、以 kanban 为结构化协作骨架**”的多对象协作系统。为什么这样选：文档和代码都显示这四部分分别承担了调度、通信、运行、结构化协作的主职责。

## 2. 信息来源

本报告基于以下两类信息交叉分析：

- 文档：
  - `meta/object/collaborable/index.doc.ts`
  - `meta/object/collaborable/talk/index.doc.ts`
  - `meta/object/collaborable/relation/index.doc.ts`
  - `meta/object/collaborable/kanban/*.doc.ts`
  - `meta/object/collaborable/role/index.doc.ts`
  - `meta/object/collaborable/supervisor.doc.ts`
- 源码：
  - `src/executable/windows/types.ts`
  - `src/executable/windows/root/talk.ts`
  - `src/executable/windows/talk.ts`
  - `src/executable/windows/talk-delivery.ts`
  - `src/executable/windows/root/do.ts`
  - `src/executable/windows/do.ts`
  - `src/executable/windows/root/todo.ts`
  - `src/executable/windows/todo.ts`
  - `src/executable/windows/root/plan.ts`
  - `src/executable/windows/program.ts`
  - `src/executable/windows/manager.ts`
  - `src/app/server/runtime/thread-transition.ts`
  - `src/app/server/runtime/thread-query.ts`
  - `src/persistable/thread-json.ts`
  - `src/persistable/flow-object.ts`
  - `src/persistable/stone-object.ts`

## 3. 总体协作模型

### 3.1 协作能力分层

从 `Collaborable` 文档看，系统把多对象协作划分为四个子领域：

- `talk`：一对一通信
- `relation`：对象之间的长期有向关系
- `kanban`：Session 级结构化协作
- `role`：协作网络中的职责定位

其中 `supervisor` 是 `role` 的特化。

这套拆分比较合理，也有两个候选理解方式：

- 候选 A：把它看成消息系统外加任务系统
- 候选 B：把它看成对象协作语义层加线程执行层

我更倾向候选 B。为什么这样选：代码里不仅有消息投递，还有线程状态机、上下文窗口、持久化对象和角色语义，明显超出普通“消息+任务”系统。

### 3.2 核心对象与载体

多对象协作不是直接建立在“裸 LLM 对话”上，而是建立在以下载体之上：

- **Object**：协作主体
- **Thread**：某个对象在一次执行链路中的思考与执行单元
- **ContextWindow**：线程上下文中的持续可见实体
- **Flow Object / Stone Object**：分别承载 session 内运行态数据和 session 外静态身份/知识

`src/executable/windows/types.ts` 显示，系统统一把 root、command_exec、do、todo、talk、program、file、knowledge、search 等都抽象为 `ContextWindow`。这意味着多对象协作中的通信窗口、执行窗口、知识窗口在 LLM 视角下是同一种交互基元。

为什么这样选：统一窗口模型降低了调度和上下文管理复杂度，使协作能力能被一致地 `open / refine / submit / close / wait` 操作。

## 4. 已具备的多对象协作能力

### 4.1 对象间持续一对一对话

`Talk` 文档和 `src/executable/windows/talk.ts`、`talk-delivery.ts` 表明，系统已具备稳定的一对一持续对话原语：

- 可由 `root.talk` 创建新的 `talk_window`
- 同一对端可复用持续会话窗口，而不是一次性消息
- `talk_window` 支持 `say / wait / close`
- 消息会双写到 caller 的 outbox 与 callee 的 inbox
- 若 callee 线程处于 `waiting / done / failed`，收到消息后可翻回 `running`

这相当于对象之间的“可恢复、可持久化、可等待”的会话通道。

为什么这样选：相比普通消息队列，这里不仅有投递，还有 transcript、线程唤醒和 window 生命周期。

### 4.2 父子线程分工协作

从 `src/executable/windows/root/do.ts` 与 `src/executable/windows/do.ts` 看，系统支持通过 `do` fork 子线程，并在父线程中形成 `do_window`。

它带来的协作能力包括：

- 父线程可把任务拆给子线程执行
- 子线程拥有独立上下文和执行过程
- 父线程可 `wait(on=<do_window>)` 等待回报
- 子线程回报结果后，父线程恢复运行
- 完成的子线程/窗口可归档

候选模式有两种：

- 候选 A：把 `do` 看成内部函数调用
- 候选 B：把 `do` 看成对象内部的轻量协作者线程

我更倾向候选 B。为什么这样选：`do` 有独立 thread、窗口、状态流转和回报通道，更像协作单元而不是普通函数栈。

### 4.3 统一等待与唤醒机制

`thread-transition.ts`、`thread-query.ts` 与 `talk` 文档共同说明，系统已经实现较清晰的线程调度语义：

- 线程有 `running / waiting / done / failed` 等状态
- `wait` 不是自由文本语义，而是绑定某个 `talk_window` 或 `do_window` 的未来 IO
- 唤醒由 inbox 新消息或子线程回报触发
- 调度器只继续调度 `running` 线程

这是多对象协作真正能跑起来的关键。

为什么这样选：没有显式等待源和状态机，多个对象和多个线程之间会产生大量伪等待、误唤醒和不可恢复状态。

### 4.4 user → supervisor → 其他对象的分层协作入口

`supervisor.doc.ts` 明确了默认协作路径：

```text
user 输入
  -> 默认路由到 supervisor
  -> supervisor 规划
  -> supervisor 决定 talk 给哪些对象，或创建哪些 issue/task
```

这说明系统已具备一个天然的多对象协作入口：

- user 不需要了解对象网络
- supervisor 承担理解需求、拆解任务、协调对象的责任
- 普通对象无需暴露复杂入口，只需在被调度时处理自己的局部工作

为什么这样选：集中式入口降低了用户心智负担，也避免用户直接操作底层协作拓扑。

### 4.5 Session 级多方结构化协作

`kanban/index.doc.ts` 及其子文档表明，系统不仅支持 talk，还支持 Session 级结构化协作：

- `Issue`：问题/需求讨论单元
- `Task`：执行单元
- `Comment`：不可变讨论记录
- `reportPages`：对象可挂接自己的结果页面
- `hasNewInfo`：面向人类确认的红点机制

`Issue` 与 `Task` 是多对多关系，这使协作不再局限于“一条消息对应一个任务”，而是可形成跨对象、跨阶段的任务网络。

为什么这样选：复杂协作需要共享骨架，单纯 talk 很难支撑追溯、状态推进和全局可见性。

### 4.6 长期关系与局部视角记忆

`relation/index.doc.ts` 描述了对象间长期关系能力：

- 每个对象在 `stones/{selfId}/knowledge/relations/{peerId}.md` 下维护自己视角的 peer 关系
- 关系是**有向的、局部的、允许不对称的**
- 关系文件以 knowledge 形式按需激活
- 系统没有全局 relation 表

这意味着对象协作不只发生在一次 session 内，还可以借助“我如何看待对方”的长期记忆来影响后续协作。

为什么这样选：真实协作网络天然是局部认知和非对称关系，系统保留这种性质比强行全局化更贴近对象范式。

### 4.7 角色由知识与能力集决定，而不是硬编码类型

`role/index.doc.ts` 指出：

- 所有对象在目录结构上同构
- `.stone.json` / `.flow.json` 不带角色字段
- 角色来自 knowledge 与 server method 的叠加
- 一个对象可同时扮演多角色

这为多对象协作提供了很强的可演化性。

候选设计有两种：

- 候选 A：显式角色枚举，运行时按类型判断
- 候选 B：同构对象 + 语义角色叠加

我更倾向候选 B。为什么这样选：代码和文档都在强调对象平等、目录同构以及由 knowledge/server 能力决定角色。

## 5. 运行模型分析

### 5.1 通信模型：talk 是跨对象原语

从设计上看，跨对象协作最底层的通信原语就是 `talk`：

- `root.talk` 负责创建与目标对象的持续会话窗口
- `talk_window.say` 负责实际发消息
- `talk-delivery` 负责定位对端线程、写入 inbox/outbox、翻转状态

这说明系统采用的不是广播模型，也不是共享上下文模型，而是**点对点持续会话模型**。

为什么这样选：点对点会话更容易控制权限边界、唤醒语义和责任归属。

### 5.2 执行模型：线程是协作调度单位

线程不是附属概念，而是协作的基本执行容器：

- 每个对象通过线程承接输入并推进一次工作链路
- 子任务可 fork 为子线程
- 线程携带自己的 `contextWindows`
- 线程状态驱动调度器是否继续安排执行

因此多对象协作本质上是“多个对象线程 + 多个窗口之间的交互网络”。

为什么这样选：如果没有线程级隔离，多个协作分支会争抢同一上下文，导致状态难以管理。

### 5.3 持久化模型：协作状态可恢复

文档和 `thread-json.ts` 等实现表明，多对象协作状态是落盘的：

- thread 及其 window 状态会进入持久化数据
- `talk_window` 可在 server 重启后恢复
- stone/flow 目录分别承载静态与 session 内数据
- kanban 以 `flows/{sid}/issues|tasks/` 方式保留完整结构

这意味着系统具备“长事务式协作”的基础，而非一次进程内短暂编排。

为什么这样选：多对象协作往往跨多轮、多阶段，持久化是可靠恢复和追溯的前提。

## 6. 典型协作模式

### 6.1 supervisor 主导的集中式协作

这是文档中最明确的主模式：

1. user 把任务交给 supervisor
2. supervisor 创建 Issue
3. supervisor 向多个对象征询设计或分派任务
4. 对象通过 talk 回报
5. supervisor 创建/更新 Task，并继续分派
6. 最终由 supervisor 汇总并向 user 汇报

为什么这样选：这是系统当前最完整、权限最清晰的协作闭环。

### 6.2 talk + kanban 混合协作

文档明确指出二者经常并用：

- talk 负责局部即时沟通
- kanban 负责共享结构、状态跟踪、可视化对外呈现

这是我最推荐的理解方式。为什么这样选：复杂协作既需要灵活沟通，也需要共享状态骨架，单独依赖任一方都不够。

### 6.3 对象内并行分解

通过 `do` 机制，一个对象可以把复杂任务拆给多个子线程，形成“对象内部协作”。

这和“对象之间协作”虽然层级不同，但运行机制统一：

- 都依赖窗口化上下文
- 都依赖显式等待/回报
- 都依赖线程状态切换

为什么这样选：内部并发和外部协作复用同一调度语义，系统一致性更高。

### 6.4 基于关系记忆的协作个性化

虽然 relation 本身不直接调度任务，但它会影响对象在与特定 peer 交互时看到的 knowledge，上层可据此形成差异化协作风格。

为什么这样选：关系 knowledge 的激活条件就是与特定 peer 的 talk 上下文，这说明 relation 的价值是影响协作语义，而不是替代通信机制。

## 7. 边界与限制

### 7.1 当前通信主要是一对一，不是原生群聊

从文档和窗口类型看，系统原生强项是 `talk` 的一对一持续会话；多人协作主要通过 supervisor 转发或 kanban 汇聚来实现，而不是一个对象同时处在原生多方聊天室。

为什么这样选：`Talk` 文档明示它是一对一持续会话原语，kanban 才是多方结构化容器。

### 7.2 kanban 权限存在明显不对称

普通对象通过 issue-discussion 能力只能评论/讨论；真正修改 Issue/Task 结构与状态的能力集中在 supervisor。

这有两个候选评价：

- 候选 A：限制偏强，普通对象自治不足
- 候选 B：边界清晰，能减少结构污染

我更倾向候选 B。为什么这样选：对于早期协作系统，先保证结构化数据的秩序，比全面开放写权限更稳妥。

### 7.3 relation 没有全局索引

这保证了对象局部视角，但也意味着：

- 系统不能直接查询全局对象关系图
- 需要全貌时必须按需聚合多个对象视角
- 关系冲突和不一致是常态，不由底层自动收敛

为什么这样选：这是对象自治的代价，也是系统有意保留的现实性。

### 7.4 wait 依赖明确未来 IO 源

系统约束 `wait(on=...)` 只能等待 open 的 `talk_window` 或 `do_window`。这能防止线程进入模糊挂起，但也要求协作者必须严格表达“我在等谁”。

为什么这样选：显式等待源减少隐式死锁和无意义等待。

### 7.5 多对象协作的全局调度仍偏中心化

当前最成熟的模式仍然是 supervisor 作为协调中心。系统虽然允许对象之间 talk，但从文档可见，真正完备的跨对象结构化治理和 user 接入都围绕 supervisor 展开。

为什么这样选：文档中只有 supervisor 被赋予默认路由、kanban 管理和总协调职责。

## 8. 潜在风险与工程观察

### 8.1 supervisor 可能成为瓶颈

当多数结构化协作动作都集中在 supervisor 时，可能出现：

- 调度压力集中
- 结构写权限集中
- user 视角与系统推进路径高度绑定在 supervisor 上

为什么这样选：默认入口、任务派发、Issue/Task 管理都在 supervisor 侧。

### 8.2 多层协作的可观测性复杂度较高

系统同时存在：

- user 与对象的 talk transcript
- 对象间 talk transcript
- 父子线程 do transcript
- kanban 结构化状态
- stone/flow 两套持久化目录

能力很强，但排障和理解成本也会提高。

为什么这样选：协作状态分散在多个抽象层，需要较好的可视化与诊断工具才能稳定运营。

### 8.3 一对一 talk 与结构化 kanban 之间需要人工把握边界

文档已给出经验规则，但在真实使用中仍需要对象自己判断：

- 什么时候只是临时 talk
- 什么时候应该升级为 Issue/Task
- 什么时候需要设 `hasNewInfo`

为什么这样选：这些都是上层协作策略，不是底层强制规则。

### 8.4 关系记忆可能长期分叉

relation 有意允许不对称和局部视角，但这也意味着关系 knowledge 可能持续偏离事实或彼此冲突。

为什么这样选：系统没有全局 relation 收敛机制，冲突本来就是设计允许项。

## 9. 综合判断

综合来看，OOC 在多对象协作方面已经具备以下成熟特征：

- 有统一的协作抽象：`ContextWindow`
- 有明确的通信原语：`talk`
- 有明确的内部并发原语：`do`
- 有显式等待与线程状态机：`wait/running/waiting`
- 有 Session 级共享协作骨架：`kanban`
- 有长期关系与角色语义：`relation`、`role`
- 有默认总协调者：`supervisor`
- 有持久化恢复能力：thread/flow/stone 全链路落盘

如果要用一句话概括，比较合理的候选有三个：

1. “带持久化和状态机的多 Agent 协作框架”
2. “以对象为中心的上下文操作系统”
3. “可恢复的多对象会话与任务编排系统”

我更倾向第 3 个。为什么这样选：它同时覆盖了会话、任务、编排、可恢复这四个在文档和代码里最突出的能力点。

## 10. 最终结论

OOC 并不是只支持“多个对象互相发消息”，而是已经形成了一套从**点对点通信、线程化执行、显式等待、结构化看板、角色分工、关系记忆到 supervisor 总协调**的完整多对象协作机制。

它当前最强的能力不是“完全去中心化自治群体”，而是“**以 supervisor 为入口和治理中心、允许多个对象在线程与看板约束下协同完成复杂任务**”。

为什么这样选：现有实现已经把中心协调、局部通信、结构化协作和持久化恢复组合成了可运行闭环，而去中心化自治则仍更多体现在潜在扩展空间上。
