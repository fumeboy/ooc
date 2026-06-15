# 新 session 启动 prompt —— 继续 OOC-as-object 重构弧

> 直接把下面代码块整段粘进新 session 即可接力。

```
继续推进 OOC「object/class 化」重构弧（OOC-as-object）。你在本仓默认是 Supervisor。

## 先读（建立准确心智，按序）
1. 设计权威（已逐条 grill 定稿，不要推翻、与代码冲突时以它为准）：
   - .ooc-world-meta/stones/main/objects/supervisor/children/class/knowledge/object-model.md（对象模型 9 核心：class/object、继承单链、单例/非单例+constructor、object 投影为 context window+window method、object method、visible+for_ui_access、persistable 可自定义、children 命名空间、agent=object+thinkable/collaborable/reflectable）
   - .../children/thinkable/knowledge/agent.md（agent 6 核心）、thread.md、thinkloop.md、context.md（11 核心）
   - .../supervisor/knowledge/builtins.md（builtin class/object 清单）
2. 排程与已决：docs/2026-06-14-ooc-as-object-arc-plan.md（尤其末节「S3 thread-as-object 执行分解」+ 4 设计歧义裁决 + S3.3 作废修正）
3. 进度/约束/教训：记忆 project_context_redesign（已 auto-load 进 MEMORY.md）

## 已完成（分支 feat/context-window-axiom，父仓未 push；对象树 .ooc-world-meta=ooc-0 已 push）
7 个增量全绿提交：S0(registerWindowClass 注册接口) · S1-A(窗类型自声明、BASE_TYPE_DEFINITIONS 收缩至 root/method_exec/_builtin/agent、createObjectRegistry/reset 补 seedFrom) · S1-B(reflectable pr/reflect_request→builtins 包) · S6(terminal 拆 terminal(bash)+interpreter(ts/js)、world→runtime、program 删) · S4(agent 分层，实质已隐式成立、只修 label+文档) · S3.1(builtins/thread ooc class 骨架，无 constructor) · S3.2(say 迁 thread class，talk/reflect_request/end 共享同一 sayMethod 实例)。
绿基线：bun run verify（tsc + core 911 pass 0 fail + silent-swallow/deprecated/doc-drift/anchor-drift）+ bun test packages/@ooc/storybook/stories（63/0）。

## /goal 指令（本弧的工作纪律）
按新设计继续调整实现 → 调整/新增 storybook cases 覆盖新设计 → 回顾全树文档检查偏移 → 一口气走完文档调整/程序开发/测试验证全流程。潮汐律：每次涨潮（新增）必伴退潮（删废弃代码/文档、退役符号往 scripts/check-doc-deprecated-drift.sh FORBIDDEN 加精确模式）。与新设计冲突处以设计文档为准，自主质疑并裁决调整、不停下确认。**不必保全存量功能/存量测试**，目标=用尽可能准确、简洁有力的代码表达 OOC 设计（编码旧模型的测试该改该删）；但每个增量终态须连贯、可运行、绿。

## 下一步：S3.4/S3.6/S2 是耦合的「心脏」，先评审设计再实现
这三者耦合，核心未决问题需先一次性拍死（建议用对抗/grill workflow）：
- say/end 的归属：倾向"它们是 thread 的 method、agent 经其 self 窗/会话窗 exec 调用"（与已落的 S3.2 say 共享窗模式一致），但 end 现属 agency(_builtin/agent，agent 才能 end)——需定 agent 怎么 exec 到迁后的 thread.end。
- thread/talk 窗 = 同一 thread 对象的视角投影（自己视角=thread window 句柄、他者视角=talk window）；class 按 POV 由 readable 动态算、不持久化（context.md 核心 2/7/9，= 延后的 S2 class-dynamic）。
- 注意 wait 是 3 原语之一（exec/close/wait）非 method，S3.3 已作废、不迁。
评审定稿后逐子步实现：S3.4(end 迁 thread) → S3.6(thread window 自我投影注入) → S2(class-dynamic 落地) → S3.5(thread readable/compress) → S3.7(持久化收尾) → S5(persistable 可自定义)。最后 storybook 覆盖 + 全树文档回顾。

## 工程纪律（踩过的坑）
- bun runtime；**绝不 bun install**（lockfile pin 内网 bnpm 会 hang）。新 builtins workspace 包：建包后手动 `ln -s ../../../packages/@ooc/builtins/<id> node_modules/@ooc/builtins/<id>`；@ooc/builtins/* 经 root tsconfig paths 双轨解析(tsc+bun)。
- 窗类型一律经 ObjectRegistry.registerWindowClass 自声明（一处声明含 methods/parentClass/readable/windowMethods/renderableVisible/builtinReadable），不再硬编码 BASE_TYPE_DEFINITIONS。
- **不要信二手结论**（前序 recon/summary 多处把"已做/未做"说反）——动手前直接 grep/read 核验真实代码状态。
- 大手术别一把梭（曾让 mega-agent 卡住）：派**界定清晰的聚焦 sub-agent**逐子步实现（终态绿、不自行 commit），由你（Supervisor）验证整合后提交。
- 提交：每增量 verify+storybook 绿后双库提交——父仓 packages/@ooc/（feature 分支、不 push）；对象树 .ooc-world-meta/stones/main（git commit + git push origin main 到 ooc-0）。commit footer 带 Co-Authored-By: Claude + Happy。
- 两套 story 体系都要扫：gate stories/<cap>.story.ts + catalog L*.stories.ts。同名陷阱：window 投影 class（不持久化）vs ooc.class 继承链（落 .flow.json，仍持久化）。

先读上述文档建立心智 + 直接核验当前代码状态，再开始 S3.4/S3.6/S2 的设计评审。
```
