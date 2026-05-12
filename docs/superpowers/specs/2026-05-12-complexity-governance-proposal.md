# Complexity Governance Proposal

**Date:** 2026-05-12

**Scope:** 基于真实 Agent 对话结果、`npx fta-cli .` 复杂度评估以及当前 OOC 控制面/运行时代码现状，提出一份复杂度治理提案。目标不是机械地把大文件拆成小文件，而是评估当前系统是否引入了过多概念、函数、类型、参数和判断语句，并给出“删概念、收敛状态、压缩分支”的路线图与风险控制策略。

---

## 背景

2026-05-12 的真实对话回归结果表明，系统已经可以跑通 15 轮真实 Agent 对话，但为达成这个结果，过程中修复了多处底层问题，集中在以下几个方向：

- thread 状态从 `failed / waiting / paused / done` 重新回到 `running` 的语义不够集中
- worker / job / pause / resume 的控制语义分散在多个模块
- `program.shell` 和 `program.function` 的实际使用体验仍有隐性协议成本
- app server 的控制面服务逐渐吸纳了 runtime 层和持久化层的职责

同时，`fta-cli` 对若干核心源码文件给出了较高的复杂度分数，例如：

- `src/thinkable/context/`
- `src/thinkable/llm/providers/claude.ts`
- `src/app/server/modules/flows/service.ts`
- `src/observable/index.ts`
- `src/executable/commands/program.ts`
- `scripts/dialog-experience.ts`

这些文件的共同点不是“都太长”，而是都处在多个概念的交界面上：协议、状态机、副作用、持久化和外部 provider 适配在同一个实现单元里交织。

因此，本提案的治理目标不是“做文件切片”，而是先判断复杂度是否必要，再决定是否通过删概念、合并边界或重组实现来降低复杂度。

---

## 治理原则

### 1. 优先减少概念数量，而不是优先减少文件长度

一个 250 行文件如果职责单一、控制流线性、输入输出稳定，是可接受的。
一个 80 行文件如果同时承载多个状态语义，也不必机械拆分；如果这些状态语义共同服务于一个主干概念，那么保持集中往往比拆散更清晰。

因此治理优先级是：

1. 删除不必要概念
2. 合并重复抽象
3. 收敛状态与副作用边界
4. 最后才考虑是否拆文件

### 1.1 文件拆分以“主干概念 / 旁生概念”为准

文件拆分的核心不是“一个文件里出现了几种逻辑”，而是：

- 哪些逻辑共同构成主干概念
- 哪些逻辑只是围绕主干概念生长出来的旁生概念

治理原则应是：

- 主干逻辑尽量集中在一个文件，保持阅读时的主路径连续
- 旁生逻辑各自拆出，降低对主干阅读路径的打扰
- 不为“局部看起来更短”而破坏整体认知连续性

一个文件即使同时出现若干状态语义，只要这些状态都围绕同一个主干概念展开，且阅读者能顺着主路径理解它，就可以保留集中实现。

### 2. 区分“必要复杂度”和“偶然复杂度”

以下复杂度通常是必要的：

- Claude / OpenAI provider 差异
- thread / form / job 的状态机
- 真实调试与 loop 级别观测
- 控制面 API 与内核运行时之间的桥接

以下复杂度更可能是偶然的：

- 同一语义在多个文件重复表达
- 一个服务既做业务判断，又做目录扫描，又做 job 入队
- 一个模块同时承担数据模型、协议提示、XML 投影和错误恢复
- 参数与状态组合过多，但没有抽象为显式状态转换规则

### 3. 如果复杂度是因为协议本身真实存在，就保留复杂度；如果复杂度只是因为表达方式分散，就治理表达方式

例如：

- `Claude SSE` 的增量解析复杂，这是真实复杂度，不能用“拆文件”伪装解决
- `resumeSession` 需要扫描 paused threads，这是真实业务动作
- 但这些真实复杂度应该被集中表达，而不是散落在 `service`、`worker`、`scheduler`、`observable` 等多个层次中

