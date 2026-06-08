# 因子开发 Agent 套件 plan：3 个 Agent + 1 个项目级 skill

## Context

参考 `~/x/go/plugins_with_agent/.agents/skills/`（15 个 SKILL.md）+ `meta.md` 的"哨兵平台因子开发助手"。OOC 支持 skills（前一轮 plan）但用户偏好以 OOC Agent（custom window + commands）承载主要业务逻辑；唯一例外是 **psm_query 作为项目级 skill 保留**（branch 级 `stones/<branch>/skills/psm-query/`），与 OOC 已支持的 skill_index 协议自然衔接。

参考材料：
- `~/x/go/plugins_with_agent/meta.md`、`.agents/skills/<15 SKILL.md>`
- `.agents/skills/sentry-api-*/search.js` 与 `query-psm-by-requirement/query.js` — RPC 调用模板（HTTP POST 到 `https://aqomtm80.fn.bytedance.net?typ=DynamicRPC&nowrap=1&psm=...&method=...`，env `USER_INFO` 鉴权）

明确删除：
- `.ooc-world/stones/main/objects/{factor_requirement, factor_workshop, sentry_platform}`
- `meta/case.factor-dev.doc.ts`

## 3 Agent + 1 Skill 拆分

| 类型 | id | 职责 | 来源 |
|------|----|----|------|
| **Agent** | `sentry_factor_dev` | 因子开发流程入口/编排：需求分析 + 技术方案 + 安全评估；维护 `requirement.json` / `requirement_form.json` 状态机；与用户聊天 UI 协议；按因子类型派任务给 event_factor / factor_group | `how_to_handle_factor_dev_requirement` + `sentry-factor-dev-requirement-analysis` + `sentry-factor-dev-requirement-plan-design` + `sentry-factor-dev-security-assessment` + `factor-dev-requirement-form` + `how-to-chat-with-user` |
| **Agent** | `sentry_event_factor` | 事件因子领域 All-in-One：增删改 API + 知识 + 开发 | `sentry-factor-dev-event-factor` + `sentry-api-event-factor-search` + `sentry-api-event-factor-detail` + `sentry-api-event-search` |
| **Agent** | `sentry_factor_group` | 因子组领域 All-in-One：API + 知识 + 开发（go / offline 两种实现） | `sentry-factor-dev-go-factorgroup` + `sentry-factor-dev-offline-factorgroup` + `sentry-api-factor-group-search` + `sentry-api-factor-group-detail` |
| **Skill** | `psm-query` | 项目级（branch 级）skill：根据需求文本检索候选 PSM/method；以 `stones/main/skills/psm-query/{SKILL.md, query.js}` 形态存在 | `query-psm-by-requirement` |

**协作图**：
```
user
  ↓ talk
sentry_factor_dev (流程编排：分析 → 方案 → 派开发)
  ├─ exec(open_file, "stones/main/skills/psm-query/SKILL.md")  ← 用 psm-query skill
  │   ↓ 按 SKILL.md 指引：exec(program shell, "node stones/main/skills/psm-query/query.js '<text>'")
  ├─ talk → sentry_event_factor   (事件因子相关：API 查询 / 开发执行)
  └─ talk → sentry_factor_group   (因子组相关：API 查询 / 开发执行)
  ↓ chat to user
  user
```

**psm-query 作为 skill 而非 Agent 的语义**：
- skill_index window（前一轮已实现）会自动列出 `stones/main/skills/` 下所有 SKILL.md
- 任何 Agent（含 sentry_factor_dev）在自己的 thread 中都能看到 psm-query skill
- 调用方式：`exec(command="open_file", path="stones/main/skills/psm-query/SKILL.md")` 读完整说明，然后 `exec(command="program", args={ language: "shell", code: "node stones/main/skills/psm-query/query.js '<requirement_text>'" })` 跑脚本拿结果
- 不需要 talk，不维护 stone 身份，更轻量

## 每 Agent 目录结构（统一模板）

```
stones/main/objects/<agent_id>/
├── self.md
├── readme.md
├── server/index.ts
├── knowledge/
│   ├── memory/<slug>.md
│   └── relations/<peer>.md
└── data.json
```

## 项目级 skill 目录

```
stones/main/skills/
└── psm-query/
    ├── SKILL.md      # frontmatter description + 使用说明（迁自 query-psm-by-requirement/SKILL.md）
    └── query.js      # 迁自 query-psm-by-requirement/query.js（PsmDataSource + AFS 检索 + RPC 调用）
```

## RPC 接入模板

参考 `.agents/skills/sentry-api-*/search.js`。每个调 RPC 的 Agent 在 server/index.ts 复制 callDynamicRPC helper（约 30 行）：

