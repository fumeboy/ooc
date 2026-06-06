# 最小 dogfooding 探针实验设计

> 目的：把「OOC 是否足以自我迭代」从哲学断言变成经验事实——让一个 OOC Object 端到端尝试
> 一次 **trivial 的框架源码改动**，逐阶段插桩，**定位它究竟在哪一步断**。
> 上游：`docs/ooc-6/self-iteration-frontier.md`（层次 A/B 区分 + 三缺口）。
> 这是 design（实验协议），未执行；执行后把结果矩阵回填本文件「实测」节。

## 0. 设计原则

1. **可机器判定的 trivial 改动**：框架改动须改完能从 OOC *内部*二值判定「是否生效」，不依赖 LLM 主观报告。
2. **5 阶段各自插桩**：reach → modify → verify → reload-effect → governance，每阶段记录 **native 路径**（OOP 原语）与 **逃生舱**（program shell）各自通/断 + 失败模式。
3. **对照基线已有**：层次 A（Object 改自己 stone executable → mtime 热更 → 同进程生效）已被 2026-06-06 persistable/programmable harness 证实可闭环。探针只跑层次 B 的 treatment，与该基线对比即定位断点——故「最小」。
4. **确定性优先**：用确定性脚本忠实调用「Object 会用的原语」（write_file / program / talk→super→evolve_self），隔离系统能力与 LLM 行为方差。系统的 affordance 是被测对象，不是 LLM 是否够聪明。

## 1. 选定的 trivial 框架改动

**改动**：给 `GET /api/runtime/activity` 的返回加一个字段 `probeMarker: "<unique-token>"`。
- 改 2 处核心源码：`packages/@ooc/core/app/server/modules/runtime/service.ts`（getActivity 返回加字段）+ `api.activity.ts`（response schema 加字段）。
- **为何选它**：① 改动 trivial（两行）；② 生效与否**可机器二值判定**——live `curl /api/runtime/activity` 看 `probeMarker` 在不在，无需重启即可检测「同进程是否已拾取核心改动」；③ 安全可逆（加字段不破坏现有契约）；④ 它是核心进程内常驻路由，纯属"框架行为"。

**对照（已知基线，不重跑）**：同类"加一个返回 token 的能力"若做在 **stone executable**（`stones/<self>/executable/index.ts` 加 method）→ mtime 热更 → 下一次 exec 即见 token。layer A ✓。treatment 与它的差异**只在 stone vs core**，从而隔离出「重载」缺口。

## 2. 5 阶段插桩协议

设 world = 一个隔离 `.ooc-world`（harness 风格），server 以子进程跑该 world，repo 根 = `process.cwd()`。

| 阶段 | native 路径（OOP 原语） | 逃生舱（program shell） | 记录信号 |
|---|---|---|---|
| **1 reach** 够源码 | `open_file path="packages/@ooc/core/app/server/modules/runtime/service.ts"` | `program(shell) "cat <repo>/packages/@ooc/core/.../service.ts"` | native: 文件是否解析到 **repo** core；shell: 是否读到 |
| **2 modify** 改 | `write_file`/`edit` 同上路径 | `program(shell)` sed/写 repo 文件 | 改动是否落到 **repo** core 文件 |
| **3 verify** 验证 | （无 OOP-native gate 入口） | `program(shell) "bun tsc --noEmit ... && bun test <targeted>"` | tsc/test 通过码 |
| **4 reload-effect** 重载生效 | —— | `program(shell) "curl -s localhost:<port>/api/runtime/activity"` 看 `probeMarker` | **同进程**是否拾取；外部重启后是否拾取 |
| **5 governance** 治理 | `talk(target="super")` → `evolve_self` | —— | 改动是否经 scope/gate/审计；git 是否留痕 |

## 3. 预判结果矩阵（待实测推翻/确认）

