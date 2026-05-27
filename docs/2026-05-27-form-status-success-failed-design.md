# Form 状态机升级 — `executed` → `success` / `failed` + failed 可 refine 回 open

**作者**：Supervisor（Claude Code 主会话）
**日期**：2026-05-27
**性质**：design + 实施 plan
**触发**：Round 12 修了"LLM 倾向 close 重开"行为偏差；但**根本痛点是 executed 状态混合了 success 与 failure，且 executed 不可 refine**——只能 close 重开。本轮升级状态机让 failed 可 refine 回 open + 重 submit。

---

## 1. 现状与痛点

### 当前状态机
```
open → executing → executed
                       ↓ (成功) 自动从 contextWindows 移除
                       ↓ (失败) 保留 + result 含错误 + 等 LLM 显式 close
```

**痛点**：
1. `executed` 是 success / failure 共用状态，LLM 看 status 不知道结果如何
2. **executed 不可 refine** — manager.refine 只允许 status="open"；submit 失败后只能 close 重开
3. close 重开会丢失：form 上已激活的 knowledge / 已派生的 commandPaths / form id 关联（thread.events 中 tool_call_id 不连续）

### 新状态机（本轮升级）
```
open → executing → success → (自动从 contextWindows 移除)
                ↘  failed  → (保留, result 含错误)
                                ↓ refine(args)
                                ↓ → 回到 open (status="open", 累积 args, 清 result)
                                ↓
                              submit(form_id)
```

**改进**：
- success / failed 显式分离，LLM 看 status 直接知道结果
- **failed 可 refine 回 open**：保留 form id + 已累积 args，仅补漏 / 改字段后重 submit
- 不丢失 form 上下文（knowledge / commandPaths 同步重算）
- close 重开仍可用，但**不再是失败修复的唯一路径**

---

## 2. 详细设计

### 2.1 类型变更

`src/executable/windows/command_exec/types.ts`:
```ts
// 前
status: "open" | "executing" | "executed";

// 后
status: "open" | "executing" | "success" | "failed";
```

`src/executable/windows/_shared/types.ts`:
```ts
// 前
export type WindowStatus = "open" | "executing" | "executed" | "running" | "archived" | "done" | "active" | "closed";

// 后
export type WindowStatus = "open" | "executing" | "success" | "failed" | "running" | "archived" | "done" | "active" | "closed";
```

⚠️ 删除 "executed" 字面值（不保留兼容字段；OOC 一向是"显式废弃 + 历史数据过滤"原则）。

### 2.2 manager.refine 改造

```ts
// 前: 仅 status="open" 可 refine
if (form.status !== "open") return false;

// 后: status="open" 或 status="failed" 可 refine
//   - open: 累积 args, 状态保持 open
//   - failed: 累积 args + 清 result + 状态切回 open（"复活"路径）
if (form.status !== "open" && form.status !== "failed") return false;
// ...
const next: CommandExecWindow = {
  ...form,
  status: "open",  // failed → open 显式重置
  result: undefined,  // 清旧 result
  accumulatedArgs: nextArgs,
  commandPaths: nextPaths,
};
```

### 2.3 manager.submit 改造

```ts
// 前: 成功后自动移除; 失败后 status="executed" + result
// 后:
// - submit 入口仍要求 status="open"
// - 成功: status="success" → 在同一 tick 内自动从 contextWindows 移除（与现状成功路径一致）
// - 失败: status="failed" + result 含错误
```

具体改动点：
- L294 `executing: status="executing"` — 不变
- L337 `failed: status="executed"` → `status="failed"`
- L375 `setResultExecuted` helper → 重命名为 `setResultFailed`，写 `status="failed"`
- 成功路径（自动移除）不变

### 2.4 manager submit 入口校验

```ts
// L282
if (form.status !== "open") {
  throw new Error(`submit: form "${formId}" status is ${form.status}, expected "open"`);
}
```
不变。但 LLM 视角下："failed 上调 submit" 会撞这个错；正确流程是 refine 先回 open 再 submit。

### 2.5 历史 thread.json 兼容

历史数据可能含 `status: "executed"`。处理策略（与 Round 7 issue 移除 + readThread 过滤同款思路）：

**选项 A — readThread 反序列化时把 "executed" 改为 "failed"**（保守；让 LLM 能 refine 修复）：
```ts
// src/persistable/thread-json.ts:readThread
// 在 filter unregistered type 之后, 把 command_exec.status === "executed" 转 "failed"
contextWindows.map(w => {
  if (w.type === "command_exec" && (w as any).status === "executed") {
    return { ...w, status: "failed" };
  }
  return w;
});
```

**选项 B — 直接报错 / 过滤掉**：不友好。

**推荐 A**：把 executed 视为"未明确 success/failed 的历史失败"。