### 4. 优先治理“语义分散”，其次治理“实现密度”

当前系统最大的风险不是某个函数太长，而是：

- “何时可 pause / resume / inject / rerun”没有一个统一的状态转换层
- 同一业务事件在多个模块里各自决定合法性

这类分散会让 Bug 修复呈现“补分支”模式，而不是“修规则”模式。

### 5. 目录结构也属于复杂度治理的一部分

拆分文件时，不仅要看逻辑边界，还要看目录结构是否优雅、是否自然表达了“某个概念拥有自己的子域”。

例如：

- 当 `context` 已经不再只是一个单文件 helper，而是一个主干概念时，可以升级为同名目录
- 当 `program` 已经不是单一命令实现，而是一个子系统时，应有自己的概念目录，而不是继续借住在无关目录下

目录结构应服务于理解成本降低，而不是让实现文件到处散落。

---

## 复杂度判断框架

在判断一个文件是否需要治理时，使用以下 4 个问题：

### 1. 当前复杂度是否服务于一个单一概念？

如果一个文件虽然长，但都在服务一个强一致概念，比如“解析 Claude SSE”，这类复杂度通常应保留。

### 2. 当前复杂度是否来源于多个概念混居？

如果一个文件同时包含：

- 业务状态语义
- 外部资源扫描
- HTTP 错误映射
- 副作用派发

则复杂度大概率是可治理的。

### 3. 当前参数与判断语句是否是“业务必要分支”还是“表达不集中”？

例如：

- `language=shell|ts|js|function` 是 program command 的必要分支
- 但 `program` 同时负责知识说明、执行分发、env 注入、结果格式化，则属于表达不集中

### 4. 当前类型数量是否帮助理解边界，还是只是在搬运实现细节？

如果一个 type 让边界更清晰，就应保留。
如果一个 type 只是把局部实现细节包成新名字，却没有减少分支和耦合，就应谨慎引入。

---

## 热点文件裁判

### A. `src/thinkable/context/`

**裁判：复杂度偏高，且存在偶然复杂度，优先治理。**

它目前同时承担：

- `ThreadContext` / `ProcessEvent` / `ThreadMessage` 的领域模型定义
- knowledge 激活与 XML 渲染
- form 生命周期提示（`next_action` / `protocol_hint`）
- 事件流转 transcript 的投影逻辑
- 最终 system context 的拼装

问题不在于文件长，而在于它把“线程是什么”和“怎么向 LLM 呈现线程”写在了一起。

这会导致两个后果：

- 每次调整协议提示时，都必须碰触 thread 核心模型所在文件
- 每次扩展上下文窗口时，都更容易把新的临时策略直接塞进 `ThreadContext` 周边

**治理方向：**

- 保留 `context` 作为主干概念，不建议把当前文件机械切成很多平级小文件
- 更合适的方式是把它升级为同名目录，例如 `src/thinkable/context/`
- `context/index.ts` 继续承载主干入口与核心模型编排
- 围绕它的旁生概念再拆出子文件，例如：
  - `context/types.ts`：仅当类型定义继续增长到明显干扰主路径时再拆；否则可继续留在主干文件
  - `context/render.ts`：XML 渲染等视图投影逻辑
  - `context/knowledge.ts`：knowledge activation 到 XML 的旁生逻辑
  - `context/protocol.ts`：`inferNextAction` / `inferProtocolHint` 这类协议引导器

核心原则不是“把 context 拆碎”，而是让 `buildContext()` 的主干阅读路径保留在一个稳定入口中，把知识激活、协议提示、XML 渲染这些旁生概念逐步下沉。

**不是问题的部分：**

- XML 渲染本身并不一定需要换格式
- 一个文件里保留若干渲染 helper 也不是问题

**真正要解决的是：**

- 主干上下文构造与旁生策略/投影逻辑混居

### B. `src/thinkable/llm/providers/claude.ts`

