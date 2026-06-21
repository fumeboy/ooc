# A2 前端消费方 + stone-scope 原则 实现计划

> 设计权威 = issue `.ooc-world-meta/.../docs/issues/2026-06-21-control-plane-editing-model.md`（verified + 后续裁决 stone-scope）。分支 `feat/a2-frontend-and-scope`（worktree，基于 main）。

**裁决原则**：stone scope = 静态源码、无 object-program-call；运行时/data 编辑归 flow session。故删 stones `/call_method`，stone client 只读展示；A1 文件编辑（版本化）与 A2 data 编辑（flow callMethod→visible/server）分两条前端通路。

**纪律**：每 commit 源码连贯；坏测试登记账本最后统一修；sub-agent「只改不 commit/不修测试只登记」；动父仓 git 前核 branch+MERGE_HEAD（[[feedback_concurrent_worktree_hazard]]）；前端 UI 验证受限于 e2e（storybook 是 app.handle 后端层）——后端改 storybook 测，前端 UI 改 typecheck + e2e（可跑则跑）。

## Phase 1：后端删 stones /call_method（stone-scope 原则，storybook 可测）
- `git rm packages/@ooc/core/app/server/modules/stones/api.call-method.ts`。
- `stones/index.ts`：删 `callMethodApi` import + `.use(callMethodApi(service))`。
- `stones/service.ts`：删 `callMethod` 方法（~346-388）+ 相关 import（resolveVisibleServer/dispatch 若仅此用）。
- `stones/model.ts`：删 callMethodBody（若有）。
- flows `/call_method` **保留不动**（完整：dispatchVisibleServerMethod）。
- 账本：route-audit e2e（端点清单删 stones call_method）、引用 stones callMethod 的测试。
- 跑 `test:storybook` 0 fail。报告 + commit。

## Phase 2：前端 stone-scope 原则落地
- `ObjectClientRenderer.tsx`（~84 callMethodFor）：删 stone 分支——stone-scope client **不注入 callMethod**（只读展示）；flow-scope 保留 flowCallMethod。
- `transport/endpoints.ts`：删 `stoneCallMethod`。
- stone client（StoneFallback / 动态 stone visible）确认无交互改 data 残留。
- typecheck。报告 + commit。

## Phase 3：A1 通用文件编辑器 UI（人类编辑源文件，版本化）
- `transport/endpoints.ts`：加 `stoneFile: (objectId)=>\`/api/stones/${enc(objectId)}/file\``。
- `domains/stones/query.ts`（或 files）：加 `putStoneFile({objectId, path, content, confirmOverwrite})` → `PUT stoneFile` body{path,content} + header `X-Overwrite-Confirm`。
- **编辑器组件**：增强 `domains/files/components/FileViewer.tsx`（已预留 `editable/saving/onChange/onSave` props，~55-61）——加编辑模式（textarea + 保存按钮 + 覆盖确认），onSave→putStoneFile。仅对白名单文件（self.md/readable.md/executable/index.ts/visible/index.tsx/knowledge/*.md）显示编辑入口。
- `StoneFallback.tsx` 的 view-source 链接指向 FileViewer 编辑态（可选）。
- typecheck + e2e（可跑则加 FC-A1：FileViewer 编辑→PUT→文件改+commit）。报告 + commit。

## Phase 4：A2 demonstrator —— todo flow 编辑 UI
- todo 现有 `visible/index.tsx`（展示）+ `visible/server`（set_content/toggle_done 已实现）。给 todo 的 flow client（`visible/index.tsx` 或 flow client page）加**编辑交互**：按钮/输入 → 注入的 `callMethod("set_content"|"toggle_done", args)` → 取 `result.data` 更新视图。
- 这是「class 自写 visible 编辑界面经 flow callMethod 调 visible/server 改 data」的端到端 demonstrator。
- typecheck + e2e（可跑则加 FC-A2：todo flow client 点按钮→callMethod→data 改+persist）。报告 + commit。

## Phase 5：测试统一 + 跑绿
- storybook：加 `L8-FLOW-CALLMETHOD-VISIBLESERVER`（app.handle 直调 flow call_method 验 dispatch+persist，确定性）；现有 FC2（stone callMethod）迁 flow 或删。
- 账本统一修；`test:storybook` 0 fail；全量零新增红（预存 env/pr-window 不算）。
- e2e（env-gated，可跑则跑 FC-A1/FC-A2）。报告 + commit。

## Phase 6：文档回流（对象树 push ooc-0）
- `visible/self.md` + `index.md ## visible`/`## app`：stone client 只读展示（无 callMethod）；A1 文件编辑器（FileViewer 编辑态）+ A2 flow client 调 visible/server 的前端通路；stones /call_method 已删。
- issue 后续裁决段标实现完成。

## Self-review
- stone-scope 原则（删 stones call_method + 前端 stone 只读）→ Phase1/2 ✓
- A1 文件编辑器前端 → Phase3 ✓
- A2 flow client demonstrator → Phase4 ✓
- 测试 + 回流 → Phase5/6 ✓
