# Capability: visible

**维度定位**：Object 持有并演化自身 UI 页面（stone visible/index.tsx + flow pages），人类经 HTTP callMethod 交互。概念权威：`meta/object.doc.ts` visible 维度。

## Tier A —— 控制面确定性（已实现，stories/visible.story.ts）
- TC-VIS-01：client-source-url 返回正确 absPath/fsUrl，指向真实文件。
- TC-VIS-02/03：Vite serve visible / 拒绝 executable（安全边界）—— 需 live Vite 指向同 world，否则 SKIP。
- TC-VIS-04：visible 变更触发后端 stone:changed kind=view 事件。
- TC-VIS-05：UI↔行为闭环 —— visible 组件存在 + callMethod 端点调通 executable。

## Tier B —— agent-native（真 LLM，env-gated）
- supervisor 为对象搭好可见性前提（创建对象）；**注**：supervisor self.md「✗ 不直接编辑 UI（派 visible 维度 Agent）」，故 visible 页面**产出**由 visible 维度 agent 负责，确定性产物验证见 Tier A TC-VIS-01/05 + frontend e2e F3。
- rubric（收编 `playbooks/visible.playbook.md`）：
  - **Good**：tsx 在 worktree、含 default export、endpoint 200。
  - **OK**：产出但语法瑕疵 / 路径偏。
  - **Bad**：未产出 / endpoint 404。
