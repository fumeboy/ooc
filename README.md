# OOC — Object-Oriented Context

“Agent 的上下文应该是活的”

这是一个设计、实现中的 Agent 智能系统，命名为 OOC(Object-Oriented Context, 面向对象上下文)

在这个系统中，核心的抽象 叫做 可交互信息对象(Object)

在这个系统中，任意两个 Object 之间都可以进行交互，并通过对象间交互完成一系列工作任务

它从 OOP、逻辑哲学论、ACT-R、SOAR 等理论中得到启发。

OOC 的精髓在于 信息可见性 的控制，一方面，我们想要 LLM 的上下文的数据足够多，来让 LLM 有充足的上下文进行思考，一方面，我们又担心大量无意义的内容占满了有限的上下文区域，对思考产生干扰

这种既要多、又要少的矛盾心理，其实正对应了 OOP 编程理论中的 public 与 private 的设计: 通过 public 对外透露出精简而高效的描述性信息，当需要深入时，再通过 对话的方式，让被对话的对象自己访问 private 得到更清晰具体的信息

## 关于 OOP 

Alan Kay 说过：

> "I made up the term 'object-oriented', and I can tell you I didn't have C++ in mind."

Kay 心目中的面向对象有三个核心思想：

- 对象是独立的计算机，不是数据容器
- 消息传递是唯一的通信方式，不是方法调用
- Late binding——接收方决定如何响应消息，不是编译时绑定

他用生物学做类比：对象像细胞，每个细胞有完整的 DNA，通过化学信号协作，细胞膜保护内部状态。整个有机体的智能从细胞的协作中涌现。

在今天，通过 LLM， 我们可以实现 Alan Kay 理想中的软件。

Carl Hewitt 的 Actor Model（1973）提供了形式化基础——每个 Actor 有私有状态、邮箱、行为定义，只通过异步消息通信。OOC 在此基础上加入了 Kay 没有预见到的维度：**对象能从经历中改写自身结构**。这不是 OOP，也不是 Actor Model——这是把"认知"作为一等公民的对象系统。Smalltalk 的 late binding 在这里走到了极致：对象收到消息后，由 LLM（而非编译器）决定如何响应。

## 核心哲学

### 多对象协作体系

OOC 中的一切实体都是对象——研究员、文件系统、项目空间、甚至世界本身。

每个对象有身份（我是谁）、数据（我知道什么）、能力（我会做什么）、关系（我认识谁）。对象通过消息协作：`talk`（对话）、`delegate`（委托）、`reply`（回复）。每个对象只能看到自己的上下文，通过消息传递了解他者——这正是 Kay 所说的"封装"的真正含义。

对象的关系汇聚成社交网络，协作从网络中涌现。

### Stone 与 Flow

对象有两种形态，如同物质的势能与动能。

Stone 是对象的静态形态——身份、数据、能力都已定义，但它不会主动做任何事。Stone 就像一块刻了字的石头：信息在那里，但石头不会自己读出来。

Flow 是 Stone 被任务唤醒后的动态形态。它拥有思考能力（调用 LLM）、执行能力（运行程序）、行为树（结构化的计划与执行跟踪）。一个 Stone 可以同时拥有多个 Flow——每个任务对应一个，互不干扰。

用认知栈的视角看：Stone 是空闲的栈，Flow 是忙碌的栈。同一个栈，不同时刻。

每个 Flow 只能写自己的工作目录。想把工作中的收获沉淀为长期记忆，唯一的方式是 `await talk("super", ...)`——向自己的反思镜像分身说话，由它审视后决定是否写入 Stone。沉淀不是机械的数据搬运，而是一次自我对话（SuperFlow）。

### 思维与成长机制

对象通过 ThinkLoop 与世界交互：思考 → 输出程序 → 沙箱执行 → 反馈 → 再思考。对象不直接操作世界，间接层带来可审计、可中断、可反思。

对象的运行时是一个认知栈。每帧同时包含"做什么"（过程）和"用什么来想"（思维）——就像编程语言的调用栈，每个 stack frame 同时包含指令指针和局部变量。深入子任务 = push，完成 = pop，遗忘 = pop 时释放局部信息。

Trait 是对象的自我定义单元。思考风格、行为规则、知识、方法都是 Trait。对象通过 Trait 定义"我是什么样的存在"。

