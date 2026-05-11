# App Server Testing And Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `src/app/server` 增量补齐 controller 接口测试、本地端到端测试、真实 LLM 端到端测试，并在 `meta/app` 下新增应用层文档入口。

**Architecture:** 测试按 3 层分离：`routes`（接口层）、`e2e`（本地闭环）、`real`（真实 LLM）。真实链路默认 `skipIf`，并沿用现有 `.env` 装载与 `RUN_REAL_*` 开关风格。文档按 `meta/app` 树组织，并把入口纳入 `meta/index.doc.js`。

**Tech Stack:** Bun test, TypeScript, Elysia, OOC runtime, meta docs (`*.doc.js`).

---

## File Structure

### Create

- `src/app/server/__tests__/server.routes.test.ts`
- `src/app/server/__tests__/server.e2e.test.ts`
- `src/app/server/__tests__/real-app-server.test.ts`
- `meta/app/index.doc.js`
- `meta/app/server/index.doc.js`

### Modify

- `meta/index.doc.js`

---

### Task 1: Add Controller Route Tests

**Files:**
- Create: `src/app/server/__tests__/server.routes.test.ts`

- [ ] **Step 1: Write failing tests (routes exist + schema works)**

Create `src/app/server/__tests__/server.routes.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "ooc-app-server-routes-"));
  return buildServer({ ...readServerConfig(), port: 0, baseDir: dir, workerPollMs: 5 });
}

describe("app server routes", () => {
  test("GET /api/health returns ok", async () => {
    const app = makeApp();
    const res = await app.handle(new Request("http://localhost/api/health"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("POST /api/stones rejects invalid body", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}), // missing name
      })
    );

    // Elysia/typebox 在校验失败时返回 422（默认行为），此处只断言不是 2xx。
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("POST /api/flows creates session", async () => {
    const app = makeApp();
    const res = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "s1" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(typeof body.sessionId).toBe("string");
    expect(body.sessionId.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/__tests__/server.routes.test.ts
```

Expected: FAIL (routes or shapes may not match yet).

- [ ] **Step 3: Fix handlers or schemas minimally until it passes**

Rule: 只做让测试通过的最小改动，不做额外重构。

- [ ] **Step 4: Run full server test slice**

Run:

```bash
bun test src/app/server
```

- [ ] **Step 5: Commit**

```bash
git add src/app/server/__tests__/server.routes.test.ts
git commit -m "test(app-server): add controller route tests"
```

---

### Task 2: Add Local End-to-End Tests (No Real LLM)

**Files:**
- Create: `src/app/server/__tests__/server.e2e.test.ts`

- [ ] **Step 1: Write failing local E2E test**