```ts
async function callDynamicRPC(psm: string, method: string, body: unknown, timeoutMs = 30000): Promise<unknown> {
  const userInfo = process.env.USER_INFO ? `&user_info=${encodeURIComponent(process.env.USER_INFO)}` : "";
  const url = `https://aqomtm80.fn.bytedance.net?typ=DynamicRPC&nowrap=1&psm=${encodeURIComponent(psm)}&method=${encodeURIComponent(method)}${userInfo}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { accept: "*/*", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
```

## 各 Agent 详细设计

### 1. `sentry_factor_dev`（流程编排 + 需求 + 方案）

**身份**：哨兵平台因子开发助手的总编排。需求分析、方案设计、安全评估；按因子类型派开发任务给 sentry_event_factor / sentry_factor_group；通过 psm-query skill 检索接口；维护 `requirement.json` / `requirement_form.json` 状态机。

**custom commands**：
- `start_requirement(text)` / `analyze_requirement()` / `design_plan()` / `assess_security(plan_path?)`
- `dispatch_to_event_factor(plan_path)` / `dispatch_to_factor_group(plan_path)`：内部 talk
- `update_requirement_state(workflow)` / `update_requirement_form(patch)`
- `emit_user_link(type, code)`：UI 标记

**knowledge/**：
- `memory/workflow_protocol.md`（activates_on: ["start_requirement", "update_requirement_state"]）
- `memory/requirement_analysis_protocol.md`（activates_on: ["analyze_requirement"]）
- `memory/plan_template.md`（activates_on: ["design_plan"]）
- `memory/security_checklist.md`（activates_on: ["assess_security"]）
- `memory/chat_ui_markers.md`（activates_on: ["talk", "say"]）
- `memory/psm_query_usage.md`（activates_on: ["analyze_requirement", "design_plan"]）—— 提示 LLM 通过 psm-query skill 检索接口
- `relations/sentry_event_factor.md` / `relations/sentry_factor_group.md`

### 2. `sentry_event_factor`（事件因子 All-in-One）

**custom commands**：
- `search_event_factors(eventId, query?, page?, size?)` / `get_event_factor_detail(code)` / `search_events(query?)`：调 RPC
- `develop_event_factor(plan_path)`：按方案开发事件因子，产出代码

**knowledge/**：
- `memory/event_factor_concepts.md`（事件因子定义、字段、3 种创建方式）
- `memory/event_factor_dev_guide.md`（开发规范主体）
- `memory/event_factor_api.md`（PSM/method/出入参 schema）
- `relations/sentry_factor_dev.md`

### 3. `sentry_factor_group`（因子组 All-in-One）

**custom commands**：
- `search_factor_groups(query?, page?, size?)` / `get_factor_group_detail(code)`
- `develop_factor_group(plan_path, mode: "go" | "offline")`

**knowledge/**：
- `memory/factor_group_concepts.md`（go vs offline 边界）
- `memory/factor_group_dev_go.md` / `memory/factor_group_dev_offline.md`（开发规范）
- `memory/factor_group_api.md`
- `relations/sentry_factor_dev.md`

## 实施步骤

### Phase 0 — 清理旧资源
1. `rm -rf .ooc-world/stones/main/objects/{factor_requirement, factor_workshop, sentry_platform}`
2. `git rm meta/case.factor-dev.doc.ts`

### Phase 1 — psm-query 项目级 skill
3. 新建 `stones/main/skills/psm-query/SKILL.md`：
   - frontmatter: `description: 根据需求文本检索候选 PSM/method 接口...`
   - body: 迁移 `query-psm-by-requirement/SKILL.md` 业务正文（剥离 Claude 特有字段）
   - 使用说明：`node ./query.js "<需求文本>"`
4. 新建 `stones/main/skills/psm-query/query.js`：
   - 完整迁移 `query-psm-by-requirement/query.js`
   - 含 PsmDataSource 数组 + AFS 检索 + 输出格式

### Phase 2 — 3 Agent 骨架（并行）
对每个 Agent 创建：
- `self.md` / `readme.md` — 身份段
- `server/index.ts` — `export const window: ObjectWindowDefinition = { commands: { ... } }`，commands.exec 先 stub
- `knowledge/memory/<slug>.md` — 把对应 SKILL.md 业务正文迁移过来（剥离 Claude 特有字段）
- `knowledge/relations/<peer>.md` — 协作约定

### Phase 3 — RPC 真实接入
5. `sentry_event_factor` / `sentry_factor_group` 的 commands.exec 体填充 callDynamicRPC + 具体 PSM/method（按 `.agents/skills/sentry-api-*/search.js` 准确抄）
6. `.env.example` 补 USER_INFO 注释
7. 错误处理：超时 / HTTP 非 2xx / 鉴权失败 → `{ ok: false, error: "..." }`

### Phase 4 — sentry_factor_dev 流程编排
8. 实现 commands.exec：reasoning + 写文档型主要靠 LLM 在 thread 中按 knowledge 引导
9. `dispatch_to_*` 内部 `exec(command="talk", ...)` + `exec(window_id=<talk>, command="say", ...)`
10. `update_*` 写 flow 级 `output/*.json` + 写 stone 级 `data.json`

### Phase 5 — 文档
11. **新增** `meta/case.factor-dev-agents.doc.ts`：3 Agent + 1 Skill 协作图、原子化分工、psm-query skill 用法、RPC 接入。不复述 SKILL.md（已在 knowledge/）；只描述协作。
12. `bun tsc --noEmit meta/case.factor-dev-agents.doc.ts` 通过

### Phase 6 — 验证
13. `bun run --env-file=.env src/app/server/index.ts --world ./.ooc-world --stones-branch main`
14. talk(target="sentry_factor_dev")
15. 观察链路：sentry_factor_dev → psm-query skill → sentry_event_factor / sentry_factor_group → 回流
16. 单元测试：每 Agent 1+ 条 commands.exec 端到端，fetch mock；skill 不需要专门 OOC 测试（脚本本身可独立测）

## 关键风险

1. **真实 RPC 网络依赖**：bytedance.net 需要内网 + 鉴权；CI 跑不通；单元测试 mock fetch
2. **USER_INFO 鉴权**：env 缺失给清晰错误
3. **PSM/method 准确性**：从 search.js 准确抄
4. **Agent 间循环 talk**：sentry_factor_dev 派给下游后，下游可能反向问问题；要在 self.md / relations.md 写明 wait/end 约定
5. **knowledge 迁移损耗**：剥离 Claude 特有字段（allowed-tools / user-invocable / context: fork）；activates_on 改写为 OOC 协议
6. **skill 与 Agent 的协议差异**：psm-query 通过 skill_index 出现在 LLM 视野；需要 sentry_factor_dev 的 knowledge 中提示"用 psm-query skill"，否则 LLM 可能不主动用

## 决策记录

| # | 问题 | 决策 |
|---|------|------|
| D1 | 拆分粒度 | **3 Agent + 1 Skill**：sentry_factor_dev / sentry_event_factor / sentry_factor_group + 项目级 psm-query skill |
| D2 | sentry_api | **真实 RPC**（每 Agent 复制 callDynamicRPC） |
| D3 | client/index.tsx | **不写** |
| D4 | world | **仅 .ooc-world** |
| D5 | case 文档 | 新增 `meta/case.factor-dev-agents.doc.ts`，删旧 |
| D6 | psm_query | **项目级 skill**（branch 级 stones/main/skills/psm-query/）；不作为 Agent；通过 OOC skill_index 协议被任意 Agent 发现 |
| D7 | knowledge 迁移 | 保留业务正文，剥离 Claude 协议字段；activates_on 改写为 OOC 协议 |

## 验收

- [ ] 旧 stone（factor_requirement / factor_workshop / sentry_platform）已删；旧 `meta/case.factor-dev.doc.ts` 已删
- [ ] 项目级 skill `stones/main/skills/psm-query/{SKILL.md, query.js}` 就位；skill_index 中能看到
- [ ] 3 个 Agent 目录就位 `stones/main/objects/{sentry_factor_dev, sentry_event_factor, sentry_factor_group}/`，每个含 self.md / readme.md / server/index.ts / 至少 1 份 knowledge/memory/*.md + relations
- [ ] `bun tsc --noEmit` 8 errors（baseline，零净增）
- [ ] `bun test src/` 全绿
- [ ] e2e：用户 → sentry_factor_dev 走通需求分析 + psm-query skill 检索 + 派任务给 event_factor / factor_group
- [ ] 真实 RPC 至少 1 个 happy path（用户配 USER_INFO 后能拿到真数据）；单元测试 mock fetch
- [ ] `meta/case.factor-dev-agents.doc.ts` 写好且 tsc 通过

## 关键文件影响面

- 删除：`.ooc-world/stones/main/objects/{factor_requirement, factor_workshop, sentry_platform}` + `meta/case.factor-dev.doc.ts`
- 新增：`stones/main/skills/psm-query/{SKILL.md, query.js}`
- 新增：`stones/main/objects/{sentry_factor_dev, sentry_event_factor, sentry_factor_group}/{self.md, readme.md, server/index.ts, knowledge/memory/*, knowledge/relations/*}`
- 新增：`meta/case.factor-dev-agents.doc.ts`
- 可能：`.env.example` 补 USER_INFO 注释
