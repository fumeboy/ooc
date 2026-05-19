# OOC end-to-end testing strategy

> **何时读这份**：要新写一类 e2e 测试（backend / frontend / 其它入口），或要给现有 e2e 加场景，或想理解 OOC 现在的 e2e 体系覆盖到了哪里、漏在哪里。**单元测试不适用本策略**——单元测试沿用 `bun:test` 自然规范即可，这份只管"用户真的用 OOC 当 CodeAgent"那条链路。

---

## 1. 我们到底在测什么

OOC 的主张：**把 LLM 的上下文当成可被原语操作的 window，让 LLM 像写代码一样写自己的 context，并通过 cross-object talk 与人 / 其它对象协作完成代码任务**。

"是否好用"必须同时通过两个观察孔验证：

| 观察孔 | 看什么 | 谁该开心 |
|---|---|---|
| **A. User story** | 用户给一个真实任务（"在 src/foo.ts 中把函数 X 改名为 Y"），任务是否完成、文件是否真改了、对话是否回到 user | 用户 |
| **B. OOC 机制** | LLM 走了什么 commands / 创建了什么 windows / talk-delivery 是否双写正确 / form 状态是否正常流转 | OOC 设计者 |

**两个观察孔同时通过才叫 e2e 通过。**只看 A 会漏 OOC 自身的退化（任务完成了但用 shell sed 而非 file_window.edit）；只看 B 会漏"机制都对了但用户看不到回复"。

---

## 2. 三档评分基准：Good / OK / Bad

每个场景跑完后**根据可观察事实**落到三档之一——不靠主观、不靠"差不多就行"。

| 档 | 含义 | 触发条件示例 |
|---|---|---|
| **Good** | 系统按设计的最优路径完成 | thread.status=done；用户能看到回复；用了 OOC 推荐命令（edit/grep 而非 shell sed/rg）；无 form 重启 / talk_window 误关闭 |
| **OK** | 任务完成但有可观察的浪费或绕行 | 完成但绕路：多开 form 又关 / 用 shell 改文件 / talk_window 被 close 又重开 / 命令重试多次后成功 |
| **Bad** | 任务**没完成**，或完成但用户看不到结果，或机制状态错乱 | thread 卡在 running/waiting；user.root 收不到回复；on-disk 文件未变更；form 一直 executing；callee.inbox 与 caller.outbox 不一致 |

**判定规则**：

- 每个场景必须**显式列出** Good / OK / Bad 的判定条件
- 判定基于"测试结束时观察到的事实"（thread.json / 文件系统 / outbox），不基于 LLM 某轮中间表达
- Good 条件应是"任意一次跑都成立"的最低保证，不是"理想 LLM 一次完成"
- OK 是 LLM 行为漂移的容忍区；**OK 不等于"放行"，OK 是需要趋势观察的状态**

**测试运行后**：断言要求 **≥ OK**（Bad → 失败，OK / Good → pass），同时把实际命中的档 + 关键观察值打到 stdout，便于翻 CI 历史看趋势。

---

## 3. 入口分离：backend / frontend 各一份

OOC 有两个用户能实际用的入口，独立演进：

- **Backend 入口** — HTTP API：POST /api/sessions / POST /api/flows/.../continue / GET /api/flows/.../threads/...。curl 也能用。worker 后台跑 LLM，副作用落 fs + thread.json
- **Frontend 入口** — Web UI：SessionCreator 表单 / ChatPanel composer / 切 thread / 看 ContextSnapshotViewer

**为什么分**：
- 调后端时不被前端形态拖住（"我改了 service.ts，但要打开浏览器才能验证"）
- 调前端时不每次都要 mock 整套 HTTP
- 后端先 e2e 通过 → 前端 e2e 才有底气；任一端形态成本低 → 两边可以错开节奏

**分工**：
- `docs/testing/oocable-codeagent-backend-e2e.md` 定义后端 e2e 场景集（API → worker → LLM → 文件 → outbox）
- `docs/testing/oocable-codeagent-frontend-e2e.md` 定义前端 e2e 场景集（Web UI → 用户体验完整路径）
- 两份**共享**本策略的：观察孔 (A+B)、评分基准 (Good/OK/Bad)、不稳定性政策 (§5)
- 两份**各自**定义：场景表 / 触发方式 / 具体观察点 / 工具栈

