# root protocol knowledge → builtins/root/knowledge/*.md（按交互面激活 + 信息裁剪）

日期：2026-06-10
状态：设计已批准，待实现

## 动机

OOC Object 每轮看到的"基础环境说明"目前是三个巨型 TS 字符串常量，硬编码在
`core/thinkable`，每轮无条件全量注入：

- `thinkable/knowledge/basic-knowledge.ts` → `KNOWLEDGE`（~470 行，path `internal/basic`）
- `builtins/root/executable/index.ts` → `ROOT_KNOWLEDGE`（root method 菜单）
- `thinkable/reflectable/reflectable-knowledge.ts` → `REFLECTABLE_KNOWLEDGE` /
  `REFLECTABLE_GOVERNANCE_KNOWLEDGE`（super only）/ `END_REFLECTION_REMINDER_KNOWLEDGE`（end form）

两个问题：
1. **形态错位**：这些是 root 这个 builtin object 的知识，却以常量寄居在 thinkable 维度。
2. **信息过载**：无条件全量注入，且大量内容是"系统怎么运转"（worktree 试验层语义、
   evolve_self 内部 commit/ff-merge、form 四态机内部转移、failed form 自然衰减 GC、
   skill_index 派生 TTL）——OOC Object **只需知道如何交互，不需知道运行机制**。

## 决策（已与用户对齐）

- **加载机制**：activates_on 按需激活。每篇 `.md` 按 frontmatter 的 `activates_on` 对应
  "什么交互面出现时才需要这段"，命中才注入。改动局限在 protocol 注入器，**不碰
  parentClass 链**（裸 `root` 不解析框架包，故不能靠 world knowledge loader 自动加载）。
- **内容裁剪**：砍机制、留协议。删"系统怎么运转"，留"我该怎么做"。

## 文件分解（`packages/@ooc/builtins/root/knowledge/*.md`）

| 文件 | activates_on | 内容 |
|---|---|---|
| `interaction-core.md` | `object::root: show_content` | 身份只由 self.md 定 / 私有思考空间(没人读 plain text) / 三原语 exec·close·wait / 一轮收尾决策 / title 必填·mark msg |
| `root-methods.md` | `object::root: show_content` | root method 菜单表（do/talk/program/plan/todo/end/open_*/write_file/create_object/…）|
| `talk-and-super.md` | `object::root: show_description` + `object::talk: show_content` | 怎么 talk(建/复用 talk_window→say) + 发起 super 反思分身的入口 |
| `do-and-share.md` | `object::do: show_content` | do_window.move ref/move + share_windows 糖 |
| `forms.md` | `object::method_exec: show_content` | refine/submit、failed→refine 复活（**不含**状态机内部态/GC）|
| `skills.md` | `object::skill_index: show_content` | skill_index 怎么用(open_file 读 SKILL.md)（**不含** TTL/派生内部）|
| `self-evolution.md` | `object::root: show_description` | 你能改自己:write_file self.md/executable/visible/memory；永久生效经 super flow evolve_self（**不含** worktree-vs-main 深层模型 + evolve_self 内部步骤；示例压成 1 个）|
| `super-flow.md` | `super: show_content` | 你在 super flow:沉淀 memory 协议(frontmatter+activates_on 写法) + evolve_self 合入 + create_object + supervisor 治理（合并 reflectable + governance）|
| `end-reflection.md` | `method::root::end: show_content` | end 前考虑 super 沉淀的 hint |

**取舍**：`end-reflection.md` 用 `method::root::end` 触发后，super flow 里开 end form 也会命中
（旧代码特判排除 super）。纯 activates_on 无 "AND NOT super"，**故意接受这点冗余**——super flow
里 super-flow.md 已在，多一条 end 提示无害，去掉特判更简单（符合"砍机制"）。

### per-type 协议知识（补缺口，2026-06-11）

类型系统批删 `ObjectDefinition.basicKnowledge` 字段后，per-window-type 协议知识不再注入 LLM。
其中 method_exec / talk / skill_index 已被上表的 `forms.md` / `talk-and-super.md` / `skills.md` 覆盖；
其余 5 个窗口类型按同款模式补 `.md`（同住 `builtins/root/knowledge/`，各由 `object::<type>` 激活，
窗口出现才注入、不污染其它 thread；这些窗口都由 root 的 method 派生，故同址）：

| 文件 | activates_on | 内容 |
|---|---|---|
| `relation.md` | `object::relation` | relation_window.edit（session / long_term 两层）+ 写 relations/<peer>.md |
| `plan.md` | `object::plan` | plan_window 增删改 step / 展开收起 sub plan |
| `search.md` | `object::search` | search_window open_match / set_results_window / close |
| `feishu-chat.md` | `object::feishu_chat` | 飞书群聊 refresh/search/send/reply（写需 confirm）|
| `feishu-doc.md` | `object::feishu_doc` | 飞书文档 read/search/append/patch（写需 confirm）|

内容从 git history 恢复 + 砍机制（删 renderXml/派生内部/缓存 TTL）。`computeActivations` 已支持
`object::<type>` 触发，**无需改注入器**。

## 加载实现

- `thinkable/knowledge/loader.ts`：导出 `loadKnowledgeIndexFromDir(dir)`（复用现有
  `collectMdFiles` + `readAndParse`）。
- `thinkable/context/protocol.ts`：`buildProtocolKnowledgeWindows` 改为 async；删除 basic /
  root / reflectable / governance / end 五段常量注入，改为读 `resolveBuiltinDir("root")/knowledge`
  的 index（**模块级 memoize**：builtin 知识在进程内不可变，一次加载），跑
  `computeActivations(thread, index)`，命中篇按 full/summary 形态 emit `KnowledgeWindow`
  (source="protocol")。**保留**：type-level basicKnowledge（每 window type）+ creator-reply
  （动态按 window id 生成）——这俩不是 root 静态知识。

## 删除的 TS 常量

- `basic-knowledge.ts` 整个 `KNOWLEDGE` + `BASIC_KNOWLEDGE_PATH`（文件可整删；`knowledge/index.ts`
  去掉 re-export）
- `root/executable/index.ts` 的 `ROOT_KNOWLEDGE` + `ROOT_BASIC_PATH`
- `reflectable/reflectable-knowledge.ts` 的 `REFLECTABLE_*` / `END_*`（文件可整删）

## 受影响测试

- `reflectable/reflectable-knowledge.test.ts`：改为断言新机制——super session →
  super-flow 知识窗出现；business+end form → end-reflection 出现；内容断言改读 `.md` 文件。
- `tests/e2e/backend/end-reflection-reminder.e2e.test.ts`：同上迁移。
- `storybook/stories/L2_thinkable.stories.ts`（L2-ROOT-KNOWLEDGE）：改为读 `root-methods.md`
  断言含 talk/program。

## 实现备注（落地时的两点细化）

- **目录解析**：`resolveBuiltinDir("root")` 因 `BUILTIN_OBJECT_IDS` 守卫（只含 supervisor/user，
  root 是 window type 不是实例对象）返回 undefined。改为在 protocol.ts 内直接按包名解析
  `dirname(Bun.resolveSync("@ooc/builtins/root/package.json", cwd)) + "/knowledge"`。
- **self-evolution.md 触发**：除 `object::root: show_description`（恒显示一行指针）外，加
  `method::root::write_file: show_content`——开 write_file form 时露全文，使详细指引在"真要写文件"
  时可达，而非永远只有摘要。

## 验证

`bun test` thinkable + reflectable 测试全绿；`test:storybook` gate 0 FAIL；新机制下
super/end/do/talk/form/skill 各交互面命中对应切片、互不串台。
