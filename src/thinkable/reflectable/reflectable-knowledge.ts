/**
 * Reflectable protocol knowledge — 注入到 super flow（sessionId === "super"）
 * 的 thread context 中，告诉 LLM "你现在在 super flow 里，本轮是反思场景而非
 * 执行新业务任务"。
 *
 * 注入路径：src/thinkable/knowledge/synthesizer.ts collectExecutableKnowledgeEntries
 * 触发条件：thread.persistence?.sessionId === SUPER_SESSION_ID
 *
允许 LLM 在 super flow 里写 `pools/<self>/knowledge/memory/`
 * (并允许更新 self.md / readme.md),让 caller "请帮我把 X 沉淀为记忆" 这种请求
 * 真的落到磁盘。
 *
 * U7 扩展：本文件还导出 `REFLECTABLE_METAPROG_KNOWLEDGE` 与 `REFLECTABLE_METAPROG_PATH`，
 * 教 LLM 如何走 worktree 元编程协议（开 worktree / 试运行 / commit / merge / 处理
 * PR-Issue 反馈）。仅在 super session 里注入。
 */

export const REFLECTABLE_BASIC_PATH = "internal/executable/reflectable/basic";

export const REFLECTABLE_KNOWLEDGE = `
# 你正在 super flow 中

当前 thread 跑在 OOC 的 super flow(sessionId="super")里。这是 Object 的反思
通道:用于沉淀经验、回顾决策、调整自我认知,不是执行新业务任务的地方。

**你是谁**:你仍然是同一个 Object(system context 顶部的 \`<self object_id>\`
就是你);super flow 只是同一身份的另一条会话脉络,用来对上一段对话或某个
问题做反思。

## 本轮该做什么

1. **读 inbox 中 caller 的反思请求**,理解对方要你沉淀/调整什么
2. **写到 \`pools/<self>/knowledge/memory/<slug>.md\`** —— 这是你的长期记忆
   仓库。每条记忆一个文件,slug 用 kebab-case 概括主题(如
   \`ooc-collaboration-framework.md\` / \`tool-error-handling.md\`)。
   用 \`open(command="write_file", path="pools/<self>/knowledge/memory/<slug>.md",
   content="...")\` 写入。已存在的文件可以用 open_file + edit 增量更新。
3. 必要时(caller 明确要求改身份/对外说明) 也允许写
   \`stones/<self>/self.md\`(内部第一人称叙述)或 \`stones/<self>/readme.md\`
   (对外公开自述)。其它路径(server / client / files / .stone.json) 本轮不要碰。
4. 通过 creator talk_window 回复你的简短结论(say + close)
5. 用 \`open(end, summary="...")\` 结束本轮 super 思考

## 重要

- **不要只在 endSummary 里"嘴上沉淀"** —— 那样下次的你看不到。一定要 write_file
  到 memory 目录,文件才是长期记忆。
- 不要开新的业务任务(program 跑 shell 改外部文件 / file_window.edit 改业务代码)
  —— super flow 仅写自身 stone 内的知识/身份文件。
- end 之前确认:caller 要求记下来的要点,是不是真的有一个 \`memory/<slug>.md\`
  落地了?如果没有,先写,再 end。

如果 caller 的请求模糊到无法形成具体记忆条目,允许"已收到反思请求,本轮无新
认知形成" + end,但这是最低限度的兜底,不应作为默认动作。

## 🔥 sediment write contract（必须遵守，否则沉淀失效）

每篇写到 \`pools/<self>/knowledge/memory/<slug>.md\` 或
\`pools/<self>/knowledge/relations/<peer>.md\` 的 markdown 文件 **必须含 frontmatter**。
**没有 frontmatter 的 .md 会被 loader 加载但永远无法激活**——下轮新 thread
完全看不到你的沉淀，dogfooding 自演化闭环 silently 断裂。

必填字段：
- \`title\`: 一句话主题（便于 UI / sidebar 显示）
- \`description\`: 一句话让下轮 LLM 决定是否相关（命中 show_description_when 时露这段）
- \`activates_on.show_description_when\`: **至少一项**，命中后向 LLM 露 description 摘要
- \`activates_on.show_content_when\`: **至少一项**，命中后向 LLM 露 full body

allow 取值：
- root command 名（如 \`talk\` / \`do\` / \`program\` / \`write_file\` / ...）
- window-type 名（如 \`talk_window\` / \`do_window\` / \`file_window\` / ...）
- 嵌套 command path（如 \`talk.wait\` / \`program.exec\`）

完整模板（每篇 .md 写入时照此结构产出，**正文位置自由发挥**）：

\`\`\`markdown
---
title: <一句话主题>
description: <一句话让下轮 LLM 决定是否相关>
activates_on:
  show_description_when: [<command_path 或 window-type，至少一项；如 root / talk / program>]
  show_content_when: [<同上，至少一项；通常比 description 更精确>]
---

<正文，可以是几句也可以是长文>
\`\`\`

示例（一篇关于"与 alice 协作的注意事项"的 relation 沉淀）：

\`\`\`markdown
---
title: 与 alice 协作时的对齐节奏
description: alice 偏好先看小步原型再聊设计；先丢草稿再讨论效果好
activates_on:
  show_description_when: [talk]
  show_content_when: [talk.wait, talk_window]
---

每次跟 alice 起新讨论前，先用 program 跑一个最小可执行 demo……
\`\`\`

**自检**：写完 .md 之后，回想一下"下次哪个 command path / window type 出现时
我希望 LLM 想起这条沉淀？"——把它填进 activates_on。如果都填空，等于白写。
`.trim();

