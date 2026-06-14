# OOC-as-Object 重构弧 —— 设计 + 增量序列（2026-06-14）

来源：用户 `2026-06-14-next_todo.md` 路线图（#1-#5）+ 本会话裁决「context.md 的 class-dynamic/thread-window/share-object 三条核心延后、绑此弧落地」（见 [[project_context_redesign]] / `docs/2026-06-14-context-redesign-impl-plan.md`）。
一句话目标（用户原话）：让 OOC 更好地表达**从 OOP 继承而来的面向对象哲学与表达力**。

## 接地的现状（2026-06-14 实测）
- `builtins/` 下多数 builtin 已是 ooc-object 包形态（file/todo/plan/world/filesystem/terminal/knowledge/knowledge_base/search/skill_index/program/example/root/agent/supervisor/user，各有 self.md+executable+readable+types+package.json）。
- 但 `core/runtime/object-registry.ts` 的 `BASE_TYPE_DEFINITIONS` 仍把**窗类型**（todo/talk/pr/reflect_request/program/file/knowledge/search/skill_index/plan/feishu_* + filesystem/terminal/world/knowledge_base/root/method_exec/example）平行硬编码为裸 `{methods:{}, parentClass:null}`——**对象 dir 与窗注册尚未统一**。
- `reflectable` 仍在 `core/reflectable/{index.ts, pr/, reflect-request/}`，是 window-family 实现模块（side-effect 注册），**非** builtins 下的 ooc-object 包。
- registry 已有 `entry.kind === "constructor"` 概念（非单例实例化的雏形）；`runtime` 已从 module-singleton 重构为按 World 聚合的可实例化类。
- agency 已在 `_builtin/agent`（talk/plan/todo/end）；root 是最小 Object 基类（example+feishu），但 thinkable/collaborable/reflectable 维度能力**尚未明确从 object 抽到 agent 层**（#5 未竟）。
- 绿基线：core 918/0、storybook 63/0、verify 全绿。

## 设计模型（Supervisor 提案，待经 class 维度 self.md 正式化 / 用户可 grill）

### M1 class vs object，单例 vs 非单例，constructor（next_todo #4）
- **ooc class** = 定义（self.md 身份 + ooc.class 继承 + methods + readable + 可选 constructor）。**ooc object** = 运行时实例。
- **单例 class**：class 即 object（唯一实例），无需 constructor，直接可寻址。例：supervisor、各 agent、tool-object（filesystem/terminal/world/knowledge_base）。
- **非单例 class**：提供 **constructor**，每次调用产出一个 object 实例（其 context 投影 = 一个 window）。例：file（open_file 构造）、talk（talk 构造）、todo/plan/knowledge/search/method_exec/pr/reflect_request。
- 由此澄清：现「builtin 窗类型」绝大多数是**非单例 class，其实例是 context window**；tool-object/agent 是**单例 class**。这条把"窗类型"与"ooc class"统一成一个概念，是 #2 的前提。

### M2 builtin context window 作为 ooc class/object（next_todo #2/#3）
- 每个 builtin 窗类（file/talk/todo/plan/knowledge/search/pr/reflect_request/...）是 builtins/ 下一个**非单例 ooc class 包**：提供 constructor + readable（含**按视角算 class**）+ method 注册。
- `core` 不再硬编码 `BASE_TYPE_DEFINITIONS`；改为从 builtins 的 class 定义加载（core **开放接口**供 builtin class 的 method 调用——即 next_todo #2 的"core 开放接口"）。
- #3 = 把 `core/reflectable/{pr,reflect-request}` 变成 builtins/ 下的 ooc class 包；`core/reflectable/index.ts` 退化为**源码索引**（re-export，便于"找 reflectable 相关代码"）。

### M3 class-dynamic 落地（context.md 核心 2/7/9/11，本弧解锁的关键收益）
- M2 之后每个窗都有对应 ooc class/refObjectId ⇒ class 可由 readable 按视角动态算、**不再持久化**（核心 7）：thread-context.json 只存 object id + 展示状态。
- thread 也是 ooc object：自己视角 readable 算出 thread window（句柄、内容进 message 流）、他者视角算出 talk window（核心 9/10）。
- share 传 object 引用、class 由对方 readable 按其视角算（核心 11）。

### M4 persistable 自定义（next_todo #1）
- 持久化成为 ooc object 的**可覆盖能力**：`core/persistable` 现实现 = 默认方式；builtin class/object 可覆盖自己的持久化表示。
- 动机：thread 已是 ooc object，与其为 thread 特例化持久化，不如把特例化变成 ooc object 的个性化能力。

### M5 thinkable/collaborable/reflectable 上提到 ooc agent（next_todo #5）
- **ooc agent extends ooc object**；只有 agent 具备与 LLM 交互（thinkable）+ 协作（collaborable）+ 反思（reflectable）能力。
- root = 最小 ooc object 基类（无 LLM 智能）；`_builtin/agent` = object + thinkable/collaborable/reflectable + agency；supervisor extends `_builtin/agent`。
- 用户已指出 root 没改彻底——把仍寄居 root/object 层的智能能力归位到 agent 层。

## 增量序列（依赖序；每个增量 = 设计对准 + 代码 + storybook + 退潮，绿色提交）
1. **A1 · M1 模型正式化**（设计为主、低风险）：把 M1（class/object/单例·非单例/constructor）写进 class 维度 self.md/knowledge 与 supervisor 知识，统一"窗类型=非单例 class"措辞。**建议先做**——它是 #2 的概念地基，且可让用户 grill。
2. **A2 · M2 builtin 窗类归位**（大）：先 reflectable(pr/reflect_request)→builtins（#3，立 pattern），再逐个把 BASE_TYPE_DEFINITIONS 的窗类迁为 builtins 下 ooc class 包 + core 从 builtins 加载（#2）。**unblocks class-dynamic**。
3. **A3 · M3 class-dynamic 落地**（context.md 核心 2/7/9/11）：停止持久化 class、readable 按视角算 class、thread-window/talk-window 双投影、share=object 引用。
4. **A4 · M5 agent/object 分层清理**：root 最小 object、智能维度上提 agent。
5. **A5 · M4 persistable 自定义**：持久化作可覆盖 object 能力，thread 持久化去特例化。

> 风险/纪律：① 每步保 `bun run verify` + `test:storybook` 绿、小步提交。② 新 builtin 包需 5 处接线 + **手动 `ln -s`**（避 `bun install` bnpm hang）。③ 退役符号往 `check-doc-deprecated-drift.sh` FORBIDDEN 加精确模式、全树回流。④ 两套 story 体系（gate `<cap>.story.ts` + catalog `L*.stories.ts`）都要扫。⑤ 同名陷阱：window 投影 class（不持久化）vs ooc.class 继承链（落 .flow.json，仍持久化）——勿混。

> 执行建议：本弧每个增量都重，宜在**聚焦的新会话**逐个推进（本会话已极长）；A1 可先行（设计、低风险）。
