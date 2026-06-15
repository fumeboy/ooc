---
title: 四分语义 - Builtin / Stone / Pool / Flow
description: OOC 持久层四分边界（Builtin 运行时定义层 + Stone / Pool / Flow 三分），supervisor 管理 World 时的核心心智模型
activates_on:
  "object::root": "show_description"
---

# 四分语义

OOC World 文件系统按四种持久性质分层。术语解释（stone-versioning / PR-Issue 等）见
`world-vocabulary.md`。

| 层 | 性质 | 进 git？ | review 机制 |
|---|---|---|---|
| **Builtin** | 运行时自带定义：身份 + 源码 + schema + seed knowledge（随 OOC 代码发布） | ✓（OOC 源码仓） | 代码仓 PR review；Agent 不可改写 |
| **Stone** | 用户/Agent 创建 Object 的设计层：身份 + 源码 + schema + seed knowledge | ✓（world stones git） | feat 分支 PR（沉淀进 canonical 需 reviewer 审阅，supervisor 始终参与） |
| **Pool**  | 事实：data csv + sediment knowledge + files | ✗ | 写就生效 |
| **Flow**  | 运行：thread + session_data + 临时 relation | ✗ | 即用即弃 |

## Builtin（运行时定义层，随 OOC 源码仓版本化）

`packages/@ooc/builtins/<id>/`（源码仓内，**不在用户 world 中**）：
- `self.md`：身份（对内 instructions）
- `readable.md`：对外展示文本
- `executable/index.ts`：executable methods（含 ui_method）
- `visible/index.tsx`：UI 页面
- `knowledge/<slug>.md`：seed knowledge

**Agent 不可写 Builtin**：Builtin 由 OOC runtime 代码保证，任何写（`write_file` / `create_object`）尝试改 Builtin 会被拒绝。升级 supervisor / user 的定义通过 OOC 发版完成。

当前 Builtin Object：`supervisor`、`user`、`root`、`file`、`plan`、`todo`、`program`、`knowledge`、`search`、`skill_index`。

## Stone（设计层，world 内进 git）

`stones/main/objects/<id>/`：
- `self.md` / `readable.md`：身份（对内 + 对外）
- `executable/index.ts`：executable methods（含 ui_method）
- `visible/index.tsx`：UI 页面
- `knowledge/<slug>.md`：seed knowledge（人类设计的初始知识库；带 `activates_on` frontmatter）

沉淀进 canonical 走 stone-versioning 流程：业务 session 试验（worktree，永不合入 main）→ super flow
feat 分支 PR（`new_feat_branch` → 编辑 → `create_pr_and_invite_reviewers` commit + 开 PR → reviewer 审批 → 合入）。

## Pool（事实层，不进 git）

`pools/<id>/`：
- `data/<name>.csv`：结构化数据（一张表一个 csv 文件，首行 header）
- `knowledge/memory/<slug>.md`：长期记忆（reflectable 主要写入位置）
- `knowledge/relations/<peer>.md`：对各 peer 的 long-term 关系认知
- `files/...`：任意二进制 / 大文件 / 非结构化 blob

`pools/repos/<repo-name>/`：跨 Object 协作的外部 git repo 工作面。

Pool **对 Builtin 和 Stone Object 都适用**：supervisor / user 的跨 session 沉淀同样写在
`pools/supervisor/`、`pools/user/`。

## Flow（运行层，临时）

`flows/<sessionId>/<objectId>/`：
- `threads/<tid>/thread.json`：thread 状态序列化
- `data.json`：session 级数据载体（程序方法层 `getData` / `setData`）
- `knowledge/relations/<peer>.md`：session 临时 relation

## 关键原则

- **schema in builtin or stone, data in pool**：设计意图进 git，运行时事实不进 git
- **Builtin 不可被 Agent 改写**：runtime 定义通过 OOC 发版升级
- **Stone 改动经审计**：沉淀进 canonical 必经 feat 分支 PR 评审（reviewer 集随变更领地冒泡，supervisor 始终参与）
- **事实层信任**：pool 写就生效，Object 自治
- **运行层即用即弃**：flow 数据 session 结束可归档

## 一个完整例子：user 让我创建 `pdf-extractor`

| 何时何处 | 哪一层 | 写什么 |
|---|---|---|
| 我（supervisor，Builtin）回复该需求 | **Builtin (定义) + Pool (沉淀)** | 身份/定义不变；如果学到新东西写 `pools/supervisor/knowledge/memory/...` |
| 我创建该 Object | **Stone** | `packages/pdf-extractor/{self.md, readable.md, knowledge/usage.md}` |
| pdf-extractor 后续写自己的方法 | **Stone** | `packages/pdf-extractor/executable/index.ts` |
| 用户传一份 pdf 让它提取 | **Pool** | `pools/pdf-extractor/files/<uuid>.pdf` + `pools/pdf-extractor/data/extractions.csv` |
| 它通过 super flow 总结"长 pdf 要分块" | **Pool** | `pools/pdf-extractor/knowledge/memory/long-pdf-chunking.md` |
| 当下这次 user → pdf-extractor 的对话 | **Flow** | `flows/<sid>/pdf-extractor/threads/<tid>/thread.json` |
