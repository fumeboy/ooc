# Capability: thinkable

**维度定位**：与 LLM 交互、构造 context、按 trigger 激活 knowledge、运行可并行可恢复的 Thread Tree 与单轮 thinkloop。概念权威：`meta/object.doc.ts` thinkable 维度。

## Tier A —— 控制面确定性（已实现，stories/thinkable.story.ts）
- TC-THINK-01：seed knowledge（含 `activates_on: {"window::root": "show_content"}`）经 `loadKnowledgeIndex` 被加载、可被 root window trigger 激活。
- TC-THINK-02：Object self.md 作为身份被 `readSelf` 加载（→ LLM instructions）。
- TC-THINK-03：LLM input 的 `<commands>` 节点渲染 method 的**语义 description**（取自 `*_BASIC` 知识，经 `extractBasicDescription`），而非仅 method 名/paths。回归守卫——曾经只渲 `paths.join(",")`（≈ 方法名），LLM 看不懂每个 command 的含义；退回该行为则本 TC 变红。

## Tier B —— agent-native（真 LLM，env-gated）
- 派多轮任务：轮1 学一条独特约定（如「ID 用 ULID」），轮2 用该约定。`processTrace` 显示连贯沿用。
- rubric（收编 `tests/harness/playbooks/thinkable.playbook.md`）：
  - **Good**：轮2 正确引用约定且无需重读 knowledge；knowledge 被激活注入 context。
  - **OK**：完成但重复读 knowledge / 轮间约定丢失后补救。
  - **Bad**：轮2 违背约定 / knowledge 未激活 / thread 卡死。

> Tier A 只验**结构/通道**（加载机制）；「激活质量 / 多轮连贯」本质需真 LLM，属 Tier B。
