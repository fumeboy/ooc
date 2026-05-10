# Stone Persistence + Server Module + Meta-Programming Design

**Date:** 2026-05-11
**Scope:** 把 OOC 单 object 能力补全到"对象能给自己写方法、写完立即生效"的元编程闭环：
1. `program` command 补 `program.ts` / `program.javascript` 两种内联代码执行模式（in-process 动态 import）
2. 引入 stone 全套持久化（建结构、覆盖核心 5 文件读写）
3. 引入 server 模块动态加载 + `self.callMethod` + `program.function` 路径，让 Agent 能编辑 `server/index.ts` 注册新方法并立即调用

---

## 背景

当前 OOC 单 object 阶段有以下空白：

- `program` 只有 `program.shell`；ts/js 内联执行未实现，对应 form result 直接返回 "本阶段仅支持 shell"
- 持久化只覆盖 flow object（`.flow.json` + `threads/`），stone 全套（`.stone.json` / `self.md` / `data.json` / `server/` …）完全没建
- 没有 server 模块加载机制——意味着 Object 无法保留可被自己调用的方法，"元编程"只能停在 prompt 层面
- 元编程闭环未打通：理想情况是 LLM 能写一段 server 方法 → 立即调用 → 看到结果 → 决定下一步

本设计补齐这 3 件事，目标是让 Agent **真能给自己写代码并立即用上**。

---

## 关键设计决策

### 决策 1：ts/js 执行用 in-process 动态 import，不开子进程

参考老系统 `kernel/src/executable/sandbox/executor.ts` 的成熟方案：

- 把用户代码包成 `export default async function(console, self) { ... return _result_; }`，写入临时 .mjs 文件
- 用 `await import("${tmpFile}?t=${Date.now()}")` 动态加载（query string 破坏缓存）
- 调用 default 导出，注入自定义 console（捕获 stdout/stderr）和 `self` 对象
- 用户代码用 `_result_` 变量约定返回值
- 临时文件执行完即删

**为什么不用子进程**：in-process 模型让 `self` 可以是个 live JS 对象（带 `callMethod` / `setData` 等真实方法），自然支撑元编程；子进程模型必须通过 IPC 路由 callMethod，复杂度跳一档。

**代价**：用户代码运行在 OOC 内核进程内，无沙箱隔离。单 object 单机阶段可接受；多租户部署时再讨论。

### 决策 2：stone 与 flow 通过 objectId 隐式关联

`flowRef.objectId` 与 `stoneRef.objectId` 是同一个。从 `ThreadPersistenceRef` 可以无歧义派生 `StoneObjectRef`：

```ts
function deriveStoneRef(threadRef: ThreadPersistenceRef): StoneObjectRef {
  return { baseDir: threadRef.baseDir, objectId: threadRef.objectId };
}
```

不引入新 ref 类型字段，不在 thread.persistence 上额外加 stoneRef。

### 决策 3：server/index.ts 用 dynamic import + cache-busting 加载

```ts
const mod = await import(`${stoneDir}/server/index.ts?t=${Date.now()}`);
const llm_methods = mod.llm_methods ?? {};
```

每次调用都重新 import，保证 LLM 刚写完 server/index.ts 立即生效。Bun 原生支持 .ts 动态 import，无需编译步骤。

文件不存在 / 解析失败 → callMethod 返回带 `[error]` 前缀的 result string，不抛出（不污染整个 thread）。

### 决策 4：`self` 注入对象的最小 API

```ts
interface ProgramSelf {
  /** stone 目录绝对路径，方便用户代码写 `${self.dir}/files/foo.txt` */
  dir: string;
  /** 调用本对象 server/index.ts 中 llm_methods 注册的方法 */
  callMethod: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 读 data.json 中的字段；不存在返回 undefined */
  getData: (key: string) => Promise<unknown>;
  /** 写 data.json 中的字段；自动 merge + 落盘 */
  setData: (key: string, value: unknown) => Promise<void>;
}
```

不暴露：`world_dir`、`readFile`、`writeFile`、`print` 等老系统 API。理由：
- 用户代码可以直接 `import { readFile } from "node:fs/promises"`，不需要再造一个名字
- `print` = `console.log`（Bun 已支持），不用单独开
- `world_dir` 当前没有 world 概念，留到跨 object 阶段

### 决策 5：server method ctx 的最小 API

server 方法签名：`fn(ctx, args) => unknown | Promise<unknown>`

