# OOC World / Core 接口、目录结构与热更新设计

> 文档位置：`packages/@ooc/meta/world-core-interface-and-hot-reload.md`
> 关联：`ooc-object-oriented-philosophy.md`（设计哲学）、`object.doc.ts`（概念权威）
> 产出时间：2026-06-02

---

## 0. 背景与动机

当前 OOC 源码仓采用 monorepo 结构：`packages/@ooc/{core,builtins,web,meta,tests}`。
选择 monorepo 的根本原因是 OOC Object 可以为自己编写程序（`executable/`）和 React UI
组件（`visible/`），并可能拥有独立的 npm 依赖——这些天然适合用 node package 封装。

下一步 OOC Core 将发布到 npm registry，而 OOC World（用户目录）保留在本地。这就要求
明确回答两个问题：

1. **World 与 Core 的关系与接口**：一个本地 World 目录长什么样？它和 npm 上的 Core
   之间通过什么契约协作？
2. **Object 热更新**：一个正在运行的 Object，当它的 stone 五件套被修改时，服务端方法、
   前端 UI、身份定义分别如何安全地热替换？

此外，`packages/` 这个名字（来自通用 monorepo 惯例）与 OOC 自己的
**stone / pool / flow** 三层持久化哲学存在命名 gap——本设计将 World 内的 stone
包目录统一命名为 `stones/`，减少心智负担。

---

## 1. 核心类比：Core 是 JVM，World 是项目目录

| 概念 | OOC 对应物 | 说明 |
|------|-----------|------|
| JVM / Node.js runtime | `@ooc/core` | 运行时内核，提供类型、调度、HTTP 控制面 |
| JDK 标准库 | `@ooc/builtins/*` | 随 Core 发布的内置 Object 定义（supervisor、user、file…） |
| 一个 Node 项目目录 | OOC World | 用户工作目录，内含自己的 Agent 定义、运行时数据、依赖 |
| 项目的 `src/` 或 workspace 子包 | World 内的 `stones/<id>/` | 用户态 Object 定义（五件套），结构与 builtin 同构 |
| 项目的 `node_modules/` | World 内的 `node_modules/` | 存放 `@ooc/*` 包和第三方依赖 |

Builtin 包和 Stone 包在结构上**完全同构**（都有 self.md / readable / executable /
visible / knowledge，都有带 `ooc.objectId` 的 package.json），区别仅在于：

- **所有权**：Builtin 归 OOC 运行时维护，随 `@ooc/builtins/*` 版本演进；Stone 归
  用户 / Agent 维护，通过元编程版本化。
- **发现方式**：Builtin 通过 `node_modules/@ooc/builtins/<id>/` 发现；Stone 通过
  World 内 `stones/<id>/` 发现。
- **Pool / Flow**：Builtin Object 和 Stone Object 一样有自己的 Pool 和 Flow——
  "定义是 builtin，状态是 world"。

---

## 2. OOC World 目录结构

一个最小 World 本身就是一个标准的 **Bun workspace monorepo**：