对象从经历中学习。通过"自我对话"（`talk("super", ...)` → 反思镜像分身审视），有价值的经验被沉淀为 memory.md 或新的 Trait。Trait 在原地成长：知识（readme-only）→ 能力（readme + code）→ 直觉（always-on）。智慧 = 帧 0 的厚度——新手需要很多帧才能完成一件事，专家的帧 0 已经内联了大量经验。

### 元编程

对象的能力边界不是固定的——对象可以为自己实现方法。

通过 ThinkLoop 输出的程序，对象可以修改自己的 `traits/` 目录：创建新的 Trait、编辑已有的方法、调整思维偏好。这意味着对象不只是执行预定义的逻辑，而是能根据经验为自己发明新的行为模式。一个研究员对象在反复做文献综述后，可能会为自己写出一套高效的检索流程，从此作为内置能力使用。

对象还可以为自己编写 UI。每个对象的 `ui/index.tsx` 是一个 React 组件，由对象自己创作，决定自己如何被人类看见。数据面板、交互控件、可视化图表——对象最了解自己的数据结构，因此由它自己决定最合适的呈现方式。前端通过动态加载机制渲染这些组件，渲染失败时自动降级到通用视图。

### 人机交互

对象的持久化目录就是它的物理存在。人类可以直接编辑 `readme.md` 改变对象的身份，编辑 `traits/` 改变它的思维方式，编辑 `data.json` 改变它的状态。即使系统没有运行，人类也可以通过编辑文件来"改造"对象。

Pause 机制让人类可以介入对象的思考过程：对象暂停时，系统写出完整的 Context 和 LLM 输出，人类查看、修改后恢复执行。

用户不需要直接面对 OOC World 中复杂的对象定义和对象关系。Supervisor 是一个特殊的 Stone，作为用户与整个 World 交互的总代理——用户的消息默认路由到 Supervisor，由它理解意图、拆分任务、调度合适的对象协作完成。Supervisor 可以看到当前 Session 中所有 Flow 的状态，但其他对象看不到彼此的内部。对用户而言，Supervisor 就是 OOC World 的入口。

## 双仓库架构

OOC 采用 user repo + kernel submodule 结构，用户数据与内核代码分离：

```
ooc/                          ← user repo（用户仓库，git 根）
├── .env                      ← 环境变量（API Key 等）
├── kernel/                   ← git submodule（内核仓库）
│   ├── src/                  ← 后端（TypeScript, Bun）
│   ├── web/                  ← 前端（React + Vite）
│   ├── traits/               ← Kernel Traits（基础能力）
│   └── tests/                ← 测试
├── docs/                     ← 文档（哲学、架构、设计）
├── stones/                   ← 对象持久化目录
└── flows/                    ← 会话数据
```

为什么这样分：
- `stones/`、`flows/`、`docs/` 属于用户，`kernel/` 属于系统
- 用户仓库记录对象的成长历史，内核仓库记录系统的演进
- 更新 kernel submodule 不影响用户的对象和文档
- 从 user repo 根目录执行所有命令

## 快速开始

OOC Kernel 需要搭配一个 OOC World（用户仓库）使用。可以用 [ooc-0](https://github.com/fumeboy/ooc-0) 作为起点：

```bash
# 克隆初始 World（含 kernel submodule）
git clone --recursive https://github.com/fumeboy/ooc-0.git
cd ooc-0

# 安装后端依赖
bun install

# 安装前端依赖
cd kernel/web && bun install && cd ../..

# 配置环境变量（参考 kernel/.env）
cp kernel/.env .env
# 编辑 .env，填入你的 API Key 和模型配置：
#   OOC_API_KEY=your-api-key
#   OOC_BASE_URL=https://api.anthropic.com
#   OOC_MODEL=claude-opus-4-6

# 启动服务
bun kernel/src/cli.ts start 8080
```

## 文档

| 文档 | 路径 | 内容 |
|------|------|------|
| 核心基因 | `docs/哲学/genes/` | 13 条基因——OOC 的全部规则（每条一个 .md） |
| 涌现能力 | `docs/哲学/emergences/` | 基因组合涌现的高阶能力（每条一个 .md） |
| 概念树 | `docs/meta.md` | 完整概念结构与工程子树 |
| 组织结构 | `docs/工程管理/组织/` | 1+3 组织模型（Sophia/Kernel/Iris/Nexus） |

TypeScript · Bun · Claude API · React · Vite
