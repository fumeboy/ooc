# Issue: 兑现 compress —— 接通 window method 写入侧 + renderer 读出侧

> 来源：2026-06-20 「设计文档 vs 实现」全维审计（33-agent workflow）。100 条设计期望中唯一一类**真实代码欠债**。
> 性质：文档先行、类型脚手架已铺满、但行为两端皆空。
> 派单：Supervisor → AgentOfX（thinkable 牵头 + executable 协同）。

## 1. 现状（已确认锚点）

设计文档反复承诺：**compress 不是顶层 tool 原语，而是经 `exec(windowId, method=compress, args=...)` 调用的 window method，折叠/展开由各 window 自实现**（`packages/@ooc/core/executable/tools/index.ts:19`）。

类型脚手架**已完整存在**：

- `thread.ts:264-280` `context_compressed` event（`levelChange` / `reason` / `scope`）
- `thread.ts:299-318` `context_folded` event（`summary` / `foldedBy`，`scope=events` 摘要折叠）
- `compressLevel: 0 | 1 | 2` 三档投影态，落 `inst.win.compressLevel`
- observable 侧已消费：`window-hash.ts:56-60,113,189-191`（hash 剥默认档 + 前端 row 带 compressLevel）

但**行为两端皆空**：

- **写入侧缺失**：全树无任何注册名为 `compress` 的 window method（grep `core/`+`builtins/` 仅命中退役注释 `tools/index.ts:19`、残留枚举 `permissions.ts:44`、UI label `LoopEventBadge.tsx`）。当前 `exec(method=compress)` 会 fail-loud「method 未注册」。
- **读出侧缺失**：`grep compressLevel packages/@ooc/core/thinkable/context/` 只命中 `budget.ts:9` 一句注释——**renderer 从不按 compressLevel 改变渲染详略**。即便写入侧改了档位，LLM 看到的内容毫无变化，压缩零效果。

结论：`tools/index.ts:19` 的「折叠应由各 window 自实现」是写进退役注释、但无人兑现的承诺——正是「各自实现 ⇒ 无人实现」的反面教材。

## 2. Supervisor 拍板（实现方向）

1. **端到端兑现，不做半截**。只补 method 不补 renderer 投影 = 假兑现（档位变了无效果）。本 Issue 验收以「LLM 实际看到的内容随 compress 而缩短」为准。
2. **通用默认实现，而非各 window 各自实现**。现状缺口的根因正是「各自实现」无人兜底。compress 应有一个挂在所有 window 公共层的**默认 compress 行为**，特殊 window 可 override。
   - 调研项：找出 window method 的公共挂载点（base window / 缺省 method 表）。若不存在，提出**最小新增机制**并在反馈中说明，勿为此引入大新名词（克制熵增）。
3. **两个 scope 复用已有类型，不新增 event kind**：
   - `scope=windows`：调整目标 window 的 `compressLevel`（0→1→2 递进 / expand 递减），写 `context_compressed` event。renderer 按档位投影：level 0 全文 / level 1 缩略 / level 2 仅标题句柄。
   - `scope=events`：对 thread events 做摘要折叠，LLM 经 args 提供 `summary`，写 `context_folded` event。
4. **预算解耦不变**：`budget.ts:9` 既有不变量「预算不自动推进档位，compressLevel 仅由 compress/expand 命令与 renderer 显式控制」保持——compress 是 LLM 主动行为，不是预算自动裁剪。

## 3. 任务范围

| 侧 | 维度 | 工作 |
|---|---|---|
| 写入 | executable | 注册通用 `compress` window method（+ 对称 `expand`），改 `compressLevel` / 写 fold event；对接 method 派发（`exec.ts`）|
| 读出 | thinkable | renderer（`context/renderers/xml.ts`）按 `compressLevel` 投影详略；`context_folded` 的摘要替换原 events 渲染 |
| 契约 | both | 写入侧产出的档位/摘要必须被读出侧消费——这是本 Issue 的核心耦合点，须同一改动闭合 |