```
my-ooc-world/                    ← 用户工作目录，一个 World = 一个 Bun 项目
├── package.json                 ← 声明对 @ooc/* 的依赖，提供 dev/start/build scripts
├── bun.lock                     ← 锁定依赖版本（不同 World 可跑不同版本 Core）
├── tsconfig.json                ← extends "@ooc/tsconfig/stone.json"
├── .world.json                  ← OOC 运行时配置（端口、worker、LLM 默认值…）
├── .env                         ← 密钥（API keys），不进 git
├── .gitignore
│
├── stones/                      ← Stone 层：用户 Object 定义（进 git）
│   ├── agent_of_product/        ← 一个 Stone Object = 一个本地 workspace 包
│   │   ├── package.json         ← name: "@my-world/agent_of_product", ooc.objectId
│   │   ├── self.md
│   │   ├── readable.md          # 或 readable.ts（动态渲染）
│   │   ├── executable/
│   │   │   └── index.ts         # 方法表导出
│   │   ├── visible/
│   │   │   └── index.tsx        # React 组件导出
│   │   └── knowledge/
│   │       └── intro.md
│   └── sentry_factor_group/     ← 另一个 Agent，可有独立 npm 依赖
│       ├── package.json         ← 可声明 dependencies: { "csv-parse": "^5" }
│       └── ...
│
├── node_modules/
│   ├── @ooc/                    ← 来自 npm 的 OOC Core 套件
│   │   ├── core/                ← 运行时内核
│   │   ├── web/                 ← 前端 SPA（dev 模式提供 Vite 工厂，prod 提供 bundle）
│   │   ├── cli/                 ← ooc init/dev/build/start 命令
│   │   ├── tsconfig/            ← stone 项目用的 tsconfig base
│   │   ├── meta/                ← 可选：概念文档
│   │   └── builtins/            ← 一组独立包：@ooc/builtins/supervisor、file、plan…
│   └── @my-world/               ← workspace 软链，指向 stones/*
│
├── pools/                       ← Pool 层：跨 session 沉淀（不进 git）
│   └── <objectId>/
│       ├── data/ · knowledge/ · files/
│
└── flows/                       ← Flow 层：运行时实例（不进 git）
    └── <sessionId>/
        └── <objectId>/
            ├── state.json
            └── threads/
```

### 2.1 World 根 `package.json` 约定

```jsonc
{
  "name": "my-ooc-world",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["stones/*"],
  "scripts": {
    "dev": "ooc dev",
    "start": "ooc start",
    "build": "ooc build"
  },
  "dependencies": {
    "@ooc/core": "^0.1.0",
    "@ooc/web": "^0.1.0",
    "@ooc/builtins/supervisor": "^0.1.0",
    "@ooc/builtins/file": "^0.1.0",
    "@ooc/builtins/plan": "^0.1.0",
    "@ooc/builtins/todo": "^0.1.0"
    // 用户按需声明 builtin 依赖，不需要全部引入
  },
  "devDependencies": {
    "@ooc/cli": "^0.1.0",
    "typescript": "^5.9.0"
  }
}
```

### 2.2 Stone 包 `package.json` 约定

```jsonc
// stones/agent_of_product/package.json
{
  "name": "@my-world/agent_of_product",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "peerDependencies": {
    "@ooc/core": "^0.1.0"   // peerDep，强制与 World 根版本一致
  },
  "dependencies": {
    "some-third-party-lib": "^2.0.0"
  },
  "ooc": {
    "objectId": "agent_of_product",
    "kind": "stone",
    "type": "agent",
    "prototype": "supervisor",
    "mixins": ["file_ops"],
    "register": "executable/index.ts"   // 可选，不写则按约定路径查找
  }
}
```

### 2.3 `.world.json` 约定

运行时配置（不含密钥），可被环境变量覆盖：

```jsonc
{
  "port": 3000,
  "worker": {
    "enabled": true,
    "pollMs": 100,
    "maxTicks": 15
  },
  "llm": {
    "defaultProvider": "anthropic",
    "defaultModel": "claude-sonnet-4-6"
  },
  "hotReload": {
    "enabled": true,
    "watchPaths": [
      "stones/*/executable/**",
      "stones/*/visible/**",
      "stones/*/knowledge/**"
    ]
  },
  "stones": {
    "autoDiscover": true
  }
}
```

---

## 3. Core 与 World 的接口契约

Core 暴露给 Stone 的 API 面（从 `@ooc/core` 导出）：

