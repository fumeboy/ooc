# OOC — Object-Oriented Context

Agent 的上下文应该是活的。

## 从 Alan Kay 的 OOP 说起

1998 年，Alan Kay 说过一句著名的话：

> "I made up the term 'object-oriented', and I can tell you I didn't have C++ in mind."

Kay 心目中的面向对象有三个核心思想：

- 对象是独立的计算机，不是数据容器
- 消息传递是唯一的通信方式，不是方法调用
- Late binding——接收方决定如何响应消息，不是编译时绑定

他用生物学做类比：对象像细胞，每个细胞有完整的 DNA，通过化学信号协作，细胞膜保护内部状态。整个有机体的智能从细胞的协作中涌现。

今天的 AI Agent 架构走上了 Kay 批判的老路。我们用最强大的 LLM，却把它的上下文退化成一段不断膨胀的扁平文本——本质上就是"全局变量 + 过程调用"。上下文没有"我是谁"的概念，所有信息混在一起没有封装，对话结束一切消散。

如果认真对待 Kay 的消息传递思想，Agent 的上下文应该是一组自治对象的生态。Carl Hewitt 的 Actor Model（1973）提供了形式化基础——每个 Actor 有私有状态、邮箱、行为定义，只通过异步消息通信。OOC 在此基础上加入了 Kay 没有预见到的维度：**对象能从经历中改写自身结构**。这不是 OOP，也不是 Actor Model——这是把"认知"作为一等公民的对象系统。Smalltalk 的 late binding 在这里走到了极致：对象收到消息后，由 LLM（而非编译器）决定如何响应。

## 多对象协作体系

OOC 中的一切实体都是对象——研究员、文件系统、项目空间、甚至世界本身。

每个对象有身份（我是谁）、数据（我知道什么）、能力（我会做什么）、关系（我认识谁）。对象通过消息协作：`talk`（对话）、`delegate`（委托）、`reply`（回复）。每个对象只能看到自己的上下文，通过消息传递了解他者——这正是 Kay 所说的"封装"的真正含义。

对象的关系汇聚成社交网络，协作从网络中涌现。

## Stone 与 Flow

对象有两种形态，如同物质的势能与动能。

Stone 是对象的静态形态——身份、数据、能力都已定义，但它不会主动做任何事。Stone 就像一块刻了字的石头：信息在那里，但石头不会自己读出来。

Flow 是 Stone 被任务唤醒后的动态形态。它拥有思考能力（调用 LLM）、执行能力（运行程序）、行为树（结构化的计划与执行跟踪）。一个 Stone 可以同时拥有多个 Flow——每个任务对应一个，互不干扰。

用认知栈的视角看：Stone 是空闲的栈，Flow 是忙碌的栈。同一个栈，不同时刻。

每个 Flow 只能写自己的工作目录。想把工作中的收获沉淀为长期记忆，唯一的方式是 `reflect()`——向自己的 ReflectFlow 发消息，由它审视后决定是否写入 Stone。沉淀不是机械的数据搬运，而是一次自我对话。

## 思维与成长机制

对象通过 ThinkLoop 与世界交互：思考 → 输出程序 → 沙箱执行 → 反馈 → 再思考。对象不直接操作世界，间接层带来可审计、可中断、可反思。

对象的运行时是一个认知栈。每帧同时包含"做什么"（过程）和"用什么来想"（思维）——就像编程语言的调用栈，每个 stack frame 同时包含指令指针和局部变量。深入子任务 = push，完成 = pop，遗忘 = pop 时释放局部信息。

Trait 是对象的自我定义单元。思考风格、行为规则、知识、方法都是 Trait。对象通过 Trait 定义"我是什么样的存在"。

对象从经历中学习。通过"自我对话"（`reflect()` → ReflectFlow 审视），有价值的经验被沉淀为新的 Trait。Trait 在原地成长：知识（readme-only）→ 能力（readme + code）→ 直觉（always-on）。智慧 = 帧 0 的厚度——新手需要很多帧才能完成一件事，专家的帧 0 已经内联了大量经验。

## 人机交互

对象的持久化目录就是它的物理存在。人类可以直接编辑 `readme.md` 改变对象的身份，编辑 `traits/` 改变它的思维方式，编辑 `data.json` 改变它的状态。即使系统没有运行，人类也可以通过编辑文件来"改造"对象。

Pause 机制让人类可以介入对象的思考过程：对象暂停时，系统写出完整的 Context 和 LLM 输出，人类查看、修改后恢复执行。

UI 是对象的面孔。对象自己决定如何被人类看见，编写自己的 React 组件。

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
| 核心基因 | `docs/哲学文档/gene.md` | 13 条基因——OOC 的全部规则 |
| 涌现能力 | `docs/哲学文档/emergence.md` | 基因组合涌现的高阶能力 |
| 概念树 | `docs/meta.md` | 完整概念结构与工程子树 |
| 组织结构 | `docs/组织/` | 1+3 组织模型（Sophia/Kernel/Iris/Nexus） |

TypeScript · Bun · Claude API · React · Vite
