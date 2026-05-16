# OOC executable — Claude Code 平齐第一期：文件读写 + 代码搜索

- **Date**: 2026-05-15
- **Stage**: brainstorm
- **Tier**: Standard / feature
- **Driver**: OOC 当前做实际代码任务时缺 file edit/write + code search，被迫跳出去用 Claude Code / Codex / Cursor。本期补齐这一段，让 OOC object（含 user 通过 talk 调起的 assistant）能就地完成代码任务
- **Recommended next step**: `/ce-plan` 单独消化"哪些是 root command / 哪些是 file_window 上的命令 / search_window 自身命令面"等技术细节
- **Origin**: `todo.md`（"为 OOC 系统支持一个标准 CodeAgent 所应当具有的能力"）

## Problem

OOC executable 目前有 8 个 root command（do/talk/program/plan/end/todo/open_file/open_knowledge）+ 5 原语 + cross-object talk。但要做一个真实的代码任务（写代码、改代码、grep、定位文件）会发现：

- **改代码**：`open_file` 只能读不能改；只剩 `program(language=shell, code="sed ...")` 兜底，但 sed/awk 既脆弱又难做多文件原子修改
- **建新文件**：同样要走 `program(shell)` echo 重定向，无任何安全检查
- **找代码**：要走 `program(shell, code="rg ...")`；结果是一段裸文本，下一步要继续操作（比如打开命中的某个文件）就要 LLM 自己解析 rg 输出

这迫使任何"用 OOC 做代码任务"的尝试要么放弃用 OOC 就地干、要么把 OOC 退化成"调 shell 的壳子"——OOC 自己的 ContextWindow / 渐进式披露 / cross-object talk 等设计优势完全没机会发挥。

## Goal

让 OOC 在以下四类操作上与 Claude Code 平齐：

- 文件**修改**（Edit / MultiEdit 等价）
- 文件**新建**（Write 等价）
- **glob 文件名**搜索
- **grep 内容**搜索

且新能力**严格走 command / knowledge 层**，**不增加新 LLM tool**——5 原语稳定性是 OOC 立身之本，不为 Claude Code 平齐而妥协。

## Non-goals（本期）

- task list 升级（TodoWrite 风格的 task_window）
- Web 能力（web_fetch / web_search）
- background process（program_window 的 run_in_background）
- worktree / cron / NotebookEdit
- "把 OOC 包装成宿主、向外暴露成 Claude Code 替代" 这种 positioning-level 工作
- 修改既有 5 原语
- 文件 / 搜索能力的权限审批模型（这是 cross-cutting 的，下一期与其它 IO 一起做）

## Users / Beneficiaries

| 角色 | 受益方式 |
|---|---|
| 任意 OOC object（含 user 通过 talk 派生的 assistant） | 收到代码任务后能就地用 OOC 命令完成，不再被迫退化为 program(shell, sed/rg) |
| user（通过 web 控制台向 assistant 派任务） | "让 assistant 改一下 src/foo.ts" 这类指令真的可执行 |
| Future ce-* 工作流 | brainstorm/plan/work 在 OOC 内运行时，agent 不需要跳到外部工具 |

## Approach（已经在 brainstorm dialog 中收敛到一种）

按 OOC 的 "tool / command / knowledge" 三层设计准则归类后：

| Claude Code | OOC 形态 | 类别 |
|---|---|---|
| Edit / MultiEdit | 拓展 `file_window`，注册 `edit` 命令（在已 open 的 file_window 上做 oldString → newString 替换） | command on existing window |
| Write | open question for plan：是 root.write_file 直建文件 + 自动产生 file_window，还是要先 open_file 再用 file_window.edit | command（root or window） |
| Glob | 新 root command `glob`，submit 后产出 `search_window`（type=search） | new root command + new window type |
| Grep | 新 root command `grep`，submit 后产出 `search_window`（同上 type，不同 search.kind） | 同上 |

**两个新 window type 的草图**（细节留 plan）：

- `search_window`：保留 query + matched paths/snippets；自身可注册 `next_page` / `open_match(index)` / `refine_query` / `close` 等命令——让"搜索→打开命中"成为窗口内自然链路而不是 LLM 自行解析文本
- `file_window` 增加可写性：`edit(oldString, newString)` 命令；如果选了 root.write_file 路线，也意味着 file_window 要支持"未持久化的草稿"状态，否则 plan 决定"write 直建 + 立刻 commit"

