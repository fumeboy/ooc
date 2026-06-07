# Capability: collaborable

**维度定位**：Object 间以「消息 + 持续会话窗口」协作，跨 thread 影响必经显式 inbox/outbox（peer 平等轴）。概念权威：`meta/object.doc.ts` collaborable 维度。

## Tier A —— 控制面确定性（已实现，stories/collaborable.story.ts）
- TC-COLLAB-01：talk-delivery —— seed user→talk→target 后，target callee thread inbox 真实收到 user 消息。
- TC-COLLAB-02：user.root 上挂了指向 target 的 talk_window（cross-object talk 路由表）。

## Tier B —— agent-native（真 LLM，env-gated）
- supervisor 经 talk 联系一个新对象，新对象跑**自己的 thinkloop** 回应（轮询 callee 出现 say）。
- rubric（收编 `playbooks/collaborable.playbook.md` + `_demo_session.ts` Step 2）：
  - **Good**：talk 投递、callee 真实回应、messageId 双写一致、A outbox 有回报。
  - **OK**：回应迟缓 / talk_window 误关又重开。
  - **Bad**：callee 无回应 / inbox≠outbox / 跨 thread 影响绕过显式通道。
