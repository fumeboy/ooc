/**
 * Reflectable protocol knowledge — 注入到 super flow（sessionId === "super"）
 * 的 thread context 中，告诉 LLM "你现在在 super flow 里，本轮是反思场景而非
 * 执行新业务任务"。
 *
 * 注入路径：src/thinkable/knowledge/synthesizer.ts collectExecutableKnowledgeEntries
 * 触发条件：thread.persistence?.sessionId === SUPER_SESSION_ID
 *
允许 LLM 在 super flow 里写 `pools/<self>/knowledge/memory/`
 * (并允许更新 self.md / readable.md),让 caller "请帮我把 X 沉淀为记忆" 这种请求
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
   \`stones/<self>/self.md\`(内部第一人称叙述)或 \`stones/<self>/readable.md\`
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
- \`description\`: 一句话让下轮 LLM 决定是否相关（命中 \`show_description\` 级别时露这段）
- \`activates_on\`: trigger map，**至少一项 entry**，否则永远无法激活

\`activates_on\` 是 \`Record<trigger, "show_description" | "show_content">\`。三类 trigger：

| trigger 形态 | 含义 | 例子 |
|---|---|---|
| \`"window::<type>"\` | 该 type 的 window 处于 open 时命中（root window 每个 thread 都有，故 \`"window::root"\` 等价"任何时候"） | \`"window::talk"\` / \`"window::root"\` |
| \`"command::<window_type>::<command>"\` | 在 \`<window_type>\` 上打开同名 command form 时命中 | \`"command::root::talk"\` / \`"command::root::program"\` |
| \`"super"\` | 仅在 super flow（反思 session）中命中 | \`"super"\` |

value 取值：
- \`"show_description"\` — 命中后向 LLM 露 description 摘要
- \`"show_content"\` — 命中后向 LLM 露 full body

多 trigger 命中时取 **max**（\`show_content\` > \`show_description\`）。

完整模板（每篇 .md 写入时照此结构产出，**正文位置自由发挥**）：

\`\`\`markdown
---
title: <一句话主题>
description: <一句话让下轮 LLM 决定是否相关>
activates_on:
  "<trigger 1>": "show_description"
  "<trigger 2>": "show_content"
---

<正文，可以是几句也可以是长文>
\`\`\`

示例（一篇关于"与 alice 协作的注意事项"的 relation 沉淀）：

\`\`\`markdown
---
title: 与 alice 协作时的对齐节奏
description: alice 偏好先看小步原型再聊设计；先丢草稿再讨论效果好
activates_on:
  "command::root::talk": "show_description"
  "window::talk": "show_content"
---

每次跟 alice 起新讨论前，先用 program 跑一个最小可执行 demo……
\`\`\`

**自检**：写完 .md 之后，回想一下"下次哪个 window / command form 出现时
我希望 LLM 想起这条沉淀？"——把它填进 activates_on。如果都填空，等于白写。
`.trim();

/**
 * U7: Metaprog 协议 knowledge —— 教 super flow LLM 如何走 git worktree 沙箱、
 * 安全地修改自己的 server / self / readable 等"高赌注"文件。
 *
 * 与 REFLECTABLE_KNOWLEDGE 的关系：
 * - 上一段是默认指引：写 memory 目录是 super flow 最常见的反思动作，无版本风险
 * - 本段是"重操作"指引：当 caller 请求改 executable/index.ts、整篇 self.md 重写、
 *   增删 server method 等可能导致 Object 加载不动的修改时，应当走 worktree
 *
 * 不强制——简单 memory 追加可以直接 write_file 落 main；只有"改身体"级修改才
 * 推荐 worktree。LLM 自己判断粒度。
 */
export const REFLECTABLE_METAPROG_PATH = "internal/executable/reflectable/metaprog";

