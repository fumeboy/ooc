# Storybook 全维度 harness sweep 复盘（2026-06-11）

> 一轮 harness 循环：Supervisor 新建全新 world → 启动后端 → 派 3 组 AgentOfExperience（体验官）
> 按 storybook 9 维度 rubric 对**运行中的 world** 真派任务、真 LLM 行使能力、抽过程轨迹 + HTTP 核验产物。

## 环境

- 全新 world `.ooc-world-sb`（初始仅 supervisor 一个对象），后端 `:3000`，LLM 经 `.env` 的 claude 代理。
- 三组体验官 sub agent 并行，共享同一 running world，session 前缀 `_test_exp_<cap>_<ts>`，新对象 `exp_<cap>_<rnd>`。

## 评分矩阵

| 维度 | 评分 | 一句话 |
|------|------|--------|
| thinkable | 🟢 Good | 派多维问题，refine 一轮成文，引用继承 knowledge，区分 thinkable/reflectable 准确 |
| executable | 🟢 Good | `glob` 真 method 调用落 search window，0 匹配是诚实正确（world_root 无 .md） |
| collaborable | 🔴 **Bad** | create→talk 同 job 内必失败；peer 永 404、无 callee thread、无回应，job 仍报 done |
| observable | 🟢 Good | `/api/runtime/activity` 实时 runningCount、debug/loops 可回放（含 meta/windowsSnapshot）、global-pause 可控 |
| reflectable | 🟢 Good | super flow 真落 `pools/supervisor/knowledge/memory/*.md`，frontmatter 合法、下轮自动激活 |
| persistable | 🟡 OK | worktree 三子树 + git 链全对、cross-scope 正确开 PR-Issue；但 PR resolve 入口不可见，对象进不了 main |
| programmable | 🟡 OK | 写出 method 但 schema 失配 loader；真 method-call 路径从未验证（退化 raw exec 自证） |
| visible | 🟡 OK | `visible/index.tsx` 产物形态正确，但经 `client-source-url` 端点 100% 不可达（路径割裂） |
| class | 🟢 Good | `_builtin/supervisor` 拒交互/只读、instance↔class 链接 + 继承知识在线实证 |

底座是通的：对照亮点 `exp_vis_loop_15595` 经 `put-server-source`+`call_method` **真合入 main 且 method 调通**（TC-VIS-05 行为侧绿）。

## 收敛根因（订正稿）：运行时**读路径 session-unaware**，硬读 main

体验官初判为「建出来没合入 main 所以用不上」。Supervisor 代码复核 + 用户拍板订正：**真根因是读路径没把 sessionId 接进 ref**，而非「该合入未合入」。

确定性证据：
- **写已正确**：`createObjectInSession`（`method.create-object.ts` → `stone-create-object.ts`）把新对象落 `flows/<sid>/objects/<newId>/`。
- **session worktree 物理自足**：`flows/<sid>` 是分支 `session-<sid>`（从 main 切）的完整 worktree——`git ls-tree HEAD objects/` 含继承自 main 的 `objects/supervisor`，磁盘上同时躺着新建的 `objects/exp_collab_2819`（untracked）。**继承对象 + 新对象同在一个 worktree 目录里。**
- **读硬读 main**：几乎所有 `stoneDir()` 读路径构造 `StoneObjectRef` 时**不带 `_stonesBranch`** → 落默认 `stones/main/objects/<id>`，从不看 `flows/<sid>/objects/<id>`。受害点遍布：`talk/index.ts:235`（talk target）、`api.client-source-url.ts:71/75`（visible）、`stone-self.ts`/`stone-readme.ts`/`stone-object.ts`(executable/visible/knowledge)/`stone-skills.ts`/`stone-server.ts`/`stone-client.ts` 全维身份/配置读。

### 设计方向（用户拍板，2026-06-11）

> **session 内 create object → 写 `flows/<sid>/objects/<id>/`；运行时加载对象配置 → 也从 flow session 读，而非 stone/main。因为 flow session 记录实际运行时状态。**

即：**flow session worktree = 权威运行时读作用域**（main 分支底座 + 本 session 写，物理自足）；`stones/main` = 共享 canonical 基线；`evolve_self`/PR = 把 session 改动**提升**为 main 共享态的正交动作，**不是 in-session 可用的前提**。

落到代码：运行时在 session `<sid>` 上下文的对象身份/配置解析，`StoneObjectRef` 须携 `_stonesBranch = session-<sid>`（`stoneDir`/`objectDir` 已支持该分支 → `flows/<sid>/objects/<id>`）。worktree 物理含 main 全量对象，单分支解析即全覆盖，main 仅作安全回落。**最佳实现是在 thread 运行上下文构造 session-aware ref 的单一 chokepoint，而非逐个 patch ~20 个读点。**

### 据此重判子缺口