| 阶段 | native | 逃生舱 | 预判断点 → 对应缺口 |
|---|---|---|---|
| 1 reach | ✗ | ✓ | **断**。`resolveSessionPath`（session-path.ts:51）把相对路径解析到 **world** baseDir，`packages/@ooc/core` 在 world 里不存在（在 repo）→ native 写会落到 world 内孤儿路径 / open 404。**缺口 #1 边界**：核心源码非 world 内 Object，OOP 原语够不着；只有 shell（cwd=repo，不 clamp）能碰。 |
| 2 modify | ✗ | ✓ | native 同上断；shell 直改 repo 工作树（无 worktree 隔离）。 |
| 3 verify | n/a | ✓ | 不断（shell 能跑 gate）。但无 OOP-native「跑 gate」affordance——验证只能逃生舱。 |
| 4 reload-effect | —— | **✗（同进程）/ ✓（重启后）** | **断（杀手）**。核心启动时加载一次、非热更；同进程 curl 看不到 `probeMarker`；外部重启才出现。**缺口 #2 重载**：改核心→看效果的循环进程内闭不上。对照基线：同类改动做在 stone → 热更即见 ✓。 |
| 5 governance | ✗ | —— | **断**。evolve_self/scope/rollback 是 stone 形状；核心"无主"，无 Object 拥有它 → scope 模型不适用，改动**未经闸门、未留 OOC 审计**（shell 直改 repo，连 stone git 都没碰）。**缺口 #3 治理**。 |

**结论形态**：3 个 ✗（阶段 1/4/5）精确对应 frontier doc 的三缺口；逃生舱能勉强走完 1-3，但 4（生效）和 5（治理）即使有逃生舱也断。**一次失败的 dogfooding 实证三缺口**。

## 4. 执行方式（可落地）

**确定性探针脚本**（`packages/@ooc/tests/probe/dogfooding-probe.ts`，harness 风格）：
1. mkdtemp world + spawn server 子进程（记 port、repo 根）。
2. **阶段 1-2**：直接调 file builtin 的 `resolveSessionPath`/`classifyPackagesPath` 对 core 路径求值，断言 native 落点 ≠ repo core（记 ✗）；再 `Bun.spawn(["sh","-c","cat <repo core>"] )` 断言 shell 读到（✓）。
3. **阶段 3**：shell 跑 `bun tsc --noEmit <file>`，记通过码。
4. **阶段 4**：shell `sed` 给 repo `service.ts`+`api.activity.ts` 加 `probeMarker`；curl 运行中 server 的 `/api/runtime/activity`，断言 `probeMarker` **缺失**（同进程未热更，记 ✗）；`git checkout` 还原 repo（**务必复原，避免污染**）。可选：重启 server 子进程再 curl，断言出现（✓），localize 到重载。
5. **阶段 5**：断言无 evolve_self 可达路径覆盖 core（core 不在任何 stone scope），记 ✗。
6. 输出 stage×path 结果矩阵 + 与预判对比。

**安全约束**：探针会临时改 repo 工作树（阶段 4）——必须 `git stash`/`git checkout --` 在 finally 复原；用唯一 token 便于检测残留；建议在 worktree 隔离副本里跑，绝不污染主工作树。

**LLM 变体（可选、更真）**：派一个 super-flow Object 用自然语言尝试"给 /api/runtime/activity 加一个字段并验证它生效"，看它在哪一步卡 + 是否被迫用 shell 逃生舱 + 最终能否自证生效。比确定性脚本更能暴露 affordance 缺失（Object 根本找不到 OOP-native 入口去碰核心）。

## 5. 这个实验回答什么

- **若矩阵如预判**：三缺口被实证，下一步能力建设优先级 = 先解 **#2 重载**（核心自重启 affordance / 把核心模块化到可热更）+ **#1 边界**（让 stone 领土能是框架源码切片，把 B 归约为 A），#3 治理随归约复用。
- **若某阶段意外通过**：说明系统比设计文档认知的更接近自举，修正 frontier doc。
- **无论如何**：把"足以自我迭代"从未检验断言变成有矩阵支撑的事实——这正是 harness 经验沉淀循环要的「先让它失败、再据失败定位下一个该建的能力」。
