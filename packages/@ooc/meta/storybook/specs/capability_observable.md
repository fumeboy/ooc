# Capability: observable

**维度定位**：thinkloop 周围加观测点，每轮 LLM 输入输出/tool/context 可记录可查可暂停可回放。概念权威：`meta/object.doc.ts` observable 维度。

## Tier A —— 控制面确定性（已实现，stories/observable.story.ts）
- TC-OBS-01：系统活动快照 `GET /api/runtime/activity` 返回 `{now,runningCount,logPatterns}`。
- TC-OBS-02：debug 开关 enable → status 反映已启用。

## Tier B —— agent-native（真 LLM，env-gated）
- 派任务后开 debug，断每轮 `GET .../debug/loops` 有 loop-debug 记录（context windows/budget/tool dispatch）；pause 被尊重。`processTrace` 本身即 observable 演示。
- rubric（收编 `playbooks/observable.playbook.md`）：
  - **Good**：debug 记录完整可回放、pause/resume 行为正确。
  - **OK**：记录有缺漏但可定位。
  - **Bad**：thinkloop 不可观测 / pause 被无视。
