# Test Case: Object Reflectable Capability

**ID**: TC-REFL-001
**Capability**: Reflectable — Object 自我观察与自我修改
**Doc**: `meta/object.doc.ts` > reflectable 维度
**Design**: `world-core-interface-and-hot-reload.md` §6.1 (identity/knowledge 变更) + §6.2 (schema 变更懒迁移)

## Objective

验证 OOC Object 能观察（读）和修改（写）自己的五件套定义：
- **self.md**：身份定义
- **readable.md / readable.ts**：对外呈现
- **executable/index.ts**：方法定义
- **knowledge/**：seed 知识
- **package.json**：stone metadata

这是 reflectable 的核心含义——Object 不是被外部框架操作的被动数据，它是一个能"反思"并修改自己的 agent。

## Preconditions

1. 运行中的 OOC World（backend HTTP server）
2. 一个已经创建的 target stone，具备 executable 方法

## Test Cases

### TC-REFL-01: Object 通过 executable 方法读取自己的 self.md（自观察）

| Step | Action | Expected |
|------|--------|----------|
| 1 | 创建 stone `mirror`，写入 self.md 内容 `"# Mirror\nI am a reflective agent"` | — |
| 2 | executable 导出方法 `readSelf: { fn(ctx) { return Bun.file(ctx.self.dir + "/self.md").text() } }` | — |
| 3 | `POST /api/stones/mirror/call_method` body `{ method: "readSelf" }` | 返回文本等于 self.md 内容 |

### TC-REFL-02: Object 通过 HTTP API 修改自己的 self.md（自修改身份）

| Step | Action | Expected |
|------|--------|----------|
| 1 | `PUT /api/stones/mirror/self` body `{ text: "# Mirror V2\nI evolved." }` + header `X-Overwrite-Confirm: true` | 200, `{ ok: true }` |
| 2 | `GET /api/stones/mirror/self` | 200, `{ text: "# Mirror V2\nI evolved." }` |
| 3 | 磁盘上 `stones/main/objects/mirror/self.md` 内容等于新值 | 读文件验证一致 |

### TC-REFL-03: Object 通过 HTTP API 修改自己的 readable.md（自修改对外呈现）

| Step | Action | Expected |
|------|--------|----------|
| 1 | `PUT /api/stones/mirror/readme` body `{ text: "对外介绍：我能反思自己。" }` + header `X-Overwrite-Confirm: true` | 200 |
| 2 | `GET /api/stones/mirror/readme` | 200, text 匹配 |
| 3 | 磁盘文件验证 | 一致 |

### TC-REFL-04: Object 通过 HTTP API 修改自己的 executable 代码（自修改行为）

| Step | Action | Expected |
|------|--------|----------|
| 1 | `PUT /api/stones/mirror/server-source` body `{ code: "export const ui_methods = { evolve: { fn: () => 'I changed myself!' } };" }` + header `X-Overwrite-Confirm: true` | 200 |
| 2 | `POST /api/stones/mirror/call_method` body `{ method: "evolve" }` | 200, `returnValue === "I changed myself!"` |
| 3 | 磁盘 executable/index.ts 内容等于新代码 | 读文件验证一致 |

### TC-REFL-05: Object 能读写自己的 knowledge 文件

| Step | Action | Expected |
|------|--------|----------|
| 1 | `POST /api/stones/mirror/knowledge_files` body `{ path: "about/reflection.md", content: "反思是能力的起点。" }` | 200, `{ created: true }` |
| 2 | 磁盘上 `stones/main/objects/mirror/knowledge/about/reflection.md` 内容等于写入值 | 一致 |
| 3 | Object 方法内通过 `Bun.file(ctx.self.dir + "/knowledge/about/reflection.md").text()` 读取 | 返回 `"反思是能力的起点。"` |

### TC-REFL-06: 自修改 executable 后热更新自动生效（reflectable + programmable 闭环）

| Step | Action | Expected |
|------|--------|----------|
| 1 | mirror 初始只有方法 `version: { fn: () => "v1" }` | call_method 返回 "v1" |
| 2 | 通过 PUT server-source 改为 `version: { fn: () => "v2" }`，新增 `hello: { fn: () => "world" }` | 200 |
| 3 | 等 hot-reload（≥200ms），调 version | 返回 "v2" |
| 4 | 调 hello | 返回 "world" |