```ts
interface ServerMethodContext {
  /** 同 self，方便 server 方法内部继续调用其它 method */
  self: ProgramSelf;
  /** 当前调用方线程，方便方法主动注入提示 */
  thread: {
    id: string;
    inject: (text: string) => void;
  };
}
```

---

## I. program.ts / program.js 实现

### 文件结构

新增：

| 路径 | 职责 |
|---|---|
| `src/executable/sandbox/executor.ts` | code executor 主体：写临时文件、dynamic import、调用、捕获 |
| `src/executable/sandbox/wrap.ts` | 把用户 code 拼装成 `async function(console, self) { ... }` 模块文本 |
| `src/executable/sandbox/console.ts` | 自定义 console，捕获 log/warn/error 到字符串数组 |

修改：

| 路径 | 改动 |
|---|---|
| `src/executable/commands/program.ts` | language=ts/typescript/js/javascript 走 executor；其它仍走 shell |
| `meta/object/executable/actions/commands/program.doc.js` | "当前实现阶段"段补 ts/js 模式说明 |

### executor 接口

```ts
export interface ProgramExecutionResult {
  /** 是否成功完成（无异常）。 */
  success: boolean;
  /** 用户代码 _result_ 的值；undefined 时表示用户没显式赋值。 */
  returnValue: unknown;
  /** 累积的 console 输出。 */
  stdout: string;
  /** 失败时的错误描述（含行号定位）。 */
  error?: string;
}

export async function executeUserCode(
  code: string,
  self: ProgramSelf | undefined,
): Promise<ProgramExecutionResult>;
```

`self` 为 undefined 时（thread 没 persistence），用 `null` 注入；用户代码访问 `self.callMethod` 会抛 `Cannot read properties of null` —— 这是预期行为，对应"在内存模式下不能调元编程方法"。executor 的 try/catch 会把异常转成 `error` 字段并附带行号定位，不会污染调用方。

临时文件总是在 finally 块里 `unlink`，无论成功失败。

### 输出格式

返回字符串塞进 form.result。格式与 program.shell 对齐：

```
$ <code 的第一行（折叠）>
[stdout]
<console 输出>
[returnValue]
<JSON.stringify(returnValue, null, 2)>
[exit 0]                 ← 成功
```

错误：

```
$ <code 的第一行>
[stdout]
<部分输出>
[error]
<错误信息 + 行号定位>
[exit 1]
```

输出截断规则与 shell 一致：4KB 上限，超出加 `...[truncated, original N bytes]`。

### LLM 写法约定

```js
// 简单脚本
const data = await readFile(`${self.dir}/files/x.txt`, "utf-8");
console.log(data);
_result_ = data.length;
```

```js
// 调用 server 方法
_result_ = await self.callMethod("greet", { name: "world" });
```

`_result_` 变量必须用 `let` 或裸赋值（被 wrapper 提前 `let _result_;` 声明），LLM 直接 `_result_ = ...` 即可。

---

## II. Stone 全套持久化

### 文件结构

新增（按"一个磁盘产物一个文件"的现有约定）：

| 路径 | 职责 |
|---|---|
| `src/persistable/stone-object.ts` | `StoneObjectRef` 类型 + `.stone.json` + `createStoneObject(ref)` 建全套目录 |
| `src/persistable/stone-self.ts` | `selfFile(ref)` / `readSelf(ref)` / `writeSelf(ref, text)` |
| `src/persistable/stone-readme.ts` | `readmeFile(ref)` / `readReadme(ref)` / `writeReadme(ref, text)` |
| `src/persistable/stone-data.ts` | `dataFile(ref)` / `readData(ref)` / `writeData(ref, data)` / `mergeData(ref, patch)` |
| `src/persistable/stone-server.ts` | `serverDir(ref)` / `serverIndexFile(ref)` / `readServerSource(ref)` / `writeServerSource(ref, code)` |

修改：

| 路径 | 改动 |
|---|---|
| `src/persistable/common.ts` | 加 `StoneObjectRef` 类型 + `stoneDir(ref)` 路径 helper + `deriveStoneFromThread(threadRef)` 派生 |
| `src/persistable/index.ts` | re-export 上述新模块 |

### `StoneObjectRef` 类型