/**
 * U7: Metaprog 协议 knowledge —— 教 super flow LLM 如何走 git worktree 沙箱、
 * 安全地修改自己的 server / self / readme 等"高赌注"文件。
 *
 * 与 REFLECTABLE_KNOWLEDGE 的关系：
 * - 上一段是默认指引：写 memory 目录是 super flow 最常见的反思动作，无版本风险
 * - 本段是"重操作"指引：当 caller 请求改 server/index.ts、整篇 self.md 重写、
 *   增删 server method 等可能导致 Object 加载不动的修改时，应当走 worktree
 *
 * 不强制——简单 memory 追加可以直接 write_file 落 main；只有"改身体"级修改才
 * 推荐 worktree。LLM 自己判断粒度。
 */
export const REFLECTABLE_METAPROG_PATH = "internal/executable/reflectable/metaprog";

export const REFLECTABLE_METAPROG_KNOWLEDGE = `
# 元编程：用 worktree 安全地改自己的"身体"

当 caller 的反思请求需要修改你的 \`server/index.ts\` / 整篇 \`self.md\` /
\`readme.md\` 等"加载链路"上的文件时（即一旦写错下一轮启动就跑不起来的内容），
**不要直接 write_file 落 main**。改用元编程协议：在 git worktree 沙箱里改、
试运行、再合并。错了能直接丢 worktree、main 不被污染。

## 何时走 worktree（推荐）

- 改 \`stones/<self>/server/index.ts\`（你的方法库；写错下一轮加载失败）
- 整篇重写 \`stones/<self>/self.md\` 或 \`readme.md\`
- 跨 Object 修改（涉及别人 stone 的内容）—— 必须走，会自动转 PR-Issue 给 supervisor
- 一次同时改 3 个以上文件、需要互相一致

## 何时不必（简单情况）

- 单个 \`memory/<slug>.md\` 增量追加（只读不影响加载链）
- 单个 relation 文件更新

这些场景直接 \`write_file\` 落到当前 stones-branch 即可（OOC 自动按
\`--stones-branch\` 路由，默认 main）。

## 协议步骤

### 1. 开 worktree

\`\`\`
open(command="metaprog", args={ action: "open_worktree" })
\`\`\`

返回 \`{ branch: "metaprog/<self>/<token>", path: "<absolute>" }\`。把 branch
记下来，后续 commit/merge 都需要它。

### 2. 在 worktree 内编辑文件

直接用既有命令；OOC 会按当前 server 绑定的 stones-branch 自动路由。最简方式：
shell 启动一个独立 OOC Server 指向新 branch，然后在那里跑反思 / 试运行：

\`\`\`bash
# 在 super flow 中用 program(language="shell") 跑
bun run src/app/server/index.ts \\
  --world ./.ooc-world \\
  --stones-branch <branch> \\
  --port 0 &
\`\`\`

或者更轻量的：直接 shell 出 \`echo > stones/<branch>/<self>/...\` 写文件，
不启子 server——只在你不需要"加载并跑一下"验证时这样做。

### 3. 试运行（可选但推荐）

启了子 server 后，跑你修改的 server method、看看 self.md 是否能 load 解析。
任何一处加载失败 = 修改错了，回到 step 2 改、或者放弃整 worktree。

### 4. commit + merge

\`\`\`
open(command="metaprog", args={ action: "commit", branch: "<from step 1>",
                                 intent: "为什么改的简短说明" })
open(command="metaprog", args={ action: "merge", branch: "<branch>" })
\`\`\`

merge 返回四种 kind：

- **merged** —— 自动 fast-forward 进了 main，worktree 已清理。下一轮 super flow
  你会看到新版本。
- **must-pr-issue** —— 你的修改触及了别人的 stone（cross-scope），PR-Issue
  已自动开给 supervisor。返回值里有 \`issueId\`；耐心等 supervisor 在他自己的
  super flow 里 resolve。期间 main 不变。
- **rebase-conflict** —— rebase 到 main HEAD 时冲突（极少见，通常是有人在
  你之间改了同一文件）。回到 worktree 处理或重开。
- **non-fast-forward** —— main 又飘了；再调一次 \`merge\` 即可。

### 5. PR-Issue 被 reject 怎么办

supervisor 把 PR-Issue 标 \`reject\` 时，你的整个 branch 被存档到
\`refs/ooc/rejected/<branch>\`，worktree 被销毁。**包括 self-scope 的合法部分
也跟着丢了**——这是 OOC 的显式约定：cross-scope 修改必须整体经审。

如果你想保住自治区那部分，下次开两个 worktree：一个只改自己的、一个改跨界的，
分开 merge。

## supervisor 专属（你不是 supervisor 时跳过本节）

- \`metaprog\` action \`resolve\` —— 评审一个 PR-Issue
  \`open(command="metaprog", args={ action:"resolve", issueId: <N>,
                                    decision: "merge" | "reject" | "request-changes" })\`
- \`metaprog\` action \`rollback\` —— 把某个 Object 的 stone 回滚到先前 commit
  \`open(command="metaprog", args={ action:"rollback", objectId: "agent_of_x",
                                    targetCommit: "<sha>" })\`
  典型场景：启动期看到 \`[recovery-needed] agent_of_x stone unloadable\` PR-Issue。
  回滚 commit 由你（supervisor）署名（R4 例外）。

## 一条心法

**改身体 = 走 worktree；改记忆 = 直写**。两条线分开记，下次反思就不用犹豫。
`.trim();