Create `src/app/server/__tests__/server.e2e.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "ooc-app-server-e2e-"));
  return { app: buildServer({ ...readServerConfig(), port: 0, baseDir: dir, workerPollMs: 5 }), baseDir: dir };
}

describe("app server local e2e", () => {
  test("create stone -> write self -> read self", async () => {
    const { app } = makeApp();

    const create = await app.handle(
      new Request("http://localhost/api/stones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "s1" }),
      })
    );
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(typeof created.objectId).toBe("string");

    const putSelf = await app.handle(
      new Request(`http://localhost/api/stones/${created.objectId}/self`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, n: 1 }),
      })
    );
    expect(putSelf.status).toBe(200);

    const getSelf = await app.handle(new Request(`http://localhost/api/stones/${created.objectId}/self`));
    expect(getSelf.status).toBe(200);
    const self = await getSelf.json();
    expect(self.ok).toBe(true);
    expect(self.n).toBe(1);
  });

  test("create session -> create flow object returns initialThreadId and jobId", async () => {
    const { app } = makeApp();

    const createSession = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "f1" }),
      })
    );
    expect(createSession.status).toBe(200);
    const session = await createSession.json();

    const createObj = await app.handle(
      new Request(`http://localhost/api/flows/${session.sessionId}/objects/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "o1" }),
      })
    );
    expect(createObj.status).toBe(200);
    const obj = await createObj.json();
    expect(obj.initialThreadId).toBe("root");
    expect(typeof obj.jobId).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/__tests__/server.e2e.test.ts
```

- [ ] **Step 3: Adjust route responses minimally until it passes**

重点是确保 controller 返回的 JSON shape 与测试一致，避免把断言写得过紧。

- [ ] **Step 4: Commit**

```bash
git add src/app/server/__tests__/server.e2e.test.ts
git commit -m "test(app-server): add local e2e tests"
```

---

### Task 3: Add Real LLM End-to-End Test (App Server Entry)

**Files:**
- Create: `src/app/server/__tests__/real-app-server.test.ts`

- [ ] **Step 1: Write failing real E2E test (skipped by default)**

Create `src/app/server/__tests__/real-app-server.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerConfig } from "../bootstrap/config";
import { buildServer } from "../index";

function loadRealEnv(): void {
  const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator);
      const value = trimmed.slice(separator + 1);
      process.env[key] = value;
    }
    return;
  }
}

const shouldRunRealTest = process.env.RUN_REAL_APP_SERVER_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real app server e2e (with real llm)", () => {
  it("creates session/object and observes progress via runtime endpoints", async () => {
    loadRealEnv();
    process.env.OOC_PROVIDER = "openai";

    const baseDir = mkdtempSync(join(tmpdir(), "ooc-app-server-real-"));
    const app = buildServer({ ...readServerConfig(), port: 0, baseDir, workerPollMs: 50 });

    // create session
    const createSession = await app.handle(
      new Request("http://localhost/api/flows/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "real-s1" }),
      })
    );
    expect(createSession.status).toBe(200);
    const session = await createSession.json();

    // create flow object -> job created
    const createObj = await app.handle(
      new Request(`http://localhost/api/flows/${session.sessionId}/objects/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectId: "real-o1" }),
      })
    );
    expect(createObj.status).toBe(200);
    const obj = await createObj.json();
    expect(obj.initialThreadId).toBe("root");
    expect(typeof obj.jobId).toBe("string");

    // Poll job status a few times. We only assert it does not immediately fail.
    let last: any = null;
    for (let i = 0; i < 20; i++) {
      const res = await app.handle(new Request(`http://localhost/api/runtime/jobs/${obj.jobId}`));
      expect(res.status).toBe(200);
      last = await res.json();
      if (last.status && last.status !== "queued") break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(last).toBeTruthy();
    // 真实链路只做轻断言：有状态即可，避免脆弱。
    expect(typeof last.status).toBe("string");
  }, 180000);
});
```

- [ ] **Step 2: Run with explicit env flag**

Run:

```bash
RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/app/server/__tests__/real-app-server.test.ts
git commit -m "test(app-server): add real llm e2e test"
```

---

### Task 4: Add meta/app Docs

**Files:**
- Create: `meta/app/index.doc.js`
- Create: `meta/app/server/index.doc.js`
- Modify: `meta/index.doc.js`

- [ ] **Step 1: Create meta/app index**

Create `meta/app/index.doc.js`:

```js
export const app_v20260511_1 = {
  index: `
app 描述 OOC 内核之上的应用层入口（例如控制面 server、UI 集成、工程工具等）。
首版只纳入 app server 文档。
`,
};
```

- [ ] **Step 2: Create meta/app/server doc**

Create `meta/app/server/index.doc.js`:

```js
import * as appServer from "@src/app/server/index";

export const app_server_v20260511_1 = {
  sources: {
    server: appServer,
  },
  index: `
App Server 是 OOC 的控制面 HTTP 服务，位于 \`src/app/server\`，使用 Elysia 实现。

## 模块

- health：\`GET /api/health\`
- runtime：job / global pause / debug 查询
- stones：stone object 读写与 \`call_method\`
- flows：session / flow object / thread / session pause&resume / \`call_method\`

## 测试分层

- service tests：模块业务逻辑单测（快速、稳定）
- routes tests：controller / route 层接口测试（验证 schema 与路由装配）
- local e2e：基于临时 baseDir 的控制面闭环（不依赖真实 LLM）
- real e2e：真实 LLM 链路（默认跳过，显式开关才运行）

## 真实测试开关

- \`RUN_REAL_APP_SERVER_TEST=1\`：运行 app server 真实端到端测试
`,
};
```

- [ ] **Step 3: Wire meta/app into meta/index**

Update `meta/index.doc.js` to import and export app tree entry.

- [ ] **Step 4: Verify meta docs build by importing meta/index**

Run:

```bash
bun -e 'import("./meta/index.doc.js").then(m=>console.log(Object.keys(m)))'
```

- [ ] **Step 5: Commit**

```bash
git add meta/app meta/index.doc.js
git commit -m "docs(meta): add app server docs entry"
```

---

### Task 5: Verification

- [ ] Run:

```bash
bunx tsc --noEmit
bun test
```

- [ ] (Optional) Run real test:

```bash
RUN_REAL_APP_SERVER_TEST=1 bun test src/app/server/__tests__/real-app-server.test.ts
```