```typescript
// 运行时工厂
export function createWorldRuntime(opts: {
  worldPath: string;
  config?: Partial<WorldConfig>;
}): Promise<WorldRuntime>;

export interface WorldRuntime {
  httpHandler: (req: Request) => Promise<Response>;  // Elysia app.handle
  stoneRegistry: StoneRegistry;                       // 可订阅 stone:changed
  startWorker(): void;
  stopWorker(): Promise<void>;
  dispose(): Promise<void>;
}

// Stone 开发 API（由 stones/<id>/executable/index.ts 使用）
export type {
  OOCObject,           // 运行时实例对象
  StoneDefinition,     // stone 五件套的类型
  Method,              // 方法定义（含 public / for_ui_access 可见性）
  MethodContext,       // method 被调用时拿到的 ctx
  ReadableContext,     // readable.ts 被调用时拿到的 ctx
  VisibleProps,        // visible/index.tsx 组件 props 基类
  KnowledgeTrigger,
};

export interface StoneRegistry {
  on(event: "stone:changed", handler: (ev: StoneChangedEvent) => void): () => void;
  getDef(objectId: string): StoneDefinition | undefined;
  invalidate(objectId: string, changedFiles: string[]): Promise<void>;
}
```

反向契约（Stone 对 Core 的约束）：

- Stone 根必须有 `package.json`，含 `ooc.objectId` 和 `ooc.kind: "stone"`。
- Stone 根必须有 `self.md`；`readable` / `executable` / `visible` / `knowledge` 至少出现一个。
- `executable/index.ts` 默认导出方法表 `Record<string, Method>`。
- `visible/index.tsx` 默认导出 React 组件。
- Stone 之间**只能通过 runtime method 调用协作**，禁止直接 import 另一个 stone 的源码
  （绕过权限模型、破坏热更新、阻碍独立打包）。

---

## 4. npm 包拆分

当前 `packages/@ooc/` 下的源码发布时拆成以下 npm 包：

| npm 包 | 来源 | 暴露内容 | 依赖方 |
|--------|------|---------|--------|
| `@ooc/core` | packages/@ooc/core | `createWorldRuntime`、所有 runtime 类型 | World 根 + 每个 Stone + @ooc/web + @ooc/cli |
| `@ooc/web` | packages/@ooc/web | dev 模式：`createViteConfig(worldRuntime)` 工厂<br>prod：预构建 SPA bundle | World 根（devDep） |
| `@ooc/cli` | 新建 packages/@ooc/cli | `ooc init/dev/build/start` 命令 | World 根（devDep） |
| `@ooc/tsconfig` | 新建 | `tsconfig.stone.json` base | 每个 Stone（devDep） |
| `@ooc/builtins/<id>` | packages/@ooc/builtins/<id> | 每个 builtin 独立发布，结构同 Stone | World 根按需声明 |
| `@ooc/meta` | packages/@ooc/meta | 概念文档（纯 doc，运行时不加载） | 可选 |

Builtin 拆成独立包的理由：用户选择权、独立 semver、与 Stone 同构加载。

---

## 5. World 启动方案：`@ooc/cli` 作为唯一入口

用户与 Core 的唯一交互入口是 `ooc` 命令。

### 5.1 四条命令

| 命令 | 场景 | 行为 |
|------|------|------|
| `ooc init [path]` | 创建新 World | 脚手架：生成目录骨架、写入模板文件、执行 `bun add @ooc/*`、生成 `.env.example` |
| `ooc dev` | 开发模式 | 同时启动后端（bun 运行时 + fs watch 热重载）和前端（Vite dev server + HMR），统一端口 |
| `ooc build` | 预构建 | 将所有 stones 的 executable 编译为 JS + d.ts，visible 打为独立组件 bundle，输出到 `.ooc-dist/` |
| `ooc start` | 生产模式 | 用 `@ooc/web/dist` 的前端 bundle + `.ooc-dist/` 的预构建 stones，启动后端，关闭 HMR |

### 5.2 `ooc dev` 启动流程

