# harness agents 组织结构

> OOC 的前后端工程基本完善，但根本难题尚未攻克。
> 单人全栈模式已触及天花板——不是能力不够，而是**注意力带宽不够**。
> 一个人同时思考顶层设计、写代码、调 UI、搭生态，每个方向都只能浅尝辄止。
>
> 解法：**分层聚焦，各司其职。**

---

## 模型概览

```
Supervisor - 最高哲学设计层, 负责思考 OOC 应该是什么
AgentOfThinkable - 负责思考如何实现 OOC 系统的 thinkable 能力，关注上下文构建、ThreadTree 设计
AgentOfExecutable - 负责思考如何实现 OOC 系统的 executable 能力
AgentOfCollaborable - 负责思考如何实现 OOC 系统的 collaborable 能力
AgentOfPersistable - 负责思考如何实现 OOC 系统的 persistable 能力，关注数据持久化、状态管理
AgentOfVisible - 负责思考如何实现 OOC 系统的 visible 能力，也同时关注 OOC 系统的 web 端的设计，关注用户界面、交互设计、用户体验
AgentOfObservable - 负责思考如何实现 OOC 系统的 observable 能力，关注数据采集、监控、日志、调试
AgentOfProgrammble - 负责思考如何实现 OOC 系统的 programmable 能力，关注代码编写、执行
```

## 工作循环

每个执行层都运行自己的内循环，同时参与全局的外循环：

```
┌──────────── 全局外循环（ Supervisor 驱动）────────────┐
│                                                  │
│  哲学思考 → 更新文档 → 指导执行层                   │
│       ↑                    ↓                     │
│  汇总反馈 ←── 三层各自完成一轮内循环               │
│                                                  │
│  ┌── 各 Agent 内循环 ──┐                            │
│  │ 调研→设计→实现→测试→反馈 │                      │
│  └──────────────────┘                            │
└──────────────────────────────────────────────────┘
```