**裁判：复杂度高，但大部分是必要复杂度；应局部治理，不应做过度重构。**

它的复杂度主要来自：

- Claude 的 system/message 分离
- tool_use block 与 `input_json_delta` 的 SSE 语义
- 非流式 JSON 与 SSE fallback
- 代理兼容性重试

这些不是伪复杂度，而是 provider 本身的真实复杂度。

**治理方向：**

- 不建议为了“变短”而硬拆成很多小函数
- 建议只做两类治理：
  - 把 transport/retry 与协议映射分离
  - 把 `parseClaudeSSE` 保持为单一职责、单文件集中实现

**结论：**

- 这里的重点不是“减复杂度分数”，而是“不要让代理兼容补丁继续侵入 provider 主流程”

### C. `src/app/server/modules/flows/service.ts`

**裁判：复杂度偏高，且存在明显语义混居，是 app server 当前最值得治理的文件。**

它目前包含：

- session / object 生命周期
- inject thread
- pause / resume
- paused thread 扫描
- job enqueue
- UI method 调用
- 错误翻译

从真实对话的修复记录看，这个文件已经成为线程控制语义的聚合点。

问题不只是“功能多”，而是其中有些职责根本不应留在 HTTP service 层：

- 扫描 paused thread 更像 runtime query
- inject 后状态翻转规则更像 thread transition policy
- method load error 更像 method invocation adapter

**治理方向：**

- 不是先按文件切片
- 而是先把 flows service 中的职责分成 3 类：
  - 生命周期动作
  - 线程控制动作
  - 方法调用动作

**如果不治理，后续风险是：**

- 每次修对话体验问题，都会继续向 flows service 堆 if/try/catch

### D. `src/observable/index.ts`

**裁判：复杂度中等，问题不在代码量，而在概念边界不纯。**

当前 `observable` 同时承担：

- latest snapshot store
- loop counter
- debug 开关
- pause checker 注入
- loop debug 落盘

其中 `pause` 并不天然属于 observable，而更接近 runtime control。

把 pause 挂在 observable 上虽然实现上省事，但概念上会混淆：

- “观测”是读/记录
- “pause”是控制/阻塞

**治理方向：**

- 不必急着拆文件
- 但应把 pause 相关注入和观测相关 store 语义上分开

### E. `src/executable/commands/program.ts`

**裁判：复杂度偏高，但真正的问题是 `program` 概念过宽，而不是文件本身太大。**

`program` 当前统一承载：

- shell
- ts/js
- function
- env 注入
- result 格式化
- knowledge 说明
- command path

这意味着 `program` 实际已经不是“一个 command”，而是一个小型执行平台。

从对话体验结果看，`program.shell` 和 `program.function` 的使用体验又会持续推动这里增加更多契约说明。

**治理方向：**

- 保留 `src/executable/commands/program.ts`，继续作为：
  - command 执行入口
  - `KNOWLEDGE` 定义
  - path / match 定义
- 具体执行逻辑下沉到 `src/executable/program/` 目录
- 同时把当前 `sandbox/` 目录移动并收编到 `program/` 概念目录下，使“用户代码执行沙箱”从通用概念变成 `program` 的内聚子域

建议的目标结构：

```text
src/executable/
  commands/
    program.ts
  program/
    shell.ts
    function.ts
    format.ts
    types.ts
    self-env.ts
    sandbox/
      console.ts
      executor.ts
      wrap.ts
```

其中：

- `commands/program.ts` 保持 LLM 心智模型稳定
- `program/shell.ts` 负责 shell 执行与 `OOC_SELF_DIR` 注入
- `program/function.ts` 负责 method 调用
- `program/format.ts` 负责结果格式化
- `program/sandbox/` 承载 ts/js 用户代码执行能力

换句话说：

- 对 LLM：仍然只有一个 `program`
- 对实现：`program` 是主干概念，sandbox / shell / function / formatter 都是围绕它的旁生概念

