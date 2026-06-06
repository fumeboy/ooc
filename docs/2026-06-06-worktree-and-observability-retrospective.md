# Worktree 落地 + 可观测增强 复盘（2026-06-06 会话二）

> 承接 `docs/2026-06-06-harness-sweep-retrospective.md`（会话一：8 维度 sweep + worktree 设计升级 + 地基）。
> 本会话（会话二）做两件事：①把 worktree 统一模型从地基**实现完整**（接续指南 §1-§4）；
> ②由 harness programmable 反复 TIMEOUT 触发的**可观测能力增强**（三件套）。
> 9 个 commit（`c2d50665`..`00e4bbc3`），全在 ooc-6。事实锚 = git log + harness 报告（gitignored）。

## 1. 一句话结论
worktree 统一模型（session identity = lazy git worktree 分支，取代 plain overlay）**实现完整并经三维度 harness live 验证**（persistable=Good / visible=OK / programmable=TIMEOUT，server 零错误）；由 programmable 超时暴露的"盲等"问题，落地**可观测三件套**把 TIMEOUT 变成可诊断。

## 2. 成果

### 2.1 worktree 模型落地（接续指南 §1-§4，6 commit）
| commit | 范围 | 要点 |
|---|---|---|
| `c2d50665` | 地基 + §1 | `resolveStoneIdentityRef(ref,mode)`：返回带 `_stonesBranch` 的 ref，让 ref-based 通道（loadSelf/loader feed/program shell）靠 `stoneDir(ref)` 天然路由；恢复地基测试 worktree 完整副本内容断言 |
| `726ab0e1` | §2 通道一 | program shell `$OOC_SELF_DIR` → worktree（write 模式 lazy 建，裸读裸写完整 identity） |
| `db9e54ea` | §2+§3 | write_file·edit·open·loadSelf·object_stone_dir → worktree；**evolve_self 重做**：commit `session-<sid>` 分支→ff-merge main→GC（移除 worktree+删分支），session 分支即演化单元 |
| `881c800c` | §2 通道五 | visible endpoint `client-source-url` 带 `?sessionId` 预览 worktree 产物 |
| `328cea8e` | §4 | 回收 plain overlay（删 session-overlay.ts+单测，relWithinObjectFromPackages 移入 session-path）；object.doc `main_overlay_evolve_model`→`main_worktree_evolve_model` |
| `69dffab6` | 回流 | persistable playbook overlay→worktree（harness Issue #1） |

**关键设计判定**：
- **worktree 建失败不裸写 main**——用 `_stonesBranch` 是否存在判真 worktree，回退则 fall through versionedStoneWrite，绝不绕过版本化。
- **loader 通道不 per-session 路由**——executable 命令集/注册 readable 是全局 main-canonical（object 类型系统全局共享，registrar/synthesizer 一次性注册）；per-session 改命令集本就走 evolve_self→main→重注册。
- **lazy 物化**——纯读 session 不建 worktree（read 模式透传 main）；写时才实例化。harness E2 实测印证。

### 2.2 三维度 harness live 验证
persistable **Good**（S1 改 self 落 worktree/main 不变、S2 evolve_self 署名 assistant 合 main + worktree GC、E1/E2 跨-session 隔离 + 演化生效、lazy 物化），visible **OK**（`?sessionId` 预览 endpoint S2 Good；OK 源于 agent 不知 `visible/index.tsx` 契约 + 多页 flow scope，非 worktree 改动），programmable **TIMEOUT**（server 零 worktree 错误，agent 节奏耗尽）。

### 2.3 可观测三件套（3 commit）——由 programmable TIMEOUT 触发
**根因**：programmable.server.log 370/370 行全是同一条 `[readThread] references missing object assistant ... skipping`——无界重复把真信号淹没，超时只能事后 tail。

| commit | 件 | 能力 |
|---|---|---|
| `5a8dc1a5` | log-aggregator | `observable/log-aggregator.ts`：按 key 去重计数 + 限流（首3直出/之后每100采样带 `×count`）+ `logPatternSnapshot()`。readThread 5 处刷屏警告路由经 `observeWarn` → 370× 收口为 ~6 行 + 总数可见 |
| `8bfcae81` | activity 端点 | `GET /api/runtime/activity`：jobs(running 带 ageMs/statusReason) + runningCount + 主导日志模式。一读即知"卡在哪、被什么刷屏" |
| `00e4bbc3` | harness 超时快照 | orchestrate 超时前 curl activity → `<dim>.timeout-snapshot.json` + dashboard 备注。短超时(25s)真 harness 验证：dashboard 显示 `TIMEOUT 快照: running=0 无主导日志` |

## 3. 方法论沉淀：超时是 observability 症状，不该干等
长跑/超时/卡住 = observable 维度能力不足的症状。正确响应是**增强可观测让根因可实时定位**，而非盲等到超时再 tail。一次性 TIMEOUT 标记是黑盒；活动快照（jobs ageMs + 主导日志模式）把它变成可诊断。已纳入 memory `feedback_timeout_is_observability_symptom` + harness 循环常设环节（见 `engineering.harness.doc.ts`）。

## 4. 未决跟进
- **[数据 bug, 高] `assistant` 死 `_ref`**：thread-context.json 引用无 state.json 的 self 对象 `assistant` → readThread 刷屏的**数据根因**。注意：会话一 `1fe94790` 的 `isVolatileDerivedWindow` 只剔除 **guidance 派生窗**（type="guidance"），不覆盖 self 对象 ref。observable 已止血（不刷屏+可见），数据 bug 待根治。
- **[visible, 中] 落点契约可发现性**：agent 默认不知 `visible/index.tsx` 是唯一被 endpoint 解析的落点（首轮写到 `pools/.../Card.tsx`）；多页 `client/pages/<n>.tsx` flow scope 链路不通。
- **[persistable, 低] abandoned worktree 无 GC**：写后未 evolve 的 session worktree 只有 evolve_self 路径会回收；生产长跑可能堆积，需启动 prune / session 清理回收入口。