```ts
/**
 * 标识磁盘上的单个 stone 对象。
 * 路径形态：`{baseDir}/stones/{objectId}`
 */
export interface StoneObjectRef {
  /** 包含 `stones/` 的根目录。 */
  baseDir: string;
  /** `stones/` 下的 object 目录名。 */
  objectId: string;
}

/** 计算 stone 目录绝对路径。 */
export function stoneDir(ref: StoneObjectRef): string {
  return join(ref.baseDir, "stones", ref.objectId);
}

/** 从 ThreadPersistenceRef 派生 StoneObjectRef，便于 program/server 模块复用。 */
export function deriveStoneFromThread(threadRef: ThreadPersistenceRef): StoneObjectRef {
  return { baseDir: threadRef.baseDir, objectId: threadRef.objectId };
}
```

### `.stone.json` metadata

```ts
export interface StoneObjectMetadata {
  type: "stone";
  objectId: string;
}
```

### `createStoneObject` 行为

- mkdir `stones/{objectId}/`
- mkdir 全部子目录：`knowledge/` / `knowledge/memory/` / `knowledge/relations/` / `server/` / `client/` / `files/`
- 写 `.stone.json` 元数据
- **不**写 self.md / readme.md / data.json / server/index.ts —— 这些由用户/Agent 后续主动写入

### 各文件读写

每个 stone-X.ts 模块导出 3 个函数：

- `xxxFile(ref): string` — 路径
- `readXxx(ref): Promise<T | undefined>` — 读，不存在返回 undefined
- `writeXxx(ref, value): Promise<void>` — 写，覆盖

`stone-data.ts` 额外导出 `mergeData(ref, patch)`：读取现有 data.json（缺省按 `{}` 处理）→ 顶层 spread merge（不深合并）→ 写回。供 `self.setData(key, value)` 用。

### 不实现项（仅建目录骨架）

- `knowledge/**/*.md` — 不读不写
- `knowledge/memory/index.md` — 不读不写
- `knowledge/relations/{id}.md` — 不读不写
- `client/index.tsx` — 不读不写
- `files/` 下任何文件 — 由用户代码自己处理（用户代码可以 `writeFile(${self.dir}/files/x, ...)`）

---

## III. Server 模块加载 + 元编程

### 文件结构

新增：

| 路径 | 职责 |
|---|---|
| `src/executable/server/loader.ts` | `loadServerMethods(stoneRef)` 动态 import server/index.ts |
| `src/executable/server/types.ts` | `ServerMethod` / `ServerMethodContext` / `LlmMethods` 类型 |
| `src/executable/server/self.ts` | 构造 `ProgramSelf` 对象（绑定 stoneRef + 实现 callMethod/setData/getData） |

修改：

| 路径 | 改动 |
|---|---|
| `src/executable/commands/program.ts` | 增加 `program.function` 分支（直接调 callMethod）+ ts/js 分支注入 self |
| `meta/object/executable/server/index.doc.js` | 把 KNOWLEDGE 内容更新为"如何编辑 server/index.ts + 立即生效"的指引 |
| `meta/object/executable/actions/commands/program.doc.js` | 加 program.function 调用示例 |

### `loadServerMethods` 实现

```ts
import { serverIndexFile } from "../../persistable/stone-server";

const cache = new Map<string, { mtime: number; methods: LlmMethods }>();

export async function loadServerMethods(stoneRef: StoneObjectRef): Promise<LlmMethods> {
  const file = serverIndexFile(stoneRef);
  let stat;
  try {
    stat = await Bun.file(file).stat();
  } catch {
    return {}; // 文件不存在
  }

  // mtime 没变就用 cache
  const cached = cache.get(file);
  if (cached && cached.mtime === stat.mtimeMs) return cached.methods;

  // mtime 变了或第一次 → 动态 import + 缓存破坏
  try {
    const mod = await import(`${file}?t=${stat.mtimeMs}`);
    const methods = (mod.llm_methods ?? {}) as LlmMethods;
    cache.set(file, { mtime: stat.mtimeMs, methods });
    return methods;
  } catch (error) {
    throw new Error(`server/index.ts 加载失败: ${(error as Error).message}`);
  }
}
```

按 mtime 缓存，避免每次 callMethod 都重新 import；mtime 一变（Agent 刚写过）立即 reload。

### `ProgramSelf` 实现（src/executable/server/self.ts）