**为什么不引入新 tool**：edit / write / glob / grep 都不需要 universal tool 级别的可见性。它们是"在 file_window 上的能力"或"产 search_window 的能力"，与 OOC 现有 8 个 root command 同形。引入 tool 会让 LLM 心智模型从"5 原语 + 一组 command"变成"5+N 原语 + 一组 command"，无故拉高复杂度。

## Success criteria

1. assistant object 收到 "在 src/foo.ts 中把函数 X 重命名为 Y" 这种任务时，可以走 `glob → open_file → file_window.edit` 完成，全程不调 program(shell)
2. assistant object 收到 "找到所有用了某 deprecated API 的文件并修掉" 时，可以走 `grep → search_window.open_match(i) → file_window.edit` 完成，仍不调 shell
3. 新增的命令对应的 protocol knowledge（每个 command 的 basic / 每个新 window type 的 basicKnowledge）合成进 LLM context 后，LLM 能在不看实现源码的情况下知道怎么用
4. 5 原语 / 现有 8 个 root command 行为不变；现有测试全 pass

## Key decisions captured

- **完全对齐 Claude Code 工具集**（用户决策）= 第一期目标，但**通过 command + knowledge 表达**，不通过新 tool
- **第一期范围**（用户决策）= 文件读写 + 搜索 = `edit_file / write_file / glob / grep` 这 4 项能力
- **edit 拓展 file_window**（用户决策）= 不新加 root.edit_file，而是在 file_window 上注册 `edit` 命令；同理 write 倾向同形（细节 plan 决）
- **搜索产 search_window**（用户决策）= glob / grep 不只是返回 result 文本，而是产生持久 window，让"结果也是 window"作为统一抽象延伸
- **不引入权限审批模型** = 第一期先建能力，权限统一规划放后续期

## Risks / Assumptions

- **风险**：file_window 加 edit 后，未持久化草稿状态怎么管？是 edit 立即落盘还是缓冲到 save？写文件失败时 file_window 状态如何回滚？— 全是 plan 阶段的具体决策
- **风险**：search_window 的 search.kind 区分（glob vs grep vs 未来的 ast-grep）是否要在 type 上区分？还是同 type 不同字段？— plan 阶段
- **假设**：Claude Code 的 Edit 工具用 "唯一字符串匹配 → 替换" 的语义，OOC 的 file_window.edit 沿用同样语义；MultiEdit 通过多次 edit 命令（或单次 edit 的 args 接受 array）表达 — plan 阶段定
- **假设**：search_window 的命令面（next_page / open_match / refine_query）在第一期可以只做 open_match + close，其它推迟；这不会破坏后续扩展

## Open questions for `/ce-plan`

1. write_file 是 root command 直建文件 + 自动 spawn file_window，还是要求先 open_file 再 file_window.edit？前者一步到位，后者更"OOC 风"（每个文件先表达"我要看着它"再改）
2. file_window.edit 是否支持 MultiEdit 风格的 array of (old, new) 一次提交？
3. search_window 第一期需要哪些命令？最小集：close。next_page / open_match 是否要进首版？
4. file_window.edit 失败（oldString 不唯一 / 未匹配）的错误形态：sync 返回到 LLM？产生一个 `edit_failure_window` 持续可见？
5. 是否应该把 `program(language=shell, code="rm/mv")` 这种"shell 写文件" 标记为反模式（在 program knowledge 里写明：要改文件请用 file_window.edit，不要 shell sed）？

## Related

- `meta/object/executable/concepts/context-window.doc.js` — ContextWindow 抽象的概念入口；新增 search_window 时同样在 windows/ 下加一个 doc
- `meta/object/executable/concepts/window-registry.doc.js` — 新 window type 的注册入口；search_window 走 registerWindowType
- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — 同源会话沉淀；新 command 实现时遵守"args 缺失 fail loud"
- `docs/solutions/conventions/agent-doc-work-verify-as-you-go-2026-05-15.md` — 同源沉淀；写新 command + 对应 meta 概念时 per-step 验证
- `src/executable/windows/talk.ts` — 新 window type 的实现参考模式（registerWindowType + basicKnowledge + 注册 commands）