```
ooc dev
│
├─ 1. 读取 World 根 package.json / .world.json / .env
│     - 解析 workspace 下的 stones/*
│     - 扫出所有带 ooc.objectId 的本地 stone
│     - 扫出 node_modules/@ooc/builtins/* 下所有 builtin
│
├─ 2. createWorldRuntime({ worldPath, config, dev: true })
│     - 返回 WorldRuntime 实例（非 module-level singleton）
│
├─ 3. Vite dev server（前后端同端口，Vite 代理 /api/* 给后端）
│     - server.fs.allow 包含 stones/*/visible/ 和 @ooc/builtins/*/visible/
│     - 虚拟模块插件：/@ooc/stones → stone visible 入口映射
│     - resolve.alias: "@stone/*" → "<world>/stones/*"
│
├─ 4. fs watch（后端热更新）
│     - 监听 stones/*/{executable,readable.ts,self.md,knowledge}/**
│     - 事件 → stoneRegistry.invalidate(id, files)
│       → 按三档策略分发（见 §6）
│
└─ 5. 输出 http://localhost:<port>
```

统一端口的理由：无 CORS、dev/prod 行为一致、用户心智简单。

### 5.3 `ooc start` 启动流程

```
ooc start
│
├─ 1. 校验 .ooc-dist/ 存在，否则提示先 ooc build
├─ 2. createWorldRuntime({ dev: false })
│     - 从 .ooc-dist/ 加载预编译 stones，不做 fs watch
│     - 从 @ooc/builtins/*/dist 加载 builtins
├─ 3. Elysia 直接 serve
│     - /api/* → runtime httpHandler
│     - /      → serveStatic(@ooc/web/dist)
│     - /stones/<id>/* → serveStatic(.ooc-dist/<id>/visible)
└─ 4. 监听配置端口
```

---

## 6. 热更新设计：按修改内容分三档

热更新的本质问题是：运行中的 Object 实例，当它的 stone 定义变化时，哪些可以安全替换、
哪些必须重建、哪些只能下个 session 生效。

统一事件入口：`StoneRegistry` 的 `stone:changed` 事件：

```typescript
type StoneChangedEvent =
  | { kind: "code";      objectId: string; files: string[] }     // executable / readable.ts
  | { kind: "view";      objectId: string; files: string[] }     // visible/**
  | { kind: "knowledge"; objectId: string; files: string[] }     // knowledge/** / readable.md
  | { kind: "identity";  objectId: string; field: string }        // self.md 关键字段 / prototype
  | { kind: "schema";    objectId: string; diff: StateDiff };    // 可能影响 state.json 结构
```

### 6.1 第一档：纯函数 / 视图 / 只读数据（即时热替换）

适用：`executable/**/*.ts`、`visible/**/*.tsx`、`readable.(md|ts)`、`knowledge/**/*.md`。

这些是纯函数或只读数据，不持有实例状态。

**服务端（executable / readable）**：
- Core 维护 `Map<objectId, ModuleRef>`。
- 文件变更 → `bun reimport()` 返回新 module 引用。
- 新 method 调用走新 module；在途 method 调用继续用旧 module（直到 await 结束），
  通过 `AbortController` 暴露给 method ctx，允许强制中止旧版本。
- readable.md / knowledge 走文件缓存失效，不需要 reimport。

**前端（visible）**：
- Vite HMR 原生支持。改组件文件 → 浏览器只刷新该组件，不丢 React state。

**一致性**：单轮 thinkloop 内部 pin 一个 stone 版本快照，避免同一轮里 readable 和
executable 看到不同版本。

### 6.2 第二档：结构变更（打标记 + 懒迁移）

适用：`self.md` 的 type/prototype/mixins 变更、method 增删或可见性升级、state.json
schema 变化。

流程：
1. 检测到变更，不立即替换。
2. 对当前所有该 objectId 的 Flow Object 实例在 `state.json._meta` 打
   `stone_version_mismatch` 标记。