```ts
export function createProgramSelf(
  stoneRef: StoneObjectRef,
  thread: ThreadContext,
): ProgramSelf {
  const dir = stoneDir(stoneRef);

  const self: ProgramSelf = {
    dir,
    async callMethod(name, args = {}) {
      const methods = await loadServerMethods(stoneRef);
      const method = methods[name];
      if (!method) {
        throw new Error(`方法 ${name} 不存在；当前可用：${Object.keys(methods).join(", ") || "(空)"}`);
      }
      const ctx: ServerMethodContext = {
        self,
        thread: {
          id: thread.id,
          inject: (text) => {
            thread.events.push({ category: "context_change", kind: "inject", text });
          },
        },
      };
      return method.fn(ctx, args);
    },
    async getData(key) {
      const data = (await readData(stoneRef)) ?? {};
      return data[key];
    },
    async setData(key, value) {
      await mergeData(stoneRef, { [key]: value });
    },
  };
  return self;
}
```

### `program.function` path

`commands/program.ts` 已有 `ProgramCommandPath.Function = "program.function"` enum 与 match。补执行实现：

```ts
async function executeProgramCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  // function 模式优先于 language 判断
  const fn = ctx.args.function as string | undefined;
  if (typeof fn === "string" && fn.length > 0) {
    return runFunction(ctx, fn, (ctx.args.args as Record<string, unknown>) ?? {});
  }

  // ts/js 模式
  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;
  if (language === "ts" || language === "typescript" || language === "js" || language === "javascript") {
    return runUserCode(ctx, code);
  }
  if (language === "shell") {
    return runShell(code); // existing
  }

  return `[program] 未知 language="${language ?? "<undefined>"}"，支持 shell / ts / js`;
}
```

`runFunction` / `runUserCode` 均需要从 `ctx.thread.persistence` 派生 stoneRef：
- 没 persistence → 返回 `[program] 当前线程无 persistence ref，无法调用 server 方法` 或 `...无法访问 self`

### 元编程 KNOWLEDGE（写在 program.doc.js 与 server/index.doc.js）

更新两处文档让 LLM 看到："你可以为自己写方法"：

```md
## 元编程：编辑自己的 server/index.ts

你可以用 program.shell 修改自己的 `${self.dir}/server/index.ts`，
新方法在下次 program.function 或 program.ts 中即可调用。

典型流程：

1. open(program, language=shell, code="cat > server/index.ts <<'EOF'
   export const llm_methods = {
     greet: {
       description: "向某人问好",
       params: [{ name: "name", type: "string", required: true }],
       fn: async (ctx, { name }) => `Hello, ${name}!`,
     },
   };
   EOF") → submit

2. open(program, function="greet", args={ name: "world" }) → submit
   form.result 的 returnValue 段会包含 "Hello, world!"

或者通过 program.ts 调用：

   open(program, language="ts", code='_result_ = await self.callMethod("greet", { name: "world" });') → submit
```

---

## IV. 文件改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `src/executable/sandbox/executor.ts` | Create | 主执行器，dynamic import + 调用 + 错误捕获 |
| `src/executable/sandbox/wrap.ts` | Create | 把 user code 包装成 module 文本 |
| `src/executable/sandbox/console.ts` | Create | 捕获式 console |
| `src/executable/__tests__/sandbox.test.ts` | Create | executor 单元测试（成功/异常/console 捕获/_result_）|
| `src/executable/server/types.ts` | Create | ServerMethod / Context / LlmMethods 类型 |
| `src/executable/server/loader.ts` | Create | loadServerMethods + mtime cache |
| `src/executable/server/self.ts` | Create | createProgramSelf |
| `src/executable/__tests__/server-loader.test.ts` | Create | loader + callMethod 单元测试 |
| `src/executable/commands/program.ts` | Modify | function path 实现 + ts/js 分支 |
| `src/executable/__tests__/program.test.ts` | Modify | 加 ts/js 模式 + function path 测试 |
| `src/persistable/common.ts` | Modify | StoneObjectRef + stoneDir + deriveStoneFromThread |
| `src/persistable/stone-object.ts` | Create | createStoneObject + .stone.json |
| `src/persistable/stone-self.ts` | Create | self.md 读写 |
| `src/persistable/stone-readme.ts` | Create | readme.md 读写 |
| `src/persistable/stone-data.ts` | Create | data.json 读写 + merge |
| `src/persistable/stone-server.ts` | Create | server/index.ts 路径 + 源码读写 |
| `src/persistable/__tests__/stone.test.ts` | Create | stone 持久化单元测试 |
| `src/persistable/index.ts` | Modify | re-export 新模块 |
| `meta/object/executable/actions/commands/program.doc.js` | Modify | 补 ts/js + function 模式说明 + 元编程示例 |
| `meta/object/executable/server/index.doc.js` | Modify | 加"当前实现阶段"段：how to write methods |
| `meta/object/persistable/index.doc.js` | Modify | 把"当前实现阶段"段从"只覆盖单 object flow"扩到包含 stone |
| `.gitignore` | Modify | 加 `.ooc-world-test/` |
| `tests/integration/meta-programming.integration.test.ts` | Create | 端到端：Agent 写一个 server 方法 → 调用 → 验证结果 |

