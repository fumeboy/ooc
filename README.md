# OOC — Object-Oriented Context

OOC 是一种 AI 智能体（Agent）架构，将 Agent 的上下文组织为「活的对象生态」。

传统 Agent 的上下文是一段不断增长的扁平文本。OOC 用一组对象替代它——每个对象有自己的身份、数据、行为、思维方式和关系。对象之间可以协作、对话、创建新对象。

## 核心概念

**Stone & Flow** — 对象分为两种形态。Stone 是静态的数据与逻辑载体；Flow 是 Stone 在执行任务时的动态派生，拥有思考能力、执行能力和行为树。

**Trait** — 对象的能力单元。每个 Trait 是一个目录：`readme.md`（行为约束）+ 可选 `index.ts`（可调用方法）。Trait 支持 progressive disclosure，按需注入上下文。

**ThinkLoop** — 思考-执行循环。LLM 输出 thought（思考）和 program（程序），程序在沙箱中执行，结果反馈给下一轮思考。

**行为树（Process）** — 结构化的计划与执行跟踪。支持认知栈作用域链，驱动 Trait 激活和上下文遗忘。

**对象协作** — 对象通过 `talk()` 通信、`delegate()` 委派任务、`reply()` 回复消息。每个对象只能看到自己的上下文，通过消息传递协作。

## 项目结构

```
src/
├── cli.ts              # CLI 入口
├── server/             # Web API 服务器
├── world/              # 世界管理器（对象注册、路由、消息分发）
├── stone/              # Stone 持久化与管理
├── flow/               # Flow 生命周期与 ThinkLoop
├── trait/              # Trait 加载、激活、方法注册
├── context/            # Context 构建与格式化
├── process/            # 行为树、认知栈
├── executable/         # Program 沙箱执行器
├── thinkable/          # LLM 集成（Claude API）
├── persistence/        # 数据持久化
├── integrations/       # 外部集成（MCP 等）
└── types/              # 类型定义

.ooc/
├── docs/               # 所有文档
│   ├── meta.md         # 全局架构索引
│   ├── 哲学文档/       # 核心哲学（gene.md, emergence.md）
│   ├── feature/        # Feature 设计（已完成/进行中/草稿）
│   ├── 组织/           # 1+3 组织结构
│   ├── 体验用例/       # 用户体验测试用例
│   ├── 参考/           # 学习笔记与外部分析
│   └── 理想与现实/     # 愿景与现状
├── kernel/traits/      # 内核 Trait（computable, talkable, reflective 等）
├── stones/             # 对象定义
├── flows/              # 运行时 Flow 数据
└── web/                # Web UI（React + Vite）
```

## 快速开始

```bash
# 安装依赖
bun install

# 启动 CLI
bun run start

# 启动 Web 服务器
bun run server

# 启动 Web UI（开发模式）
cd .ooc/web && bun install && bun run dev

# 运行测试
bun test
```

## 内核 Traits

| Trait | 描述 |
|-------|------|
| computable | 思考-执行循环核心 API，Program 语法和方法定义 |
| talkable | 对象间通信协议，talk/delegate/reply 消息传递 |
| reflective | 经验结晶与自我反思，ReflectFlow 驱动的持续学习 |
| verifiable | 证据先于结论，完成前必须运行验证 |
| debuggable | 系统化调试四阶段流程，根因先于修复 |
| plannable | 任务拆解和行为树规划 |
| testable | RED-GREEN-REFACTOR 循环，测试驱动开发 |
| reviewable | 两阶段审查：合规性 + 质量 |
| web_search | 互联网搜索和网页抓取能力 |
| object_creation | 创建新对象或完善对象身份的指南 |

## 文档

所有文档统一在 `.ooc/docs/` 下：

- `.ooc/docs/meta.md` — 全局架构索引
- `.ooc/docs/哲学文档/` — 核心哲学（gene.md 13 条基因、emergence.md 涌现能力）
- `.ooc/docs/feature/` — Feature 设计（已完成/进行中/草稿）
- `.ooc/docs/规范/` — 编码与交叉引用规范
- `.ooc/docs/组织/` — 1+3 组织结构（Sophia/Kernel/Iris/Nexus）
- `.ooc/docs/体验用例/` — 用户体验测试用例
- `.ooc/docs/参考/` — 学习笔记与外部分析

## 技术栈

- Runtime: [Bun](https://bun.sh)
- LLM: Claude API (Anthropic)
- Web UI: React + Vite + Tailwind CSS
- Language: TypeScript