- **G1（collaborable Bad → 真根因）**：talk target 读 main，session 内新 peer 永 `target 不存在`。修读路径后，create→talk 同 job 内即通，**无需合入 main**。
- **G3（visible）**：`client-source-url` 读 main，session 内 visible 产物不可达。同一修复覆盖。
- **G2（PR-Issue resolve 不可见）**：仍是真问题，但**优先级降级**——它属「提升到 main 共享」链路，不再是 in-session 可用的阻塞。待补 `GET /api/runtime/pr-issues`(list/get) 可观测端点 + evolve 返回可调用 resolve 寻址。
- **G4（executable schema 失配）**：独立问题。agent 写 `export default factory`+`handler:`，`server-loader.ts:95` 只认 `export const window`+`exec:` → 即便可达也不注册。建对象 knowledge 缺 canonical executable schema。

次要：`open_knowledge(creating-objects)` 首调偶发 `requireParent: window not found`，需重试。

## 为什么这一轮重要

这条断裂的正是 **dogfooding 最关键链路**：agent 自己建 peer、写方法、自演化合入。能力底座（put-server-source 路径）是通的，断的是 **agent 经自然语言主路自托管**的可达性/闭环/可见性。与 memory `project_ooc7_self_iteration`（worktree 隔离族）、`project_builtin_self_disk_gap`（解析路径族）同源。

## 回流去向（待 Supervisor 拍板 / 派对应 AgentOfX）

- **【主】G1+G3 → persistable（owner，stoneDir/ref 路由）+ collaborable(talk) / visible(client-source-url) / executable(loaders 消费方)**：运行时对象身份/配置解析改为 **session-aware**——在 thread 运行上下文构造携 `_stonesBranch=session-<sid>` 的 ref 单一 chokepoint，让全维读路径落 `flows/<sid>/objects/<id>`。验收：session 内 create→talk/call/visible 同 job 即通，无需 evolve。
- **G2 → persistable(PR-Issue) + observable**（降级）：补 `GET /api/runtime/pr-issues`(list/get) 可观测端点；evolve_self 返回/say 给原生可调用 resolve 寻址。属「提升到 main 共享」链路，非 in-session 阻塞。
- **G4 → programmable + supervisor `creating-objects` knowledge**：建对象 knowledge 明确 executable canonical schema（`export const window` + `exec`）。
- **对象树 design 回流**：上述 session-aware 读语义 = persistable 的 stone/flow/worktree 模型核心，须写进 `.ooc-world-meta/.../children/persistable/`（self.md / knowledge），并在 collaborable/visible 维度标注「读经 session worktree」。提交走 submodule 两步（先 submodule commit，再父仓 bump 指针）。

## 修复落地（2026-06-11，主修 G1+G3）

派 AgentOfPersistable 实现 session-aware 读 chokepoint。**关键发现：chokepoint `resolveStoneIdentityRef`（`stone-worktree.ts`）本就存在且正确**——它在 business session 上下文把 `_stonesBranch=session-<sid>` 接进 ref。bug 是 victim 读点**绕过它**自建裸 `{baseDir,objectId}` ref → 硬读 main。修法 = 把 victim 接回既有 chokepoint，**零新名词/机制**。

改动（3 源文件 + 1 测试）：
- `executable/windows/talk/index.ts`（**G1 主修**）：talk target 存在性检查改经 `resolveStoneIdentityRef(read)` → session 内新 peer 可达；订正过时错误文案。
- `thinkable/context/object-windows.ts`：self 方法注册 + peer readable/方法注册的 stoneRef 改经 chokepoint → session 内新对象的 executable/readable 才加载得到。
- `thinkable/context/renderers/xml.ts`：readable 渲染 stoneRef 经 chokepoint。
- `persistable/session-aware-read.test.ts`：确定性 TDD 集成测试（red→green）。
- **G3（visible/client-source-url）本已是修好态**——`api.client-source-url.ts:61` 早经 `resolveStoneIdentityRef`，测试覆盖确认。

验收（Supervisor 独立复核全绿）：焦点测试 1 pass；`bun test packages/@ooc/core/` **852 pass / 0 fail / 3 skip**；`check:tsc` 净；`test:storybook` gate **63 pass / 0 fail**；真 LLM 回归（throwaway world + :3001）create→同 session talk 通、callee thread 起、对象按 self.md 人设回应——**G1 解除，无需合入 main**。

**残留（建后续小项）**：
- `derivePeerObjectWindows` 的 hierarchical peer 发现（`discoverStoneHierarchicalPeers`）仍 main-anchored——session 内新建 **child** 对象不会自动作为 hierarchical peer 出现（talk 过的 peer 不受影响，走 talk_window 收集路径已 session-aware）。
- 全局 `object-type-registrar`（startup）只扫 `stones/`，session 新对象靠渲染期惰性注册兜底；想进全局 registry 需另设计。
- **G4（executable canonical schema）已修**（2026-06-11，commit 33148bc3）：`creating-objects.md` 补「executable/index.ts 唯一正确写法」子节（canonical `export const window`+`exec` 范例 + 错误写法清单 + 返回三形态），经 server-loader 加载测试验证范例真能注册+调用。
- G2（PR-Issue 可见性）未动，独立跟踪。

## 卫生

- HTTP 无 session/对象删除端点 → 体验官无法自清 flows；`_test_exp_*` 前缀可识别，整 world `.ooc-world-sb` 一次性可弃。
- 体验官未改任何 `packages/@ooc/` 源码、未 commit、未起/杀进程。AgentOfPersistable 改源码（其维度内）、未 commit（Supervisor 整合）、throwaway world/进程已自清。
