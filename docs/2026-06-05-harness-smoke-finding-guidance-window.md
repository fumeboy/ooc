# Harness 冒烟首次发现：guidance window 未注册导致 refine 崩 thread

> 来源：维度体验官 harness 冒烟（executable 维度，2026-06-05）首次真实运行即发现。
> 报告目录 `docs/harness-reports/` gitignored，故把这条高价值发现 curate 进 docs/ 持久化。
> 状态：**已确认根因，待修**（体验官报告不修，回流 AgentOfExecutable/AgentOfThinkable）。

## 摘要
体验官（一个 `claude -p` 进程）驱动真实 OOC server 让被测 agent 做文件编辑，发现一个
**确定性、高严重度的潜在 bug**：只要 think loop 用到 `exec(form_id,"refine",args)`，下一轮
render context 就抛 `getObjectDefinition: object type "guidance" not registered` →
statusReason=`think_error` → **thread 被标 failed，即便此前所有动作已成功并产生正确副作用**
（文件已落盘、say 已投递）。

可靠性因此**非确定**：同一能力，LLM 这轮一次性给全 args（`end {summary}`）则 done；
分轮 refine 填 args 则 failed。bun:test S1-S6 用策划好的一次性 args 场景**恰好绕开** refine
路径，故未暴露——**这正是 harness（真 LLM + 自主）相对策划测试的价值**。

## 根因
- `buildGuidanceWindows`（`builtins/_shared/executable/guidance.ts:54`）产出 `type:"guidance"` window。
- `manager.ts:335` fireStatusChanged 把 guidance window **push 进 `thread.contextWindows`**（持久化）。
- xml 渲染器多处**无 guard** 调 `getObjectDefinition(window.type)`：`renderers/xml.ts:78`
  (renderMethodsNode)、`:219`（主渲染）、`:312`。
- 但 registry `BASE_TYPE_DEFINITIONS`（`runtime/object-registry.ts`）**不含 "guidance"**
  → getObjectDefinition 抛错。
- 矛盾：渲染器**设计上认 guidance**（`xml.ts:113` BUILTIN_TYPES 含 guidance；
  `resolveReadableForType` 在 try 内处理 guidance）+ `window-enrichment.ts:63` 也特殊消费
  guidance（`if type!=="guidance" continue`）——唯独 registry 没把它登记为已知 type。
- git 证实 "guidance" 从未进过 BASE_TYPE_DEFINITIONS（非回归，是一直潜伏的缺登记）。

## 证据（体验官原始取证）
```
CALL exec {write_file, {path:"hello.txt", content:"UTC only\n"}}  → executed:true（文件真落盘，xxd 验字节 5554 4320 6f6e 6c79 0a）
CALL exec {say, ...}                                              → executed:true（已投递 user inbox）
CALL exec {end}                                                  → executed:false（提示用 refine/submit 推进）
CALL exec {form_id, refine, {summary:...}}                       → window_id:"guidance_..._internal_executable_end_basic"
INJECT "getObjectDefinition: object type \"guidance\" not registered"  → think_error → status=failed
# 对照：S2 用 end{summary} 一次性 → 无 refine → status=done
```
3 条独立 thread（S1/S1b/S3）全部精确崩在 refine 那一步；唯一 done 的 S2 无 refine。

## 两条修复路径（供 AgentOfX 拍板）
**A. 注册 guidance 为 base type（根治，推荐）**
- `BASE_TYPE_DEFINITIONS` 加 `["guidance", { type:"guidance", methods:{} }]`。
- 一次让所有 getObjectDefinition 调用点（xml 78/219/312、permissions、self.ts）容忍 guidance：
  renderMethodsNode 空 methods → 不产 methods 节点；主渲染走 guidance 的既有特殊 readable 路径。
- **须配套**：`assertAllObjectDefinitionsRegistered` 把 guidance 排除（同 "relation"，因 guidance
  无 renderXml/readable），否则 assertAll 会报 guidance 缺 hook。
- **须验**：guidance 的 hint 内容仍正确渲染给 LLM（注册后走通用 content 路径）。

**B. guard 各 getObjectDefinition 调用点（surgical）**
- xml.ts 78/219/312 前置 `if (!registry.has(window.type)) ...` 兜底。
- 风险：若 guard 成「跳过渲染」会**抑制 guidance 显示**（LLM 看不到 guidance 提示，弱化引导）——
  需确保 guidance 仍经其特殊路径渲染，而非被 guard 掉。

→ 倾向 **A**：guidance 本就是渲染器/enrichment 都认的已知 type，缺登记是 root；注册 + assertAll
排除 + 验渲染，比逐点 guard 更彻底且不丢 guidance 显示。需配回归测试：一个含 guidance window
的 thread 渲染不抛 + guidance 内容可见 + refine 流程 thread 不再 failed。

## 附带发现（次要）
- **[med] write_file 逃逸 stone 自治区**：裸文件名落 world 根（不进 stone git）；`stones/assistant/...`
  被映射成 `packages/assistant/...` 后拒绝。playbook/cheatsheet 宣称「编辑落自身 stone 自治区」与
  实测不符（cwd 既非 stone dir 亦非 thread dir）→ agent 困惑 + 越界写风险。回流 AgentOfExecutable/Persistable。
- **[good] 保留项**：write_file 整体覆盖时 inject「下次改走 file_window.edit 局部修改」hint——意图与手段对齐，好行为。
