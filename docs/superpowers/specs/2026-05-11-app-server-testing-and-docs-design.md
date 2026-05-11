# App Server Testing And Docs Design

**Date:** 2026-05-11

**Scope:** 为 `src/app/server` 补齐控制面接口测试、本地端到端测试、真实 LLM 端到端测试，并在 `meta/app/` 下新增应用层文档，说明 app server 的职责、测试分层与运行方式。

---

## 目标

当前 `src/app/server` 已具备：

- `health` / `runtime` / `stones` / `flows` 控制面 API
- `pause/resume`
- `ui_methods` 的 HTTP `call_method`
- `jobManager` / `pauseStore` / `resume` 等最小运行时能力

但测试与文档仍明显不足：

- 只有 `service` 层测试，缺少 controller / route 层断言
- 只有 `GET /api/health` 的最小 smoke test，缺少跨模块 API 闭环验证
- 缺少一条以 app server 为入口的真实 LLM 端到端测试
- `meta/` 下尚无 `app/` 文档入口，无法从元文档角度解释应用层职责

本次增量目标是补齐“可验证性”和“可解释性”，不改变既有 API 语义。

---

## 测试分层

### 1. 接口测试

接口测试直接对 `buildServer(...).handle(new Request(...))` 发请求，验证：

- 路由存在
- request schema 生效
- response shape 符合预期
- 与 service 的装配关系正确

这层不依赖真实网络，也不要求真实 LLM 可用。

### 2. 本地端到端测试

本地端到端测试使用临时目录作为 `baseDir`，通过真实 HTTP handler 串起：

- 创建 stone / flow session / flow object
- 读写 `self` / `readme` / `data`
- 查询 thread / job / pause status
- 调用 `call_method`

这层要求走完整控制面闭环，但仍不访问外部 LLM，重点验证 app server 与 OOC 文件系统模型的集成。

### 3. 真实 LLM 端到端测试

真实端到端测试以 app server 为唯一入口，默认通过环境变量开关显式启用：

- 复用现有 `real-openai` / `real-thinkloop` 的 `.env` 装载模式
- 创建 flow session 与 flow object
- 轮询 runtime / thread 状态
- 断言真实模型至少推动一次调度并生成可观察结果

这层只保留 1 条最关键链路，避免把不稳定性扩散到所有测试。

---

## 文档设计

新增 `meta/app/` 作为“应用层能力”文档树，首版只覆盖 app server：

```text
meta/
└── app/
    ├── index.doc.js
    └── server/
        └── index.doc.js
```

文档职责：

- `meta/app/index.doc.js`
  - 说明 `app` 是内核之上的应用层入口
  - 暴露 `app_tree`
- `meta/app/server/index.doc.js`
  - 说明 `src/app/server` 的模块结构与职责边界
  - 说明测试分层：service / controller / local e2e / real e2e
  - 说明真实测试开关与运行方式

同时更新 `meta/index.doc.js`，把 `app` 入口纳入顶层 `meta_v*` 导出。

---

## 文件与命名

推荐新增下列测试文件：

- `src/app/server/__tests__/server.routes.test.ts`
- `src/app/server/__tests__/server.e2e.test.ts`
- `src/app/server/__tests__/real-app-server.test.ts`

命名约束：

- `*.routes.test.ts`：controller / route 层接口测试
- `*.e2e.test.ts`：本地端到端测试
- `real-*.test.ts`：真实环境测试，必须 `describe.skipIf(...)`

---

## 成功标准

完成后应满足：

1. `bunx tsc --noEmit` 通过
2. `bun test src/app/server` 通过
3. 默认测试不触发真实 LLM
4. 设定真实测试开关后，可运行 app server 入口的真实集成测试
5. `meta/index.doc.js` 可导出 `app` 入口，且 `meta/app/server/index.doc.js` 能准确描述当前实现