---

## V. 集成测试场景

新增 1 个集成测试，验证元编程闭环：

**场景：`meta-programming`** — Agent 给自己写一个 method 然后调它

LLM prompt：
> 在你的 server/index.ts 里注册一个名为 `add` 的 llm_method，接收 `{ a, b }` 两个数字，
> 返回它们的和。注册完后，用 program.function 调用 add({a: 7, b: 8})，把结果写进 end summary。

预期流：
1. open(program, language=shell, code='cat > {self.dir}/server/index.ts ...') → submit
2. open(program, function="add", args={a:7, b:8}) → submit
3. open(end, summary="结果是 15") → submit

断言：
- root.status === "done"
- root.endSummary 包含 "15"
- 至少 2 个 form executed
- stone 目录下 server/index.ts 存在且包含 "add"

测试 fixture 用 mkdtemp 临时目录作为 baseDir，先 createStoneObject(test-agent) 再 createFlowObject 关联同 objectId。

---

## VI. 自检（按 goal.md）

| 问题 | 答案 |
|---|---|
| 它在新系统里为什么存在 | program.ts 让 Agent 能写复杂逻辑而不是单行 shell；server 模块让方法可被多次调用 + 跨线程复用；stone 持久化让对象身份/数据可保留 |
| 最小职责是什么 | executor：跑一段 ts/js 拿结果；loader：按 mtime 加载 server 方法；stone-X：读写一个磁盘文件 |
| 边界几句话说清 | 不沙箱、不实现 worker thread；不接 knowledge 加载引擎；不跨 object talk |
| 依赖哪些模块 | sandbox 依赖 Bun dynamic import；loader 依赖 stone-server.ts；commands/program 依赖 sandbox + server |
| 暂不迁会失去什么 | 没 program.ts → Agent 多步逻辑要靠多次 shell 拼接；没 server → 方法不能跨线程复用；没 stone → 重启即丢身份 |
| 迁入后系统更简单还是更复杂 | 简单：对象=磁盘目录 + 几段方法 = 单一心智模型，与文档原本设计一致 |

---

## VII. 非目标

- 不实现代码沙箱隔离（vm/Worker thread/容器）；in-process dynamic import 共享内核进程
- 不实现 knowledge/ 下文档的加载与渲染（仅建目录骨架）
- 不实现 client/ 下的 React UI（仅建目录骨架）
- 不实现 memory/ 与 relations/ 的读写（仅建目录骨架）
- 不实现跨 object 的 server 方法调用（self.callMethod 只能调当前 stone 的方法）
- 不实现 ui_methods 的 HTTP 暴露（server 模块只读 llm_methods 段）
- 不实现 server 方法的权限控制（任意 method 都可被调用）
- 不实现热替换的 import 失效检测（mtime 没变不 reload，足够单 object 阶段）

---

## VIII. 实施顺序建议

1. **stone 持久化基础** — common.ts + stone-object.ts + 单元测试，先把目录建出来
2. **stone 5 个文件读写** — stone-self / readme / data / server.ts + 单元测试
3. **server types + loader** — 单元测试覆盖 mtime 缓存与 reload
4. **sandbox executor** — wrap/console/executor + 单元测试覆盖成功/异常/_result_/console 捕获
5. **createProgramSelf + callMethod 集成** — 单元测试覆盖 callMethod / setData / getData
6. **program.ts/js 接 executor** + program.function 接 callMethod + 单元测试
7. **文档同步**：program.doc.js / server/index.doc.js / persistable/index.doc.js
8. **.gitignore + 集成测试 meta-programming**
9. **最终验证**：bun test src + tsc --noEmit + bun --env-file=.env test tests/integration/meta-programming