### 2.6 knowledge() 函数签名同步

`CommandTableEntry.knowledge: (args, formStatus: CommandExecWindow["status"]) => CommandKnowledgeEntries`：

- 类型自动跟随 CommandExecWindow.status 联合
- 各 command 内部 `if (formStatus !== "open") return entries;` 不需要改（仍只在 open 状态加预检查）
- **但**：command.program.ts L96 有专门处理 `formStatus === "executing"`，需要 review 是否要加 success/failed 分支

### 2.7 已有 exec error message 调整

Round 12 已统一为 "不要 close 重 open——form 当前在 open 状态, refine 是正确路径"。**这次升级要相应改**：

- 失败时 (exec 返回 string / outcome.ok=false) → form 进 failed → **现在可以 refine 修复**了
- exec error message 改为：
  ```
  "[talk] 缺少 target 参数。form 现在 status=failed; 用 refine(form_id, args={ target: ... }) 补齐后 submit;
   或 close(form_id) 重开（推荐 refine, 保留 form 上下文）。"
  ```

### 2.8 basic-knowledge form lifecycle 重写

Round 12 已写"三态机 + open 用 refine"。**这次改为四态机**：

```
form 状态机 (open → executing → success | failed):

- **open**: 参数未提交。可 refine 累积 args, submit 触发执行
- **executing**: exec 函数运行中。短暂状态; LLM 不应在此态做动作
- **success**: 执行成功; **自动从 contextWindows 移除**, 你下一轮看不到这个 form
- **failed**: 执行失败; result 含错误信息; **可以 refine 修回 open 状态再 submit**
  (refine 时累积新 args + 清旧 result + 切回 open)

修复参数错误的标准路径:
- open 状态参数缺/错 → refine 补齐 → submit
- submit 失败 (form 进 failed) → refine 修正 → 自动切回 open → 重 submit
- close + 重 open 也可以但**不再推荐**: refine failed 比 close 保留更多上下文
```

### 2.9 web 端渲染

`web/src/domains/files/components/ContextSnapshotViewer.tsx` 或 form 相关渲染处可能含 `status === "executed"` 判断。需要 grep web/ 修改。

视觉编码建议：
- open: 蓝色 / 默认
- executing: 黄色 + spinner
- success: 绿色 ✓（短暂可见，因为很快被移除）
- failed: 红色 ✗ + 显示 result

### 2.10 测试更新

全仓 grep `"executed"` / `status: "executed"`，找到所有 test 期望，按新状态更新：
- 成功测试改为期望 `status: "success"` + 移除
- 失败测试改为期望 `status: "failed"` + result

预估涉及 10-20 个测试文件。

---

## 3. 实施 phase

| Phase | 范围 | 派单 |
|---|---|---|
| **G1** | meta + design doc (本文档) | Supervisor 直写 |
| **G2** | 完整实施（types + manager + 11 command + basic-knowledge + readThread 迁移 + web 渲染 + tests）| 1 sub agent 一气完成 |
| **G3** | 验证 + Supervisor commit | Supervisor |

⚠️ **派单关键约束**：根据 memory `feedback_subagent_no_self_commit`，明确要求 sub agent **不要自己 commit**；改动留 working tree。

---

## 4. 不变量

| 不变量 | 说明 |
|---|---|
| status 联合显式 | 不留 "executed" 兼容字段；历史数据在 readThread 迁移 |
| refine 仅 open / failed | manager 强制；其它状态 refine 返回 false |
| submit 仅 open | manager 强制；failed 上 submit 抛错（提示先 refine）|
| success 自动移除 | 不变 |
| failed 保留 | 含 result + 可 refine 修复 |
| close 仍可用 | 但 knowledge 文本不推荐为修复首选 |

---

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 历史 thread.json 含 executed | readThread 迁移路径，"executed" → "failed" |
| 大量 test 期望需要更新 | sub agent 一并改；全仓 grep "executed" |
| LLM 仍误用 close（习惯）| knowledge 文本明确推荐 refine; Round 11/12 已强化 |
| web 端 form viewer 漏改 | grep web/ 找所有 status 比较 |
| 派单 sub agent 自主 commit（Round 12 教训）| prompt 明确 "不要自己 commit" |

---

## 6. 验收

1. 全仓 tsc clean
2. 全仓 src/ 单测 PASS（不含 "executed" 期望残留）
3. backend e2e PASS
4. 真启 backend 创建 thread + 跑一个 form:
   - submit 失败 → form status="failed"，result 含错
   - refine 补齐 → form 回 open
   - 再 submit → success → 自动移除
5. web 端 ContextSnapshotViewer 渲染 form 时按 success/failed 着色

---

## 历史

- **2026-05-27**: 首版。Round 13 design。
