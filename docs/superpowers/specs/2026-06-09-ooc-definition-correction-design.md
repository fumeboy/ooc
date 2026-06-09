# OOC 定义校正（Phase 1）—— 设计 / sub-agent 统一 brief

> 把 `.ooc-world-meta/stones/main/objects/` 这棵 OOC 对象树校正成一份**清晰正确、设计师有观点**的
> OOC 系统定义，以**最新代码 + git log 为唯一真相**。本阶段不删任何旧源、不动测试、不改
> `object.doc.ts`/`docs/ooc-6` 本身（留 Phase 2 吸收）。
>
> 本文同时是发给每个维度 sub-agent 的统一 brief。

## 1. 目标与范围

校正对象树：`supervisor` + 10 个 children——
`thinkable / executable / collaborable / observable / reflectable / programmable / visible / persistable / class / app`。
每个对象的 `self.md` / `readable.md` / `knowledge/*.md`。

路径：`.ooc-world-meta/stones/main/objects/supervisor/children/<dim>/`
（supervisor 本身在 `.ooc-world-meta/stones/main/objects/supervisor/`）。

## 2. Ground truth 与校正准则

**唯一真相 = 代码 + git log。** 所有文档（`object.doc.ts`、`docs/ooc-6`、对象现有 self/knowledge）一律
当作**可能过期的参考**，与代码冲突时信代码。每条事实断言锚 `源文件:行号`（如
`packages/@ooc/core/thinkable/context/index.ts:273`）。

**全局必修的已知过期点**（每个维度凡涉及都要改对）：
1. **window command → window method**：window method 由 Object 的 **readable** 模块（`registerReadable`，
   `packages/@ooc/core/runtime/object-registry.ts`）注册，**只控制 window 的信息展示**（如 viewport/视口）；
   与它并列的是 **object method**，由 **executable** 模块（`registerExecutable`）注册，**操作 object 的数据**。
   不要再用 "window command" 这个词。
2. **Issue 多对象同 topic 会话** —— 此设计**已废弃**。相关描述删除或明确标注「已废弃」，不作为现行机制。
3. **`stones/<git_branch>/objects/agent_of_X`** —— 已不存在。OOC objects 现落 `.ooc-world-meta/stones/main`
   下（worktree 统一模型：业务 session 是 `flows/<sid>/` 的 git worktree，详见 persistable）。
4. 各维度还须**主动扫出本片其它漂移**，参考近期 git log 主线：去 metaprog（统一 write_file→session
   worktree→evolve_self 合入）、registry 按维度劈分（registerExecutable/registerReadable）、
   thread-context §10（thread.json 退役 contextWindows）、运行时 object 目录统一到 flows/<sid>/objects/<id>、
   OOC Class 一等继承等。

## 3. 产出形态

"**设计师有观点**"：身份 + 当前设计 + 现状 + 已知问题/演化方向。**只改对事实、保留叙事结构**。
**Object 口吻**——读者是这个维度对象自己的 LLM（它要靠这份 self/knowledge 理解"我是谁、我负责的这片
怎么设计的、现在到哪了、还有什么问题"），不是写给外部开发者的上帝视角实现旁白。保留各对象现有的分节风格。

## 4. 维度 → 代码区映射（sub-agent 各自的"自己这片"）

| 维度 | 代码区 |
|---|---|
| thinkable | `packages/@ooc/core/thinkable/`（llm/context/knowledge/thread/thinkloop/identity） |
| executable | `packages/@ooc/core/executable/` + `packages/@ooc/builtins/` + `packages/@ooc/core/runtime/object-registry.ts`（registry 维度劈分、object method、tool 原语、constructor） |
| collaborable | talk/do/relation（`core/executable/windows/{talk,do,relation}`）+ flows 消息投递 + Issue（已废弃，须标注） |
| observable | `packages/@ooc/core/observable/` + runtime debug/activity/pause 端点 |
| reflectable | `packages/@ooc/core/programmable/evolve-self.ts` + super flow + memory 沉淀 + worktree 试验层 |
| programmable | `core/runtime/server-loader`、热更、`core/extendable/`、server 方法源 |
| visible | `web/` + `packages/@ooc/core/app/server/modules/ui/`（client-source-url）+ 各 builtin 的 visible/ |
| persistable | `packages/@ooc/core/persistable/`（stone/pool/flow 三子树、worktree、thread.json/thread-context.json、versioning） |
| class | `core/app/server/bootstrap/instantiate-classes`、`object-registry` parentClass 链、builtin=class/world=object |
| app | `packages/@ooc/core/app/server/`（控制面 HTTP：路由、worker/job、pause/resume） |

> readable 是横切概念（registerReadable/readable.ts/windowMethods），代码里当维度级处理，但对象树里只有
> `visible` 没有 `readable` child。各 agent 照代码如实写；**readable 是否独立维度、还是归 visible/executable
> 之下**由 Supervisor 汇总时裁定（必要时回问用户）。

## 5. 每个 sub-agent 的交付契约

- **就地编辑** `.ooc-world-meta/stones/main/objects/supervisor/children/<dim>/` 下的 `self.md` /
  `readable.md` / `knowledge/*.md`（按需新增/拆分 knowledge 文件，但不大改文件组织除非必要）。
- **不要自己 commit / push**（Supervisor 统一处理 submodule 提交）。
- **不要碰** `packages/@ooc/`、`docs/`、其它维度的对象目录、测试。
- 返回一段**结构化总结**：改了哪些文件、修正了哪些过期断言（附 file:行号）、扫出的本维度其它漂移、
  发现的**跨维度不一致**或**存疑点**（尤其涉及 readable/visible、executable/readable 边界）。

## 6. submodule 提交工作流（Supervisor）

`.ooc-world-meta/stones/main` 是 submodule → `github.com/fumeboy/ooc-0`（branch main）。汇总各 agent
改动后：在 submodule 工作树内 commit + push 到 ooc-0，再在主 repo bump submodule 指针并 commit。

## 7. 不在本阶段

删除任何旧源（meta_deprecated / docs/ooc-6 / packages/@ooc/meta）；改动测试；修正
`object.doc.ts` / `docs/ooc-6` 本身。这些留 Phase 2（文档吸收）/ Phase 3（测试归属）/ Phase 4（删源）。
