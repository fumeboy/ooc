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
   用 \`open(method="write_file", path="pools/<self>/knowledge/memory/<slug>.md",
   content="...")\` 写入。已存在的文件可以用 open_file + edit 增量更新。
3. 必要时(caller 明确要求改身份/对外说明) 也允许写
   \`stones/<self>/self.md\`(内部第一人称叙述)或 \`stones/<self>/readable.md\`
   (对外公开自述)。其它路径(server / client / files / package.json) 本轮不要碰。
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
| \`"method::<window_type>::<method>"\` | 在 \`<window_type>\` 上打开同名 method form 时命中 | \`"method::root::talk"\` / \`"method::root::program"\` |
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
  "method::root::talk": "show_description"
  "window::talk": "show_content"
---

每次跟 alice 起新讨论前，先用 program 跑一个最小可执行 demo……
\`\`\`

**自检**：写完 .md 之后，回想一下"下次哪个 window / method form 出现时
我希望 LLM 想起这条沉淀？"——把它填进 activates_on。如果都填空，等于白写。
`.trim();

/**
 * 元编程 knowledge —— 教 LLM 新模型下如何改自己的"身体"：业务 session 直接
 * write_file（落本 session 的 worktree 副本，即时生效、main 不变），经 super flow
 * evolve_self 合入 main；cross-object 改动 evolve_self 时自动转 PR-Issue 给 supervisor。
 *
 * 与 REFLECTABLE_KNOWLEDGE 的关系：上一段讲记忆沉淀（写 pool），本段讲改身体 + 合入闸门。
 *
 * 2026-06-09：随 metaprog 写路径去除重写——不再有 open_worktree/commit/merge 手动四步，
 * 改身体统一走「业务 session write_file → super flow evolve_self」。
 */
export const REFLECTABLE_METAPROG_PATH = "internal/executable/reflectable/metaprog";

export const REFLECTABLE_METAPROG_KNOWLEDGE = `
# 改自己的"身体"：业务 session 写，super flow 合入

你对自己 self 文件的修改有两条线，分清楚就不会犯错。

## 改身体（self.md / readable.* / executable/** / visible/**）

在**业务 session**（不是 super flow）里直接 \`write_file\` 写 \`stones/<self>/...\`。
- 改动落在本 session 的私有副本，**本 session 内即时生效**，但 main（canonical 权威自我）不变。
- 写错也只影响这个 session，main 不被污染——放心试。
- 要让它**永久定型**：在本 session 调 \`end\` 进 super flow，在那里用 \`evolve_self\` 合入（见下）。

## 改记忆（memory/<slug>.md / relations）

直接 \`write_file\` 到你的 pool。记忆是沉淀、无加载风险、即时生效，不需要合入流程。

## 在 super flow 里：evolve_self 把试验合入 main

\`\`\`
open(method="evolve_self")                               # 先看 diff：这次试验改了身份的哪些文件
open(method="evolve_self", args={ message: "为什么改" })   # 整个 session 的 identity 改动一并合入 main
\`\`\`
合入成功后下一轮新 session 见新身份。**super flow 自己不直接 write_file 改 stone**——它的职责是
合入（evolve_self）、沉淀记忆、以及（supervisor）治理。改身体永远在业务 session 做。

## 改别人已存在对象（cross-object）

在业务 session 直接 \`write_file\` 写 \`stones/<对方 id>/...\` 改对方**已存在**的文件。
evolve_self 合入时，凡触及别人自治区的改动会**自动转 PR-Issue 给 supervisor**
（返回值带 \`prIssueId\`），等 supervisor 评审 \`resolve\`；其间 main 不变。

## 建**全新**对象 → 用 create_object（不是裸 write_file）

建一个还不存在的对象，**必须用 \`create_object\`**（原子建骨架），不能裸 write_file——
write_file 靠 package.json 判 owner 边界，新对象还没 package.json 会被拒。

\`\`\`
open(method="create_object", args={
  objectId: "<newId>",
  selfMd: "...",            # 新对象第一人称身份
  readableMd: "...",        # 新对象对外自述
  knowledge: { "x.md": "..." }   # 可选 seed 知识
})
\`\`\`
- 骨架落本 session worktree（\`objects/<newId>/{package.json,self.md,readable.md[,knowledge/]}\`），main 不变。
- 仅业务 session 可调（super flow 是合入闸门不建对象；控制面建对象走 HTTP）。
- end → super flow \`evolve_self\` 合入：建新对象 ≠ 你自己（cross-scope）→ 自动开 PR-Issue 给 supervisor \`resolve\`。

**口诀**：建新对象 = create_object；改已存在对象（自己/别人）的文件 = write_file/edit。

## supervisor 专属（你不是 supervisor 时跳过本节）

- \`metaprog\` action \`resolve\` —— 评审一个 PR-Issue：
  \`open(method="metaprog", args={ action:"resolve", issueId: <N>, decision: "merge" | "reject" | "request-changes" })\`
- \`metaprog\` action \`rollback\` —— 把某个 Object 的 stone 回滚到先前 commit：
  \`open(method="metaprog", args={ action:"rollback", objectId: "<id>", targetCommit: "<sha>" })\`
  典型场景：启动期看到 \`[recovery-needed] <id> stone unloadable\` PR-Issue。回滚由你（supervisor）署名。

## 一条心法

**改身体 = 业务 session write_file + super flow evolve_self 合入；改记忆 = 直写 pool。**
`.trim();

/**
 * G2 (Round 11): end-form reflection reminder —— 业务 thread 调 end 时自动激活
 * 的一段 hint knowledge，提醒 LLM 在 submit end 之前考虑是否需要通过 super flow
 * 沉淀经验。
 *
 * 注入条件（参见 synthesizer.collectExecutableKnowledgeEntries）：
 * - thread 中存在 form.method === "end" 的 method_exec window
 * - thread.persistence?.sessionId !== SUPER_SESSION_ID（避免 super flow 内
 *   end 时套娃提醒）
 *
 * 注入档次：protocolEntries（与 REFLECTABLE_KNOWLEDGE 同档），不是 form-scoped
 * methodKnowledgePaths——reminder 是 protocol 级别提示，与 end 自身用法描述独立。
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

## 如何开 super flow 反思 (两步)

**步骤 1**: 在你当前 thread 内创建一个指向 super 的 talk_window:
\`\`\`
exec(method="talk", args={
  target: "super",        // 自指别名: 派送到自己的 super 分身, 不是另一个叫 super 的 Object
  title: "<反思主题简述>"
})
\`\`\`
返回创建好的 \`<talk_window_id>\` (形如 \`w_talk_xxx\`)。

**步骤 2**: 通过该 talk_window 发出反思请求:
\`\`\`
exec(<talk_window_id>, "say", args={
  msg: "请帮我沉淀: <具体内容, 越具体越容易形成单条 memory>",
  wait: true              // 等 super 分身 reply 后再继续
})
\`\`\`

super 分身 (同一身份, 另一脉络) 会看到 REFLECTABLE_KNOWLEDGE 指引,
写一个 \`memory/<slug>.md\` 文件, 然后通过同一 talk_window reply 你。
你看到 reply 后即可 close talk_window + 重开 end 表单。

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
2. 跑上面的 talk + say(wait=true) 流程
3. 看到 super reply 后 close talk_window
4. 重新 \`open(method="end", args={...})\` 结束业务 thread
`.trim();