export const REFLECTABLE_METAPROG_KNOWLEDGE = `
# 元编程：用 worktree 安全地改自己的"身体"

当 caller 的反思请求需要修改你的 \`executable/index.ts\` / 整篇 \`self.md\` /
\`readable.md\` 等"加载链路"上的文件时（即一旦写错下一轮启动就跑不起来的内容），
**不要直接 write_file 落 main**。改用元编程协议：在 git worktree 沙箱里改、
试运行、再合并。错了能直接丢 worktree、main 不被污染。

## 何时走 worktree（推荐）

- 改 \`stones/<self>/executable/index.ts\`（你的方法库；写错下一轮加载失败）
- 整篇重写 \`stones/<self>/self.md\` 或 \`readable.md\`
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

/**
 * G2 (Round 11): end-form reflection reminder —— 业务 thread 调 end 时自动激活
 * 的一段 hint knowledge，提醒 LLM 在 submit end 之前考虑是否需要通过 super flow
 * 沉淀经验。
 *
 * 注入条件（参见 synthesizer.collectExecutableKnowledgeEntries）：
 * - thread 中存在 form.command === "end" 的 command_exec window
 * - thread.persistence?.sessionId !== SUPER_SESSION_ID（避免 super flow 内
 *   end 时套娃提醒）
 *
 * 注入档次：protocolEntries（与 REFLECTABLE_KNOWLEDGE 同档），不是 form-scoped
 * commandKnowledgePaths——reminder 是 protocol 级别提示，与 end 自身用法描述独立。
 *
 * 设计原则：非阻塞 hint，LLM 自由判断是否需要反思；不是强制反思 gate。
 */
export const END_REFLECTION_REMINDER_PATH = "internal/executable/end/reflection-reminder";

export const END_REFLECTION_REMINDER_KNOWLEDGE = `
# 在 end 之前: 考虑通过 super flow 沉淀经验

你正在准备结束当前 thread。在 submit end 之前, 花一秒钟想想:

- **本次工作产生了什么值得带走的东西?** 比如:
  - 新的认知 / 工作模式 / 抽象方法
  - 踩过的坑 / 反直觉的点 / 工具的边界
  - 与某个 peer (含 user) 协作中的偏好 / 节奏 / 沟通模式
  - 对自己身份 / 职责边界的更新
- 如果有, **不要只留在 endSummary 里** — endSummary 不会进入下一轮你的 context, 等于没沉淀。
  真正的长期记忆走 super flow → 写到 \`pools/<self>/knowledge/memory/<slug>.md\`,
  **下一轮新 thread 启动时, OOC 会通过 frontmatter 的 activates_on 自动激活这条记忆**, 你会"想起来"。

## 如何开 super flow 反思 (一步)

向 super 自指别名 talk 一条反思请求, 带 \`wait: true\` 等回信:
\`\`\`
exec(method="talk", args={
  target: "super",        // 自指别名: 派送到自己的 super 分身, 不是另一个叫 super 的 Object
  content: "请帮我沉淀: <具体内容, 越具体越容易形成单条 memory>",
  wait: true              // 等 super 分身 reply 后再继续
})
\`\`\`

super 分身 (同一身份, 另一脉络) 会看到 REFLECTABLE_KNOWLEDGE 指引,
写一个 \`memory/<slug>.md\` 文件, 然后用 talk 回信给你 (出现在你的
\`<self_view><talks>\` 自视切片里, peer="super")。看到 reply 后即可重开 end 表单。

## msg 写什么好

- ✅ "请帮我沉淀: file_window.edit 失败时优先调 reload 重读再 edit, 否则会撞 stale content"
- ✅ "请记下与 alice 协作的节奏: 先丢可执行 demo, 再聊抽象设计"
- ❌ "随便反思一下这段工作" → 太模糊, super 分身无法形成具体 memory

## 什么时候不必反思

- thread 只是简单查询 / 读一个文件 / 一次性 utility 类任务 → 没有可沉淀的
- 已经在 super flow 内 (本提醒不会出现, 因为 super flow 内 end 是反思自身的结束)
- caller 明确说 "不必反思直接结束"
- 本次工作的认知**已经**有对应 memory 文件 (避免重复沉淀)

## 反思 ≠ 必做; 是 hint 不是 gate

判断不需要 → 直接 submit end 即可。判断需要 →
1. **close 当前 end form** (\`close(form_id)\`)
2. 跑上面的 talk(target="super", content=..., wait=true) 流程
3. 看到 super reply (自视 talks 切片) 后
4. 重新 \`open(command="end", args={...})\` 结束业务 thread
`.trim();
