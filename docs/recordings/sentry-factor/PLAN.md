# 哨兵因子平台 API 录制计划

> 使用 `.agents/skills/browser-cdp-api-automation` 通过 CDP 调试 Chrome 观察手动操作，逆向出哨兵因子平台一组因子生命周期 API，并沉淀为可复用的自动化脚本。

## 目标 API 清单

按因子生命周期顺序录制 6 个接口：

| # | 接口 | 业务语义 | 触发方式（待用户在 CDP 浏览器里手动演示） |
|---|------|---------|------------------------------------------|
| 1 | `create` | 新建一个因子（初始草稿态） | 在列表页点"新建" → 填最小必填字段 → 保存 |
| 2 | `update` | 修改一个已存在的因子 | 在因子详情页改一个字段 → 保存 |
| 3 | `delete` | 删除一个因子 | 在列表/详情页点删除（注意：不可逆操作，dry run 阶段不真删） |
| 4 | `submit` | 把草稿因子提交进入审核/发布流程 | 详情页点"提交" |
| 5 | `start_publish` | 触发因子发布流程（进入发布工作流第 1 步） | 提交后点"开始发布" |
| 6 | `publish_next_step` | 发布工作流推进到下一阶段 | 在发布详情页点"下一步" |

> 实际按钮名 / 流程节点名以平台 UI 为准，录制过程中会回填到本文档"实测节点对照"小节。

## 录制流程（每个接口一遍）

对清单中每个接口，重复以下 5 步。每个接口独立一节，沉淀到 `./<n>-<api-name>.md`。

1. **观察启动**
   - 确认 CDP Chrome 已经在 `http://127.0.0.1:9222` 监听。
   - 通过 CDP 连接到目标 Tab，开启 Network 监听（含 request body / response body）。
   - 告知用户："请执行一次最小化样例操作，我只观察"。

2. **手动样例**
   - 用户在浏览器里手动完成一次该接口对应的最小操作（见上表"触发方式"列）。
   - 期间智能体不点击、不发请求。

3. **抓包筛选**
   - 从 Network 流里挑出"业务关键请求"（区别于埋点、静态资源、健康检查）。
   - 记录：URL、Method、Query、关键请求头（脱敏，不打印完整 Cookie/Authorization）、请求体、响应体结构。

4. **API 分析**
   - 写入 `<n>-<api-name>.md`：
     - 端点定义（URL + Method）
     - 请求 payload 字段含义与来源（哪些来自用户输入、哪些来自前置查询、哪些是固定常量）
     - 响应字段（重点是后续接口要用到的 ID / token / state）
     - 鉴权方式（标注"来源 = CDP 会话 Cookie"，不抄具体值）
     - 前置依赖（例如 `update` 依赖 `create` 返回的 id；`publish_next_step` 依赖 `start_publish` 返回的 publish_id）
     - 幂等性 / 重复触发风险
     - dry run 验证方案（能否只读校验、或用一个隔离测试因子来跑通）

5. **复用脚本草稿**
   - 在 `./scripts/<api-name>.ts` 写一个最小可调用版本（bun runtime + fetch，通过 CDP 拿到当前页面 cookie 或在 page context 里 `fetch`）。
   - 仅"打印将发出的请求"模式 + "真实发送"模式，默认前者。

## 风险与边界

- `delete` 是不可逆操作：录制阶段只观察，不实际再调一次；自动化阶段也必须先 dry run，且默认只对"测试前缀因子名"放行。
- `submit` / `start_publish` / `publish_next_step` 涉及状态机推进：录制前先和用户确认是否会影响线上数据；优先在测试环境或对孤立测试因子操作。
- 录制过程中如出现 MFA / 验证码 / 权限弹窗，立即停止并告知用户。
- 任何阶段都不打印 / 不持久化完整 Cookie、Authorization、refresh token。

## 产物结构

```
docs/recordings/sentry-factor/
├── PLAN.md                       # 本文件
├── 1-create.md                   # 接口 1 的分析（录制后产出）
├── 2-update.md
├── 3-delete.md
├── 4-submit.md
├── 5-start-publish.md
├── 6-publish-next-step.md
├── session-context.md            # 平台环境、登录账号身份、租户、CDP profile 路径（不含凭证）
└── scripts/
    ├── create.ts
    ├── update.ts
    ├── delete.ts
    ├── submit.ts
    ├── start-publish.ts
    └── publish-next-step.ts
```

## 下一步

请你在调试 Chrome 窗口里手动打开哨兵因子平台并完成登录，然后告诉我：

1. 平台首页 URL（让我连上对应 Tab）；
2. 第一个要录的接口（建议从 `create` 开始，因为后续接口都依赖它返回的因子 ID）。

之后我会连接 CDP、进入"只观察"模式，引导你执行第一次最小样例。