### F. `scripts/dialog-experience.ts`

**裁判：复杂度偏高，但主要是脚本密度问题，不是架构热点。**

它现在已经从“一次性脚本”演变成“半自动 smoke test harness”。

继续增长会带来维护摩擦，但它不是当前核心运行时复杂度的根因。

**治理方向：**

- 可以延后
- 等确定是否进入 nightly / CI / 人工 smoke 流程后，再抽出 api client / scenario / report 模块

---

## 根因总结

当前系统最需要治理的，不是“大文件”，而是下面 3 个根因：

### 根因 1：状态机语义分散

thread / job 的关键状态转换规则目前分散在：

- `flows/service.ts`
- `runtime/worker.ts`
- `thinkable/scheduler.ts`
- `thinkable/thinkloop.ts`
- `observable/index.ts`

导致同一业务动作（inject / resume / pause / rerun）在不同层分别做合法性判断。

这是本项目当前最大的复杂度来源。

### 根因 2：协议层和领域层交织

例如：

- `context.ts` 既定义 thread，又生成 XML，又推导 protocol hint
- `program.ts` 既定义 command 路径，又做实际执行，又写知识说明

这使得协议调整会侵入核心领域代码。

### 根因 3：app server 正在吸纳 runtime 与 persistence 层职责

例如：

- flows service 扫描目录
- service 层负责 paused thread 恢复策略
- worker 与 HTTP service 之间没有一层显式的 thread/job transition policy

如果继续沿这个方向演进，控制面会越来越像“脚本式业务层”，而不是清晰的 app facade。

---

## 重构路线图

### P0：先收敛状态语义，不急着拆文件

**目标：** 把 thread/job 关键状态转换规则集中表达。

**重点动作：**

1. 引入显式的 thread/job transition policy 层
   - 输入：当前状态 + 事件（inject / pause / resume / worker tick / llm result / tool error）
   - 输出：允许的状态迁移 + 需要触发的副作用

2. 统一以下规则的“单一真相”：
   - 哪些状态下 inject 可以把 thread 翻回 `running`
   - pause 在哪个时机生效
   - resume 是复用旧输出还是重跑 LLM
   - worker 遇到 `queued/running/failed/paused` 时如何处理

3. 让 `flows/service.ts` 和 `worker.ts` 只调用规则，不自己散写状态判断

**收益：**

- 后续修复 dialog 体验问题时，改的是规则层，不是再补 service 分支

### P1：削减 service 层职责，不是单纯拆 service 文件

**目标：** 让 app server 重新回到 facade，而不是 runtime 执行点。

**重点动作：**

1. 把 paused thread 扫描下沉为 runtime/persistable query helper
2. 把 method load / method invoke 的错误翻译整理成统一 adapter
3. 把 inject / pause / resume / enqueue 的控制语义从 HTTP service 中抽离

**收益：**

- `flows/service.ts` 的复杂度将从“控制中心”下降为“协调入口”

### P1：分离 thread model、context projection、protocol hint

**目标：** 让 `context.ts` 中的复杂度更可解释。

**重点动作：**

1. 保留 `context` 主干入口，不打断 `buildContext()` 主阅读路径
2. 将 form projection / knowledge projection / transcript projection 作为旁生概念逐步分离
3. 将 `next_action` / `protocol_hint` 这类策略提示独立为 protocol advisor
4. 目录形态从单文件升级为 `src/thinkable/context/`

**收益：**

- 上下文协议演进时，不必修改 thread model 层

### P2：重组 `program` 内部实现，但不改变外部心智模型

**目标：** 对外仍是一个 `program` command，对内不再是一个“万用实现文件”。

**重点动作：**

1. 保持 `src/executable/commands/program.ts` 的 command 名称、knowledge、path、入口语义不变
2. 新建 `src/executable/program/` 作为主干概念目录
3. 将 shell / ts/js / function / formatter / sandbox 逻辑迁入该目录
4. 将现有 `src/executable/sandbox/` 迁移到 `src/executable/program/sandbox/`
5. 针对前文提到的“刚写完 method 立即可调”补 e2e 契约测试

