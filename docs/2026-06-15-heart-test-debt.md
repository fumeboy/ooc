# 心脏重构（H1→H4）测试债账本

> 大重构期间**不逐步修测试**（见记忆 feedback_refactor_defer_test_fixes）。每个增量改源码 + 登记
> 受影响的测试/storybook 到此账本，**全部源码改完后统一修 + 跑全绿**（`bun run verify` +
> `bun test packages/@ooc/storybook/stories`）。中间增量提交可带已登记的红测试。
>
> 登记格式：`文件:符号/行` — 旧断言 → 新预期（够最后照单修复即可）。

## H1 ✅（commit d1d43e5b，已就地修绿——本账本前）
talk-family class 收口 + 停持久化。已就地更新 4 处并跑绿，无遗留债。

## H2 — 自视角窗 → class `thread`（end 仍在 agency）
> 源码变更：computeProjectionClass(isCreatorWindow→thread/super→reflect_request、else→talk)；
> thread extends talk、reflect_request extends thread；isTalkLikeClass/wait/persistence/findCreatorWindow 纳入 thread。
> 行为变化：自侧 creator 窗（非 super）class 'talk'→'thread'；super 自侧仍 'reflect_request'。

### 受影响测试/storybook（断言级；统一收尾时照单核对）
单一根因：**普通 flow 的 creator 窗（self-view，isCreatorWindow=true，非 super session）class 从
`"talk"` 投影为 `"thread"`**。凡按 `class === "talk" && isCreatorWindow` 定位 self-view 的断言，
旧值 `"talk"` → 新值 `"thread"`。（super flow 自侧仍 `"reflect_request"`，无变化；对端 peer / 父侧
fork 子窗仍 `"talk"`，无变化。）

- `packages/@ooc/builtins/thread/__tests__/thread-say.test.ts:25-42` — 旧 `getObjectDefinition("thread").methods.say === sayMethod` + `talk/reflect_request.methods.say === thread.methods.say`（直接注册断言）→ 新：say 经 class 链继承，断言 `resolveMethod("talk"|"thread"|"reflect_request","say")` 三者皆 `=== sayMethod`（thread/reflect_request 自身 methods 已不含 say）。
- `packages/@ooc/core/executable/__tests__/commands-execution.test.ts:80-84` — creator 窗 find `class === "talk" && isCreatorWindow`、`expect(creatorBefore.class).toBe("talk")` → `class === "thread"`、`.toBe("thread")`。
- `packages/@ooc/core/executable/__tests__/step2-windows.test.ts:311-313` — `bobCreatorTalk` find `class === "talk" && target==="assistant" && isCreatorWindow` → `class === "thread"`。
- `packages/@ooc/core/executable/__tests__/talk-fork-thread-tree.test.ts:69-70` — childCreatorWindow find `class === "talk" && isCreatorWindow===true` → `class === "thread"`。
- `packages/@ooc/core/executable/__tests__/tools.test.ts:195,210-211` — 两处 creator 窗 find `class === "talk" && isCreatorWindow`（close 被拒 / wait 切 waiting）→ `class === "thread"`。
- `packages/@ooc/core/executable/__tests__/wait.test.ts:19-22` — `findCreatorTalkWindow` find `class === "talk" && isCreatorWindow===true` → `class === "thread"`（错误文案随改）。
- `packages/@ooc/core/executable/windows/__tests__/sharing.test.ts:174-175` — 归还路径 child creator 窗 find `class === "talk" && isCreatorWindow` → `class === "thread"`。
- `packages/@ooc/core/thinkable/__tests__/context.test.ts:265,289,298` — system XML 断言 `class="talk"` + `<class name="talk">`（creator 窗渲染 + window_classes 声明块）→ `class="thread"` + `<class name="thread">`（thread 经链继承 talk 的 say/share/close 菜单，渲染行为一致）。
- `packages/@ooc/storybook/stories/attention-tiering.scenario.ts:52` — creator 窗正则 `<window id="w_creator..." ... class="talk"...>` → `class="thread"`（fork 子窗 `w_talk... class="talk"` 不变）。
- `packages/@ooc/tests/e2e/backend/backend-multi-turn-followup.e2e.test.ts:94-96` — callee 复用同一会话窗计数 filter `class === "talk"` → `class === "thread"`。
- `packages/@ooc/tests/e2e/backend/plan-share-parent-child.e2e.test.ts:80-83` — `findChildCreatorForkWindow` find/guard `class === "talk" && isCreatorWindow` → `class === "thread"`。
- `packages/@ooc/tests/integration/ooc6-object-unification.harness.test.ts:108-110` — creator 窗 find `class === "talk" && isCreatorWindow` → `class === "thread"`。

> 注：上列断言已在本工作树（前序未竟 session 留下）随源码同步改妥并过 tsc；本节为 H2 审计留痕，
> 收尾跑全绿时照此核对即可，无需再改测试源。

## H3 — thread 窗核心 10 渲染（events 折入 / methods-only XML / 内容进 message 流 / compress）

（待 H3 实现登记）

## H4 — end → thread class（agency 去 end、显式 exec(thread窗)）

（待 H4 实现登记）

## 收尾修复清单
（全部源码改完后，照上面各节统一修复 + 跑全绿，再清空本账本/删文件）
