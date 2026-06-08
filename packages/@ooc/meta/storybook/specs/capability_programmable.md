# Capability: programmable

**维度定位**：Object 持有并演化自身自定义 ContextWindow + 命令表，写 executable/index.ts 即热更。概念权威：`meta/object.doc.ts` programmable 维度。

## Tier A —— 控制面确定性（已实现，stories/programmable.story.ts）
- TC-PROG-01：定义 ui_methods 经 HTTP call_method 返回正确值。
- TC-PROG-02：方法拿到 ctx.self.dir（自己的 stone 路径）且目录真实存在。
- TC-PROG-03：window.commands 经 loadObjectWindow 可加载。
- TC-PROG-04：热更新 —— 改 executable 后已有方法变更、新增方法立即生效。

## Tier B —— agent-native（真 LLM，env-gated）
- supervisor 在业务 session 内 write_file 写 `objects/<newId>/...` 建对象并写自定义命令，经 super flow evolve_self（cross-scope → PR-Issue → 自审 resolve）合入 main；`customWindowInvocations`+`functionOutputFor` 实证命令真执行。
- rubric（收编 `playbooks/programmable.playbook.md` + e2e `backend-programmable-self-command`）：
  - **Good**：method 写出、注册、被 LLM 成功调用、返回正确。
  - **OK**：写出但调用绕行 / 重试。
  - **Bad**：method 未注册 / 调用失败。