**收益：**

- 减少 `program` 继续膨胀为执行平台巨石文件的风险

### P2：控制 provider 层补丁扩散

**目标：** 保留 Claude/OpenAI provider 的必要复杂度，但不让兼容性补丁继续侵入主流程。

**重点动作：**

1. 将 transport/retry 抽成单独层
2. 将 SSE parser 保持为独立职责
3. `generate/stream` 层只编排，不处理太多兼容分支

**收益：**

- provider 复杂度仍高，但会变得“可局部理解”

### P3：整理 smoke harness，而非优先重构

**目标：** 让 `dialog-experience.ts` 成为可维护的验证工具，但不抢占核心状态治理工作。

**重点动作：**

1. 等 nightly / 人工触发策略明确后再整理
2. 把 api client / scenario / report 分开

**收益：**

- 保留验证能力，又不把脚本重构放在错误优先级上

---

## 风险控制策略

### 1. 不做“无语义收益”的拆分

如果一个拆分只是让文件更短，但：

- 状态判断仍然分散
- 参数组合仍然一样复杂
- 调用链反而更长

则不应推进。

### 2. 每一轮重构只压一种复杂度

每轮治理只允许聚焦一种问题：

- 状态语义收敛
- 协议投影分离
- provider transport 分离

不要在同一轮里同时重命名、换目录、改状态机和补新功能。

### 3. 建立“语义不变量”回归测试

在治理前，先补或保留以下不变量测试：

- inject 后 thread 如何恢复
- paused thread 如何 resume
- worker 如何处理 queued -> running -> done/failed
- `program(shell)` 的 `OOC_SELF_DIR` 契约
- 刚写完 `server/index.ts` 后立刻 `program(function)` 的 hot-reload 契约

### 4. 允许保留必要复杂度

以下复杂度不应为了“好看”被错误消除：

- SSE 增量协议解析
- provider 差异适配
- 状态机本身的合法分支

治理的目标不是让代码“短”，而是让复杂度“集中且可解释”。

### 5. 设定止损线

如果某一轮治理出现以下信号，应立即停止继续拆分：

- 文件数量明显增加，但主干/旁生边界并没有更清楚
- 文件数量明显增加，但分支数和状态组合没有下降
- 测试需要改写大量 mock 才能通过
- 新增大量 adapter / wrapper type，却没有减少调用点心智负担
- 用户无法用一句话解释某个模块“它到底负责什么”

出现这些信号，说明治理方向正在滑向“抽象增殖”。

---

## 验收标准

复杂度治理应以以下结果作为验收，而不是只看 `fta-cli` 分数下降：

1. thread/job 关键状态转换能在一个规则层被完整解释
2. `flows/service.ts` 不再同时承担目录扫描、状态翻转、job 入队、method 调用和错误翻译
3. `context.ts` 能区分领域模型与协议投影
4. `program.ts` 对外仍统一，但对内不再混合所有执行模式
5. 关键真实交互测试仍通过
6. 新人阅读时能更快回答：
   - thread 为什么会从某状态跳到另一状态？
   - app server 何处负责入队，何处负责执行？
   - program 的不同执行模式分别由谁负责？

---

## 结论

当前 OOC 系统最需要治理的复杂度，不是“文件大”，而是：

- 状态语义分散
- 协议层与领域层交织
- app server 对 runtime/persistence 责任的吸纳

因此治理路线不应从“拆文件”开始，而应从“收敛规则、减少概念、压缩边界”开始。

只有当某个文件中的复杂度来源于“主干概念 + 若干旁生概念混居”，且这些旁生概念可以在不破坏主路径阅读体验的前提下被分离时，拆分文件才是正确动作。

否则，应该优先保留清晰而集中的大文件，而不是制造更多薄而分散的抽象。