---

## 4. 场景拆分原则

每个 e2e 场景**同时**符合：

1. **真实任务** — 来自"OOC 作为 CodeAgent"的真实使用场景，不是为了测某个内部方法构造的；最好能映射到一句话的用户意图
2. **可证明的副作用** — 测试结束时有 **fs / HTTP / thread.json** 上的状态可查，能区分 "LLM 嘴上说做了" vs "真做了"
3. **机制可见** — 能从 thread.contextWindows / events 看到 LLM 走过的窗口轨迹，便于诊断"为什么是 OK 不是 Good"

**场景命名**：`<entry>-<verb-noun>-<distinguisher>` — 例 `backend-rename-symbol-via-edit`、`frontend-create-session-and-reply`。

**最小场景集**（每份子文档至少覆盖）：
- 1 个 "纯读取" 场景（不动文件，只读 / 搜）
- 1 个 "改文件" 场景（write_file / file_window.edit 真改盘）
- 1 个 "多轮对话" 场景（用户发第二句、第三句，验 cross-object talk 双写）
- 1 个 "失败回路" 场景（输入无效 / 工具误用，验 LLM 收到的错误信息可读且不卡死）

---

## 5. 不稳定性与 LLM 行为漂移

真实 LLM 有方差。同一 prompt 跑两次可能选不同路径。本策略对此态度：

- **不强求 Good** — 通过门槛是 ≥ OK
- **Bad 是真信号** — Bad 几乎一定是 OOC 真错了（协议文本误导 / 命令实现 bug / 通路断了），不是 LLM 一次发挥
- **OK 多发是黄信号** — 连续 N 次都 OK 不到 Good，说明 OOC 引导力在某处不够，回看协议文本
- **重试政策** — CI 上每个场景允许重试 1 次；两次都 Bad 才视为失败。重试需打日志记录原因
- **OK / Good 趋势归档** — 每次 CI 跑出来的"命中档 + 关键观察值"应留作 artifact，便于人审查"上周 8/10 Good 这周变 3/10 Good"这种退化信号

---

## 6. 触发方式与 LLM 真假

| 测试模式 | LLM | 触发 | 适用 |
|---|---|---|---|
| **真 LLM e2e** | 真（环境变量配齐） | env-gated，默认 skip | 主要 e2e 形态。CI 在 `RUN_E2E=1` 下跑 |
| **mock LLM e2e** | 模拟 | 默认跑 | 验"机制通"的快速回归；mock 的 LLM 输出固定脚本化的 tool call 序列；不验"LLM 是否被协议正确引导" |
| **半真 e2e** | 真 LLM 但工具 mock | 仅作探查，不进 CI | 临时用来定位"是 LLM 误判还是工具实现错" |

主线 e2e 是"真 LLM"那条；mock LLM 仅作机制回归补丁，**不能替代真 LLM e2e**。

---

## 7. 不写什么

显式排除在本策略外：

- **单元测试** — `bun:test` 散布在各模块的 `__tests__/`，沿用既有规范
- **性能测试 / 压测** — 不在本期范围
- **多用户并发 / 多 session 隔离** — 不在本期范围（OOC 当前是单租户开发者工具）
- **跨浏览器兼容** — frontend e2e 只针对当前主开发浏览器
- **数据持久化迁移** — thread.json schema 变更属于另一条工作流

---

## 8. 相关文档

- `docs/testing/oocable-codeagent-backend-e2e.md` — 后端 e2e 场景集
- `docs/testing/oocable-codeagent-frontend-e2e.md` — 前端 e2e 场景集
- `docs/solutions/conventions/llm-tool-handlers-fail-loud-2026-05-15.md` — fail-loud 原则；e2e 的 Bad 档判定直接受这条约束
- `docs/solutions/conventions/agent-doc-work-verify-as-you-go-2026-05-15.md` — 写新 e2e 测试本身也适用：加一个场景 → 立刻跑一次确认能挂能过
