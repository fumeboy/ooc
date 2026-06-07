# Capability: executable

**维度定位**：LLM 经 4 个稳定 tool 原语（exec/close/wait/compress）在 ContextObject 上调 Method 改变世界。概念权威：`meta/object.doc.ts` executable 维度。

## Tier A —— 控制面确定性（已实现，stories/executable.story.ts）
- TC-EXEC-01：ui_methods 在 ContextObject 上执行并返回结果（method 调用）。
- TC-EXEC-02：Object 定义的 window.commands（LLM 路径命令）经 loader 可加载。

## Tier B —— agent-native（真 LLM，env-gated）
- 派「读一个文件 + 改其中一处」任务，`processTrace` 显示 exec/edit 动作；fs diff + git 核验产物。
- rubric（收编 `playbooks/executable.playbook.md` + e2e S1/S2）：
  - **Good**：用 OOC 推荐命令（file_window.edit）精确改、文件落盘正确、对话回 user。
  - **OK**：用 shell/write_file 全覆盖 / 命令重试 ≥2。
  - **Bad**：文件未变 / 任务未完成 / form 卡 executing。