## 4. 验收

- `exec(windowId, method=compress, args={scope:"windows"})` 不再 fail-loud；目标窗 `compressLevel` 递进、落 `context_compressed` event。
- renderer 对 level 1/2 窗输出**确实更短**（可断言 token/字符数下降）；expand 可逆。
- `scope=events` + `summary` 折叠：被折 events 在 XML 中由摘要替代。
- 至少一条 storybook 控制面确定性断言（Tier A，零真 LLM）覆盖「compress 改档 → renderer 投影变短」闭环；登记进 thinkable `knowledge/tests.md`。
- 退役注释回流：`tools/index.ts:19` / `permissions.ts:44` 等「已退役」措辞改为「下沉为通用 window method（见实现）」，消除「文档先行未兑现」漂移。

## 5. 约束（派单纪律）

- **不要自己 commit**（交回 Supervisor 整合）。
- 大改中间态若打破存量测试，**只登记账本、不逐条修**，全部源码改完后统一跑绿。
- 自验证 session 用 `_test_compress_<timestamp>` 前缀，验完清理，勿污染 `.ooc-world/flows/`。
- 源码与文档分歧时信代码；新增名词前先问「能不能复用已有类型/机制」。

## 6. 落地结果（2026-06-20，Supervisor 整合）

实际落地与原派单（第 2-4 节）有两处 Supervisor 裁决偏差，据核验澄清：

1. **event kind 笔误纠正**：本文原写 `context_folded`，真实 kind 是 **`events_summary`**（`thread.ts:307`）。
2. **scope 范围收窄到 windows**：核验发现 `WindowMethod` 契约是**纯函数**（`readable/contract.ts:11`：「只动投影态、返回新 win、零副作用」）。
   - `scope=windows`（改单窗 `compressLevel`）完美契合纯契约 → **本次落地**。
   - `scope=events`（折叠 thread 对话历史，要改 `thread.events` 的 `_foldedBy` + push `events_summary`）**超出 window method 边界**（ctx 是读侧），归 **thread builtin object 自身能力**，单独立项。读出侧已就绪（`context/index.ts:380-383`），缺写入侧。
3. **`context_compressed` event 降为后续**：纯 window method 不能写副作用。本次以「改档→投影变短→可逆」为核心闭环；event 落账留作 runtime 层 before/after diff 的小增量。

### 改动清单（已落、verify 全绿）
- 新增 `core/readable/default-window-methods.ts`：`DEFAULT_WINDOW_METHODS` = compress/expand 纯 window method + `resolveDefaultWindowMethod`。
- `runtime/object-registry.ts:resolveWindowMethod`：class 自有未命中回退默认表（class 同名优先）。
- `thinkable/context/renderers/xml.ts`：`computeVisibleMethodSet` 合并默认表进菜单（可发现）；新增 `projectByCompressLevel`（读出侧投影：0 全文 / 1 缩略 200 字符 / 2 仅句柄）；`renderWindowNode` 消费 `win.compressLevel`。
- 退役注释回流：`tools/index.ts:19`、`permissions.ts:44/51`。
- storybook：`L2_thinkable.stories.ts` 新增 `L2-COMPRESS-WINDOW-METHOD`（写入回退 + exec 改档 + 读出投影变短，1 pass）。

### 后续项（未做，待立项）
- **scope=events 折叠**：thread builtin 的 events 摘要能力（写入侧）。
- **`context_compressed` event**：runtime 层 compressLevel diff 自动落账（observable 增强）。
- **全窗可发现**：无 decl 的纯展示窗（`computeVisibleMethodSet` line 127 early-return）当前看不到 compress 菜单；投影侧对所有窗已生效。
- **对象树 tests.md 登记**：thinkable `knowledge/tests.md` 补 L2-COMPRESS 判据（`.ooc-world-meta` 独立仓）。