3. 实例下一次被 thread 引用时触发迁移钩子：如果 stone 提供
   `executable/migrate.ts`，调用它把旧 state 迁到新 schema；迁移失败则进入"人工审查"
   状态，UI 展示 diff。
4. Prototype 链变化 → 重算所有受影响 objectId 的 vtable（方法表），之后新调用走新表。

哲学：**"先标记，再懒迁移"**。不在文件保存时做全局扫描和同步迁移——迁移发生在实例
下一次被访问时。

### 6.3 第三档：Core 自身变更（重启）

适用：`@ooc/core`、`@ooc/web`、`@ooc/builtins/*` 的版本升级。

JVM 本身的升级不在热更新范围内。World 的 `package.json` 用 semver pin 版本；
升级后 `bun install && ooc dev` 重启。
`OOC_DEV=true`（dogfooding 仓）时可允许 builtin 也走第二档机制。

---

## 7. 三个架构陷阱

### 7.1 禁止 Stone 之间直接 import

A stone 直接 `import "@stone/b/executable/helper"` 会绕过权限、破坏热更新、阻碍独立
打包。强制 Stone 之间只能通过 `exec(objectId, method, args)` 协作。实现上 bun import
自定义 resolver 拦截跨 stone import 并抛 `StoneCrossImportError`。

### 7.2 Stone 的 `@ooc/core` 用 peerDependencies

避免 stone 声明不同版本的 `@ooc/core` 导致 bun workspace 解析出多个副本、类型不兼容。
`ooc dev` 启动时做版本校验，不匹配直接报错。

### 7.3 前端 bundle 不得泄露 executable 代码

Vite 的 `server.fs.allow` 只包含 `visible/` 目录；`executable/` 路径一律解析失败。
`self.md` 和 `knowledge/` 按需白名单放行。

---

## 8. 当前源码仓的迁移布局

当前 ooc-2 仓同时承担 **Core 源码仓** 和 **dogfooding World** 两个角色，发布 npm 后
应厘清：

```
ooc-2/
├── packages/
│   └── @ooc/{core,web,cli,tsconfig,builtins/*,meta,tests}   ← 发布 npm 的来源
│
├── .ooc-world/                 ← dogfooding World（我们自己用）
│   ├── stones/                 ← 我们自己的 stone agents
│   ├── pools/ flows/
│   └── package.json            ← 用 workspace:* 链接到本地 packages/@ooc/*
│
└── package.json                ← 源码仓根：workspaces 同时包含 packages/@ooc/* 和 .ooc-world
```

dogfooding World 的 `package.json` 通过 `workspace:*` 指向本地 Core，改源码即生效，
不需要 publish → install 循环。

---

## 9. 落地路线

| 阶段 | 内容 | 关键产出 |
|------|------|---------|
| **M0** | `@ooc/cli` 骨架：`ooc dev` 启动当前 app.server + vite，不改变结构 | CLI 命令壳可跑 |
| **M1** | Core 重构：导出 `createWorldRuntime` 工厂，消除 module-level singletons（pauseStore、jobManager 等迁入 WorldRuntime） | 最大的重构，地基 |
| **M2** | World / Stone 契约：StoneRegistry 扫描 `stones/*/package.json` 的 `ooc.objectId`，builtin 走同一套 loader；目录从 packages 重命名为 stones | 契约生效 |
| **M3** | 热更新：fs watch + bun reimport（executable/readable）+ Vite 动态注入 stone visible 路径 | 第一档热更新跑通 |
| **M4** | `ooc init/build/start`；self.md / prototype 变更的打标记 + 懒迁移机制 | 启动链路完整 |
| **M5** | npm publish 配置（changesets），验证 `ooc init && bun dev` 端到端跑通 | 对外发布就绪 |

**关键判断**：M1（抽出 WorldRuntime、消灭 module-level singleton）是所有后续工作的地基，
必须先完成。M0 可先做最小壳，但真正价值在 M1 之后释放。
