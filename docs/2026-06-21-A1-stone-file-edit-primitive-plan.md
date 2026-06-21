# A1 —— 通用 stone-file-edit 原语 实现计划

> 设计权威 = issue `.ooc-world-meta/.../docs/issues/2026-06-21-control-plane-editing-model.md`（decided）。本计划只实现 **A1**（A2 visible/server 另起）。分支 `feat/control-plane-editing-model`（worktree `.worktree/control-plane-editing-model`，基于 main e7bf9e33）。

**Goal**：把 `putSelf`/`putReadable`/`putServerSource` 三个同构版本化源文件写端点塌成一个 file-agnostic 的 `PUT /api/stones/:id/file`（body 含 path+content），经 runVersioned 直 commit main，path 经三层防护（safeKnowledgePath + 白名单 + ensureInside）。**只动写（PUT）端点**——读端点（getSelf/getReadable/getServerSource）保留不动。knowledge（pools 端点）不动。

**纪律**：行为保持（同样的版本化写，只是入口收口）；每 commit 源码连贯；坏测试登记账本最后统一修；派 sub-agent「只改不 commit / 不修测试只登记账本」（[[feedback_subagent_no_self_commit]]/[[feedback_refactor_defer_test_fixes]]）；动父仓 git 前核 branch+MERGE_HEAD（[[feedback_concurrent_worktree_hazard]]）。

## Task 1：service 层 putFile + path 防护

**Files**: `packages/@ooc/core/app/server/modules/stones/service.ts`、`model.ts`

- [ ] **1.1 白名单 + path 校验**：在 service.ts 加 `assertEditableStonePath(relPath)`：复用 `safeKnowledgePath`（拒 NUL/绝对/`..`）+ 白名单允许集 `["self.md","readable.md","executable/index.ts"]` + 前缀 `knowledge/`（seed knowledge，subpath 经 safeKnowledgePath）+ `visible/index.tsx`（前瞻可选）；拒绝默认（含 package.json/.git/node_modules/types.ts/index.ts 根）。抛 `AppServerError("INVALID_INPUT", ...)`。
- [ ] **1.2 putFile 方法**：加 `async putFile({objectId, path, content, confirmOverwrite=false})`：`ensureStoneExists` → `assertEditableStonePath` → `ensureOverwriteAllowed(join(dir(objectId), relPath), confirmOverwrite, {objectId, path})` → `runVersioned(objectId, \`http:putFile ${objectId} ${relPath}\`, async (branch) => { await writeFile(join(stoneDir({baseDir,objectId,_stonesBranch:branch}), relPath), content, "utf8") })`。返回 `{ok:true, commitSha, merged}`。注意复用现有 writeFile/stoneDir import；写入路径必须用 versioned ref 的 stoneDir（worktree 分支），同现有 putSelf 经 `_stonesBranch:branch`。
- [ ] **1.3 删 putSelf/putReadable/putServerSource**：删 service.ts 三个写方法（getSelf/getReadable/getServerSource **保留**）。`writeSelf`/`writeReadable`/`writeExecutableSource` 若仅这三处用，删对应 import（createStone 仍用 writeSelf/writeReadable——核对保留）。
- [ ] **1.4 model.ts**：加 `putFileBody = t.Object({ path: t.String(), content: t.String() })`。
- [ ] **1.5 typecheck** 非测试源 0 错。报告 + 我 review + commit。

## Task 2：路由 api.put-file + 删 3 typed 路由

**Files**: 新建 `api.put-file.ts`；删 `api.put-self.ts`/`api.put-readable.ts`/`api.put-server-source.ts`；改 `index.ts`

- [ ] **2.1 api.put-file.ts**：`PUT /stones/:objectId/file`，body=`putFileBody`，`X-Overwrite-Confirm` header → confirmOverwrite，调 `service.putFile`。参照 `api.put-self.ts` 的结构（含 header 解析 + onError）。
- [ ] **2.2 index.ts**：删 `putSelfApi`/`putReadableApi`/`putServerSourceApi` 的 import + `.use(...)`；加 `putFileApi`。getSelf/getReadable/getServerSource 路由保留。
- [ ] **2.3** `git rm` 三个 `api.put-*.ts`。
- [ ] **2.4 typecheck** + grep 残留 `putSelfApi|putReadableApi|putServerSourceApi`（应空）。报告 + commit。

## Task 3：前端 + 调用方核对

- [ ] **3.1** grep 全仓 PUT `/self`|`/readable`|`/server-source` 的非测试调用方（前端 endpoints.ts / domains）。预期前端**无写调用**（仅 GET 读）。若有写调用方，改调 `PUT /stones/:id/file`（endpoints.ts 加 `putStoneFile`）。若无，仅登记。
- [ ] **3.2** 前端通用文件编辑器 UI：**本次不建**（无既有编辑 UI，additive）——登记为 A1 后续 additive 项。
- [ ] 报告。

## Task 4：测试统一修 + 跑绿（账本消化）

**已知断裂账本（Task1-3 grep 补全）**：
- `storybook/stories/persistable.story.ts` TC-PERS-02：`PUT /api/stones/${id}/self` → `PUT /api/stones/${id}/file` body `{path:"self.md", content}`。
- `stones/service.test.ts`：putSelf/putReadable/putServerSource 用例 → putFile（带 path）。
- `app/server/__tests__/server.e2e.test.ts`：putSelf 段 → putFile。
- route-audit e2e（若枚举端点）：更新端点清单（删 3 加 1）。
- 其它 grep 命中的 putSelf/putReadable/putServerSource HTTP 调用测试。

- [ ] **4.1** 逐个改测试到 putFile。
- [ ] **4.2** `bun run test:storybook` 0 fail（CI gate）。
- [ ] **4.3** `bun test packages/@ooc/core/app/server` + 受影响维度全绿。
- [ ] **4.4** 全量 `bun test`，与 base 对比零新增红（预存红 pr-window/transcript-budget 不算）。
- [ ] 报告 + commit。

## Task 5：A1 文档锚点回流（对象树）

- [ ] **5.1** issue「裁决」+ `app/self.md`：A1 已实现，端点 = `PUT /stones/:id/file`，白名单确定值。（对象树独立 repo，commit+push ooc-0。）
- [ ] **5.2** issue status：A1 部分实现记录（A2 待）。

## Task 6：A1 smoke（可选确定性）

- [ ] route-audit / 直调 `app.handle` 验 `PUT /stones/:id/file?path=self.md` 产 commit（等价旧 TC-PERS-02），非 agent 对象写 self.md 仍受 createStone agent-gate 不影响（putFile 不门控 path 内容，但 path 限白名单）。

## Self-review（spec→plan）
- A1 issue 裁决「通用原语 + 白名单 + 退役 typed + 直 commit main」→ Task1/2 ✓
- 「只动写端点、读保留、knowledge 不并入」→ Task1.3/3 ✓
- 测试账本统一修 → Task4 ✓
- filesystem.write_file vs A1 分工：A1 不碰 filesystem（agent 侧），仅控制面 HTTP——无交集，本计划不涉及 ✓
