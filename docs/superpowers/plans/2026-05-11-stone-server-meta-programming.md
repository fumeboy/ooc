# Stone Persistence + Server + Meta-Programming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 给 OOC 单 object 加 stone 全套持久化、server 模块动态加载、program ts/js 内联执行、`self.callMethod` 元编程通道，并端到端验证 Agent 能写一个 server method 立即调用。

**Architecture:** in-process dynamic import 驱动 ts/js 执行（参考老系统 `kernel/src/executable/sandbox/executor.ts`，剥离 trait/build hooks 历史包袱）；stone-X 文件按"一个磁盘产物一个文件"约定纵向拆分；server loader 用 mtime 缓存避免每次 callMethod 重 import。

**Tech Stack:** TypeScript, Bun (dynamic import + spawn + file stat), 现有 persistable / executable / thinkable 模块。

---

## File Structure

参考 spec section IV 文件改动清单。

---

### Task 1: StoneObjectRef + stone-object.ts（建目录骨架 + .stone.json）

**Files:**
- Modify: `src/persistable/common.ts`
- Create: `src/persistable/stone-object.ts`
- Test: `src/persistable/__tests__/stone.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/persistable/__tests__/stone.test.ts`：

```ts
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, stoneDir, stoneMetadataFile } from "../stone-object";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("createStoneObject", () => {
  test("creates full directory skeleton with metadata", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    const dir = stoneDir(ref);
    // 5 个核心子目录全部建好
    for (const sub of ["knowledge", "knowledge/memory", "knowledge/relations", "server", "client", "files"]) {
      const stats = await stat(join(dir, sub));
      expect(stats.isDirectory()).toBe(true);
    }

    // .stone.json 已写
    const metadata = JSON.parse(await readFile(stoneMetadataFile(ref), "utf8"));
    expect(metadata).toEqual({ type: "stone", objectId: "alice" });
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `bun test src/persistable/__tests__/stone.test.ts`
Expected: FAIL — `cannot find module ../stone-object`.

- [ ] **Step 3: 在 common.ts 加 StoneObjectRef + stoneDir + deriveStoneFromThread**

追加到 `src/persistable/common.ts` 末尾：

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

- [ ] **Step 4: 创建 stone-object.ts**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, toJson, type StoneObjectRef } from "./common";

/** 写入 `.stone.json` 的元数据。 */
export interface StoneObjectMetadata {
  type: "stone";
  objectId: string;
}

/** stone 元数据文件 `.stone.json` 的绝对路径。 */
export function stoneMetadataFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), ".stone.json");
}

/** 子目录路径汇总，便于其它模块引用。 */
export function knowledgeDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "knowledge");
}
export function memoryDir(ref: StoneObjectRef): string {
  return join(knowledgeDir(ref), "memory");
}
export function relationsDir(ref: StoneObjectRef): string {
  return join(knowledgeDir(ref), "relations");
}
export function serverDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "server");
}
export function clientDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "client");
}
export function filesDir(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "files");
}

/**
 * 创建 stone 目录全套骨架（按文档 stone 持久化结构）+ 写入 .stone.json。
 * 不写 self.md / readme.md / data.json / server/index.ts —— 这些由后续主动写入。
 */
export async function createStoneObject(ref: StoneObjectRef): Promise<StoneObjectRef> {
  await mkdir(memoryDir(ref), { recursive: true });
  await mkdir(relationsDir(ref), { recursive: true });
  await mkdir(serverDir(ref), { recursive: true });
  await mkdir(clientDir(ref), { recursive: true });
  await mkdir(filesDir(ref), { recursive: true });

  const metadata: StoneObjectMetadata = { type: "stone", objectId: ref.objectId };
  await writeFile(stoneMetadataFile(ref), toJson(metadata), "utf8");
  return ref;
}
```

- [ ] **Step 5: Run test, expect pass + tsc**

Run: `bun test src/persistable/__tests__/stone.test.ts && bunx tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/persistable/common.ts src/persistable/stone-object.ts src/persistable/__tests__/stone.test.ts
git commit -m "feat(persistable): add stone object skeleton creation"
```

---

### Task 2: stone-self / stone-readme / stone-data / stone-server 5 个文件读写

**Files:**
- Create: `src/persistable/stone-self.ts`
- Create: `src/persistable/stone-readme.ts`
- Create: `src/persistable/stone-data.ts`
- Create: `src/persistable/stone-server.ts`
- Modify: `src/persistable/index.ts`
- Test: `src/persistable/__tests__/stone.test.ts`

- [ ] **Step 1: 在同一测试文件追加各文件读写测试**

在 `src/persistable/__tests__/stone.test.ts` 末尾追加：

```ts
import {
  readSelf,
  selfFile,
  writeSelf,
} from "../stone-self";
import {
  readReadme,
  readmeFile,
  writeReadme,
} from "../stone-readme";
import {
  dataFile,
  mergeData,
  readData,
  writeData,
} from "../stone-data";
import {
  readServerSource,
  serverIndexFile,
  writeServerSource,
} from "../stone-server";

describe("stone file IO", () => {
  test("self.md round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    expect(await readSelf(ref)).toBeUndefined();
    await writeSelf(ref, "# Alice\n\nI am Alice.");
    expect(await readSelf(ref)).toBe("# Alice\n\nI am Alice.");
    expect(selfFile(ref)).toBe(join(stoneDir(ref), "self.md"));
  });

  test("readme.md round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "bob" });

    expect(await readReadme(ref)).toBeUndefined();
    await writeReadme(ref, "Hello visitors.");
    expect(await readReadme(ref)).toBe("Hello visitors.");
    expect(readmeFile(ref)).toBe(join(stoneDir(ref), "readme.md"));
  });

  test("data.json round trip + merge", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "charlie" });

    expect(await readData(ref)).toBeUndefined();
    await writeData(ref, { age: 42, city: "Beijing" });
    expect(await readData(ref)).toEqual({ age: 42, city: "Beijing" });

    await mergeData(ref, { city: "Shanghai", role: "engineer" });
    expect(await readData(ref)).toEqual({ age: 42, city: "Shanghai", role: "engineer" });

    expect(dataFile(ref)).toBe(join(stoneDir(ref), "data.json"));
  });

  test("server/index.ts round trip", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-stone-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "dave" });

    expect(await readServerSource(ref)).toBeUndefined();
    const code = "export const llm_methods = { foo: { fn: async () => 1 } };";
    await writeServerSource(ref, code);
    expect(await readServerSource(ref)).toBe(code);
    expect(serverIndexFile(ref)).toBe(join(stoneDir(ref), "server", "index.ts"));
  });
});
```

- [ ] **Step 2: Run, expect 4 failures**

Run: `bun test src/persistable/__tests__/stone.test.ts`
Expected: 4 new tests fail (cannot find modules).

- [ ] **Step 3: 创建 stone-self.ts**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";

/** stone 的身份说明文件 self.md 的绝对路径。 */
export function selfFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "self.md");
}

/** 读取 self.md，不存在返回 undefined。 */
export async function readSelf(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(selfFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 self.md，覆盖。 */
export async function writeSelf(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(selfFile(ref), text, "utf8");
}
```

- [ ] **Step 4: 创建 stone-readme.ts**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, type StoneObjectRef } from "./common";

/** stone 的对外说明文件 readme.md 的绝对路径。 */
export function readmeFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "readme.md");
}

/** 读取 readme.md，不存在返回 undefined。 */
export async function readReadme(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(readmeFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 readme.md，覆盖。 */
export async function writeReadme(ref: StoneObjectRef, text: string): Promise<void> {
  await writeFile(readmeFile(ref), text, "utf8");
}
```

- [ ] **Step 5: 创建 stone-data.ts**

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stoneDir, toJson, type StoneObjectRef } from "./common";

/** stone 的数据文件 data.json 的绝对路径。 */
export function dataFile(ref: StoneObjectRef): string {
  return join(stoneDir(ref), "data.json");
}

/** 读取 data.json，不存在返回 undefined。 */
export async function readData(ref: StoneObjectRef): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(dataFile(ref), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 整体覆盖写 data.json。 */
export async function writeData(
  ref: StoneObjectRef,
  data: Record<string, unknown>,
): Promise<void> {
  await writeFile(dataFile(ref), toJson(data), "utf8");
}

/** 顶层 spread merge：读现有 data.json → spread patch → 写回。 */
export async function mergeData(
  ref: StoneObjectRef,
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = (await readData(ref)) ?? {};
  await writeData(ref, { ...existing, ...patch });
}
```

- [ ] **Step 6: 创建 stone-server.ts**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serverDir, type StoneObjectRef } from "./stone-object";

/** stone 的 server/index.ts 绝对路径。 */
export function serverIndexFile(ref: StoneObjectRef): string {
  return join(serverDir(ref), "index.ts");
}

/** 读取 server/index.ts 源码，不存在返回 undefined。 */
export async function readServerSource(ref: StoneObjectRef): Promise<string | undefined> {
  try {
    return await readFile(serverIndexFile(ref), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 写入 server/index.ts 源码，自动 mkdir server/ 目录。 */
export async function writeServerSource(ref: StoneObjectRef, code: string): Promise<void> {
  await mkdir(serverDir(ref), { recursive: true });
  await writeFile(serverIndexFile(ref), code, "utf8");
}
```

- [ ] **Step 7: 更新 src/persistable/index.ts re-export**

在 `src/persistable/index.ts` 末尾追加：

```ts
export type { StoneObjectRef } from "./common";
export { stoneDir, deriveStoneFromThread } from "./common";
export {
  createStoneObject,
  knowledgeDir,
  memoryDir,
  relationsDir,
  serverDir,
  clientDir,
  filesDir,
  stoneMetadataFile,
  type StoneObjectMetadata,
} from "./stone-object";
export { readSelf, selfFile, writeSelf } from "./stone-self";
export { readReadme, readmeFile, writeReadme } from "./stone-readme";
export { dataFile, mergeData, readData, writeData } from "./stone-data";
export { readServerSource, serverIndexFile, writeServerSource } from "./stone-server";
```

- [ ] **Step 8: Run tests + tsc**

Run: `bun test src/persistable/__tests__/stone.test.ts && bunx tsc --noEmit`
Expected: 5/5 PASS / exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/persistable
git commit -m "feat(persistable): add stone self/readme/data/server file IO"
```

---

### Task 3: server types + loader（mtime cache + dynamic import）

**Files:**
- Create: `src/executable/server/types.ts`
- Create: `src/executable/server/loader.ts`
- Test: `src/executable/__tests__/server-loader.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/executable/__tests__/server-loader.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, writeServerSource } from "../../persistable";
import { loadServerMethods } from "../server/loader";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("loadServerMethods", () => {
  test("returns empty when server/index.ts missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });
    const methods = await loadServerMethods(ref);
    expect(methods).toEqual({});
  });

  test("loads llm_methods from server/index.ts", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(
      ref,
      `export const llm_methods = {
        echo: {
          description: "回声",
          params: [{ name: "text", type: "string", required: true }],
          fn: async (_ctx, { text }) => text,
        },
      };`
    );

    const methods = await loadServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["echo"]);
    const result = await methods.echo!.fn({} as never, { text: "hi" });
    expect(result).toBe("hi");
  });

  test("reloads when server/index.ts mtime changes", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

    await writeServerSource(ref, `export const llm_methods = { v1: { fn: async () => 1 } };`);
    let methods = await loadServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["v1"]);

    // 等待 mtime 至少变化 1ms
    await new Promise((r) => setTimeout(r, 5));
    await writeServerSource(ref, `export const llm_methods = { v2: { fn: async () => 2 } };`);

    methods = await loadServerMethods(ref);
    expect(Object.keys(methods)).toEqual(["v2"]);
  });
});
```

- [ ] **Step 2: Run, expect failures (modules missing)**

Run: `bun test src/executable/__tests__/server-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 创建 src/executable/server/types.ts**

```ts
import type { ThreadContext } from "../../thinkable/context";
import type { StoneObjectRef } from "../../persistable";

/** program 中注入的 self 对象，让用户代码能调用本对象的 method 与读写 data。 */
export interface ProgramSelf {
  /** stone 目录绝对路径。 */
  dir: string;
  /** 调用 server/index.ts 中 llm_methods 注册的方法。 */
  callMethod: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 读 data.json 中的字段；不存在返回 undefined。 */
  getData: (key: string) => Promise<unknown>;
  /** 顶层 merge 写 data.json 中的字段。 */
  setData: (key: string, value: unknown) => Promise<void>;
}

/** server method 调用时的上下文。 */
export interface ServerMethodContext {
  /** 同 self；server method 内部可继续调其它 method。 */
  self: ProgramSelf;
  /** 当前调用方线程，方便方法主动注入提示。 */
  thread: {
    id: string;
    inject: (text: string) => void;
  };
}

/** 单个注册到 server 的 LLM 可调用方法。 */
export interface ServerMethod {
  description?: string;
  params?: Array<{ name: string; type?: string; description?: string; required?: boolean }>;
  fn: (ctx: ServerMethodContext, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** server/index.ts 暴露的 llm_methods 字典。 */
export type LlmMethods = Record<string, ServerMethod>;

/** 内部用：缓存 stoneRef 与对应已加载的 methods（按 mtime 失效）。 */
export interface ServerLoaderEntry {
  mtime: number;
  methods: LlmMethods;
}

export type { StoneObjectRef, ThreadContext };
```

- [ ] **Step 4: 创建 src/executable/server/loader.ts**

```ts
import { stat } from "node:fs/promises";
import { serverIndexFile } from "../../persistable";
import type { LlmMethods, ServerLoaderEntry, StoneObjectRef } from "./types";

const cache = new Map<string, ServerLoaderEntry>();

/**
 * 动态加载 stone 的 server/index.ts，按 mtime 缓存。
 * - 文件不存在 → {}
 * - 解析失败 → 抛出带原始错误信息的异常（由调用方决定怎么呈现）
 */
export async function loadServerMethods(stoneRef: StoneObjectRef): Promise<LlmMethods> {
  const file = serverIndexFile(stoneRef);
  let stats;
  try {
    stats = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  const mtime = stats.mtimeMs;
  const cached = cache.get(file);
  if (cached && cached.mtime === mtime) return cached.methods;

  // 用 mtime 作为 query string 破坏 import cache。
  const mod = await import(`${file}?t=${mtime}`);
  const methods = (mod.llm_methods ?? {}) as LlmMethods;
  cache.set(file, { mtime, methods });
  return methods;
}

/** 测试钩子：清空 loader 缓存。 */
export function clearServerLoaderCache(): void {
  cache.clear();
}
```

- [ ] **Step 5: Run tests + tsc**

Run: `bun test src/executable/__tests__/server-loader.test.ts && bunx tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/executable/server src/executable/__tests__/server-loader.test.ts
git commit -m "feat(server): add dynamic loader with mtime cache"
```

---

### Task 4: sandbox executor（wrap + console + executeUserCode）

**Files:**
- Create: `src/executable/sandbox/console.ts`
- Create: `src/executable/sandbox/wrap.ts`
- Create: `src/executable/sandbox/executor.ts`
- Test: `src/executable/__tests__/sandbox.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/executable/__tests__/sandbox.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { executeUserCode } from "../sandbox/executor";

describe("executeUserCode", () => {
  test("captures console.log into stdout", async () => {
    const result = await executeUserCode(`console.log("hello", 1+2);`, null);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello 3");
  });

  test("returns _result_ value", async () => {
    const result = await executeUserCode(`_result_ = 6 * 7;`, null);
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(42);
  });

  test("supports await and standard imports", async () => {
    const result = await executeUserCode(
      `import { tmpdir } from "node:os";\n_result_ = typeof tmpdir();`,
      null
    );
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe("string");
  });

  test("captures runtime errors with stdout preserved", async () => {
    const result = await executeUserCode(`console.log("before"); throw new Error("boom");`, null);
    expect(result.success).toBe(false);
    expect(result.stdout).toContain("before");
    expect(result.error).toContain("boom");
  });

  test("self argument is exposed to user code", async () => {
    const fakeSelf = { dir: "/tmp/x", callMethod: async () => "called", getData: async () => undefined, setData: async () => {} };
    const result = await executeUserCode(`_result_ = await self.callMethod("foo");`, fakeSelf);
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe("called");
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test src/executable/__tests__/sandbox.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 创建 console.ts**

```ts
/** 自定义 console，把所有 log/warn/error 文本累积进单个数组，供 executor 收尾。 */
export interface CapturingConsole {
  console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  drain: () => string;
}

export function createCapturingConsole(): CapturingConsole {
  const buffer: string[] = [];
  const sink = (...args: unknown[]) => {
    buffer.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return {
    console: { log: sink, warn: sink, error: sink },
    drain: () => buffer.join("\n"),
  };
}
```

- [ ] **Step 4: 创建 wrap.ts**

```ts
/**
 * 把用户 ts/js 代码包成一个 ES module 文本。
 *
 * 约定：
 * - import 必须在模块顶层 → 提取出来放最前
 * - 其它代码塞进 default async 函数体
 * - `_result_` 由 wrapper 预先 `let` 声明，用户直接赋值即可
 */
export function wrapUserCode(code: string): string {
  const lines = code.split("\n");
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ") || trimmed.startsWith("import{") || trimmed.startsWith("import\"") || trimmed.startsWith("import'")) {
      importLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  return [
    ...importLines,
    "export default async function(console, self) {",
    "  let _result_;",
    bodyLines.join("\n"),
    "  return _result_;",
    "}",
  ].join("\n");
}
```

- [ ] **Step 5: 创建 executor.ts**

```ts
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCapturingConsole } from "./console";
import { wrapUserCode } from "./wrap";

export interface ProgramExecutionResult {
  success: boolean;
  returnValue: unknown;
  stdout: string;
  error?: string;
}

let counter = 0;

/**
 * 执行一段 ts/js 用户代码。
 * - self 注入到包装函数的第二个入参
 * - console.log/warn/error 进 stdout
 * - _result_ 进 returnValue
 * - 异常进 error，附带行号定位（如能解析）
 */
export async function executeUserCode(
  code: string,
  self: unknown,
): Promise<ProgramExecutionResult> {
  const dir = join(tmpdir(), "ooc", "exec");
  await mkdir(dir, { recursive: true });
  counter += 1;
  const id = `${Date.now()}_${counter}`;
  const file = join(dir, `exec_${id}.mjs`);

  const moduleSource = wrapUserCode(code);
  const cap = createCapturingConsole();

  try {
    await writeFile(file, moduleSource, "utf8");
    const mod = await import(`${file}?t=${id}`);
    const fn = mod.default as (console: unknown, self: unknown) => Promise<unknown>;
    const returnValue = await fn(cap.console, self);
    return { success: true, returnValue: returnValue ?? undefined, stdout: cap.drain() };
  } catch (error) {
    const err = error as Error;
    let detail = err.message ?? String(err);
    // 尝试从堆栈里提取临时文件行号，换算成用户代码行
    const stackMatch = err.stack?.match(/exec_\d+_\d+\.mjs:(\d+):(\d+)/);
    if (stackMatch) {
      // wrapper 头部固定 2 行（importLines + "export default..." + "let _result_;"）
      // 此处只给粗略行号；精确行号留给后续优化
      detail = `${detail}\n[at module line ${stackMatch[1]}:${stackMatch[2]}]`;
    }
    return { success: false, returnValue: undefined, stdout: cap.drain(), error: detail };
  } finally {
    try {
      await unlink(file);
    } catch {
      // 忽略清理失败
    }
  }
}
```

- [ ] **Step 6: Run tests + tsc**

Run: `bun test src/executable/__tests__/sandbox.test.ts && bunx tsc --noEmit`
Expected: 5/5 PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/executable/sandbox src/executable/__tests__/sandbox.test.ts
git commit -m "feat(sandbox): in-process ts/js executor with console capture and self injection"
```

---

### Task 5: createProgramSelf（绑定 stoneRef + 实现 callMethod/setData/getData）

**Files:**
- Create: `src/executable/server/self.ts`
- Test: `src/executable/__tests__/server-self.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/executable/__tests__/server-self.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, readData, writeServerSource } from "../../persistable";
import { createProgramSelf } from "../server/self";
import type { ThreadContext } from "../../thinkable/context";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("createProgramSelf", () => {
  test("callMethod resolves and runs registered method with ctx.self/thread", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeServerSource(
      ref,
      `export const llm_methods = {
        whoAmI: {
          fn: async (ctx) => ctx.self.dir + "::" + ctx.thread.id,
        },
      };`
    );

    const thread: ThreadContext = { id: "t1", status: "running", events: [] };
    const self = createProgramSelf(ref, thread);
    const result = await self.callMethod("whoAmI", {});
    expect(typeof result).toBe("string");
    expect(result).toContain(ref.objectId);
    expect(result).toContain("t1");
  });

  test("callMethod throws clear error for unknown method", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    const thread: ThreadContext = { id: "t1", status: "running", events: [] };
    const self = createProgramSelf(ref, thread);
    await expect(self.callMethod("nope", {})).rejects.toThrow(/不存在/);
  });

  test("setData/getData round trip via mergeData", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    const thread: ThreadContext = { id: "t1", status: "running", events: [] };
    const self = createProgramSelf(ref, thread);

    expect(await self.getData("counter")).toBeUndefined();
    await self.setData("counter", 1);
    expect(await self.getData("counter")).toBe(1);
    await self.setData("counter", 2);
    expect(await self.getData("counter")).toBe(2);
    expect(await readData(ref)).toEqual({ counter: 2 });
  });

  test("inject pushes context_change/inject event to thread", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeServerSource(
      ref,
      `export const llm_methods = {
        say: {
          fn: async (ctx, { text }) => { ctx.thread.inject(text); return "ok"; },
        },
      };`
    );

    const thread: ThreadContext = { id: "t1", status: "running", events: [] };
    const self = createProgramSelf(ref, thread);
    await self.callMethod("say", { text: "from method" });
    expect(thread.events.length).toBe(1);
    expect(thread.events[0]).toEqual({ category: "context_change", kind: "inject", text: "from method" });
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test src/executable/__tests__/server-self.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 创建 src/executable/server/self.ts**

```ts
import { mergeData, readData, stoneDir, type StoneObjectRef } from "../../persistable";
import type { ThreadContext } from "../../thinkable/context";
import { loadServerMethods } from "./loader";
import type { ProgramSelf, ServerMethodContext } from "./types";

/**
 * 构造 program 模式注入的 self 对象。
 * thread 是当前调用方线程，server method 可通过 ctx.thread.inject 推 inject 事件。
 */
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
        const available = Object.keys(methods).join(", ") || "(空)";
        throw new Error(`方法 ${name} 不存在；当前可用：${available}`);
      }
      const ctx: ServerMethodContext = {
        self,
        thread: {
          id: thread.id,
          inject: (text) => {
            thread.events.push({
              category: "context_change",
              kind: "inject",
              text,
            });
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

- [ ] **Step 4: Run tests + tsc**

Run: `bun test src/executable/__tests__/server-self.test.ts && bunx tsc --noEmit`
Expected: 4/4 PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/executable/server/self.ts src/executable/__tests__/server-self.test.ts
git commit -m "feat(server): createProgramSelf binds stoneRef with callMethod/getData/setData"
```

---

### Task 6: program command 接 ts/js 与 program.function

**Files:**
- Modify: `src/executable/commands/program.ts`
- Modify: `src/executable/__tests__/program.test.ts`

- [ ] **Step 1: 写新测试 cases**

在 `src/executable/__tests__/program.test.ts` 末尾追加：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { tmpdir as osTmpdir } from "node:os";
import { createStoneObject, writeServerSource } from "../../persistable";

describe("program.ts/js + program.function", () => {
  let tempRoot: string | undefined;

  function makeCtxWithPersistence(args: Record<string, unknown>, objectId: string, baseDir: string) {
    const thread: ThreadContext = {
      id: "t",
      status: "running",
      events: [],
      persistence: { baseDir, sessionId: "s1", objectId, threadId: "t" },
    };
    return { thread, args };
  }

  test("ts mode runs user code and returns _result_", async () => {
    tempRoot = await mkdtemp(pathJoin(osTmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence(
      { language: "ts", code: "_result_ = 2 + 3;" },
      "agent",
      tempRoot
    );
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("[returnValue]");
    expect(result).toContain("5");
    expect(result).toContain("[exit 0]");
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  test("ts mode injects self with stone dir", async () => {
    tempRoot = await mkdtemp(pathJoin(osTmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence(
      { language: "ts", code: "_result_ = self.dir;" },
      "agent",
      tempRoot
    );
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("agent");
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  test("function path calls registered method", async () => {
    tempRoot = await mkdtemp(pathJoin(osTmpdir(), "ooc-prog-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    await writeServerSource(
      ref,
      `export const llm_methods = { add: { fn: async (_c, { a, b }) => a + b } };`
    );

    const ctx = makeCtxWithPersistence(
      { function: "add", args: { a: 7, b: 8 } },
      "agent",
      tempRoot
    );
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("[returnValue]");
    expect(result).toContain("15");
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  test("function path errors clearly when no persistence", async () => {
    const thread: ThreadContext = { id: "t", status: "running", events: [] };
    const result = await executeProgramCommand({ thread, args: { function: "any" } });
    expect(result).toContain("无 persistence");
  });

  test("function path errors clearly when method missing", async () => {
    tempRoot = await mkdtemp(pathJoin(osTmpdir(), "ooc-prog-"));
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const ctx = makeCtxWithPersistence({ function: "nope" }, "agent", tempRoot);
    const result = await executeProgramCommand(ctx);
    expect(result).toContain("不存在");
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `bun test src/executable/__tests__/program.test.ts`
Expected: 5 new tests fail.

- [ ] **Step 3: 重构 src/executable/commands/program.ts**

整体替换 `executeProgramCommand` 函数（保留前面 KNOWLEDGE / enum / programCommand 不变），并补充 ts/function 路径：

```ts
import { deriveStoneFromThread, readServerSource } from "../../persistable";
import { executeUserCode } from "../sandbox/executor";
import { createProgramSelf } from "../server/self";
import { loadServerMethods } from "../server/loader";
```

替换函数：

```ts
const MAX_OUTPUT_BYTES = 4096;

function truncate(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_OUTPUT_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

function formatShellResult(code: string, stdout: string, stderr: string, exitCode: number): string {
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const lines = [`$ ${firstLine}`];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (stderr) lines.push("[stderr]", truncate(stderr));
  lines.push(exitCode === 124 ? "[timeout 30s]" : `[exit ${exitCode}]`);
  return lines.join("\n");
}

function formatProgramResult(
  header: string,
  stdout: string,
  returnValue: unknown,
  error?: string,
): string {
  const lines = [header];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (returnValue !== undefined) {
    const text = typeof returnValue === "string" ? returnValue : JSON.stringify(returnValue, null, 2);
    lines.push("[returnValue]", truncate(text));
  }
  if (error) {
    lines.push("[error]", truncate(error), "[exit 1]");
  } else {
    lines.push("[exit 0]");
  }
  return lines.join("\n");
}

async function runShell(code: string): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["sh", "-c", code], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
  } catch (error) {
    return `[program.shell] 启动失败: ${(error as Error).message}`;
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  const exitCode = await proc.exited;
  return formatShellResult(code, stdout, stderr, exitCode);
}

async function runUserCode(thread: ThreadContext, code: string): Promise<string> {
  const persistence = thread.persistence;
  const self = persistence ? createProgramSelf(deriveStoneFromThread(persistence), thread) : null;
  const exec = await executeUserCode(code, self);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  return formatProgramResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
}

async function runFunction(
  thread: ThreadContext,
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!thread.persistence) {
    return `[program.function] 当前线程无 persistence ref，无法调用 server 方法`;
  }
  const stoneRef = deriveStoneFromThread(thread.persistence);
  try {
    const self = createProgramSelf(stoneRef, thread);
    const returnValue = await self.callMethod(fn, args);
    return formatProgramResult(`# function: ${fn}`, "", returnValue);
  } catch (error) {
    return formatProgramResult(`# function: ${fn}`, "", undefined, (error as Error).message);
  }
}

/** 执行 program command；按 args 路由到 function / shell / ts/js。 */
export async function executeProgramCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;

  // function 模式优先
  const fn = ctx.args.function as string | undefined;
  if (typeof fn === "string" && fn.length > 0) {
    return runFunction(thread, fn, (ctx.args.args as Record<string, unknown>) ?? {});
  }

  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;

  if (language === "shell") {
    if (typeof code !== "string" || code.trim() === "") {
      return `[program.shell] 缺少 code 参数`;
    }
    return runShell(code);
  }

  if (language === "ts" || language === "typescript" || language === "js" || language === "javascript") {
    if (typeof code !== "string" || code.trim() === "") {
      return `[program.${language}] 缺少 code 参数`;
    }
    return runUserCode(thread, code);
  }

  return `[program] 未知 language="${language ?? "<undefined>"}"，支持 shell / ts / js / function`;
}
```

注意：原来"本阶段仅支持 shell"那段拒绝逻辑被替换。需要把对应单元测试也调整（"rejects non-shell language" 测试改成 "rejects unknown language"）。

- [ ] **Step 4: 同步老测试 — "rejects non-shell language" 改名**

把 `src/executable/__tests__/program.test.ts` 里：

```ts
  it("rejects non-shell language with explicit message", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "ts", code: "console.log(1)" }));
    expect(result).toContain("本阶段仅支持 language=\"shell\"");
  });
```

替换为：

```ts
  it("rejects unknown language with explicit message", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "rust", code: "fn main(){}" }));
    expect(result).toContain("未知 language");
  });
```

`makeCtx` 的 thread 没有 persistence，但 ts 路径需要 persistence 才能 self 注入。注意：`makeCtx({ language: "shell" })`（缺 code）的"rejects missing code"测试仍工作。

- [ ] **Step 5: Run all program tests + tsc**

Run: `bun test src/executable/__tests__/program.test.ts && bunx tsc --noEmit`
Expected: 全部 PASS / exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/executable/commands/program.ts src/executable/__tests__/program.test.ts
git commit -m "feat(program): support ts/js code and function path"
```

---

### Task 7: 文档同步（program.doc.js / server/index.doc.js / persistable/index.doc.js）

**Files:**
- Modify: `meta/object/executable/actions/commands/program.doc.js`
- Modify: `meta/object/executable/server/index.doc.js`
- Modify: `meta/object/persistable/index.doc.js`

- [ ] **Step 1: program.doc.js 更新"当前实现阶段"段**

在 program.doc.js 找到 "当前实现阶段" 那段，整段替换为：

```
## 当前实现阶段

当前实现支持 3 种 language + 1 种 function 路径：

- \`language="shell"\`：通过 \`sh -c\` 执行 code 字符串
  - cwd 固定为 \`process.cwd()\`，env 继承 parent process
  - 30 秒超时（exit code 124），stdout/stderr 各 4KB 截断

- \`language="ts" / "typescript" / "js" / "javascript"\`：in-process 动态 import 执行
  - 用户代码被包成 \`async function(console, self) { let _result_; ... return _result_; }\`
  - 注入的 \`self\` 是 ProgramSelf 对象：\`self.dir\` / \`self.callMethod\` / \`self.getData\` / \`self.setData\`
  - console.log/warn/error 进 result 的 [stdout] 段
  - \`_result_\` 变量进 result 的 [returnValue] 段（JSON.stringify）

- \`function="<name>"\`（不需要 language）：直接调用 server/index.ts 中 llm_methods 注册的方法
  - 等价于 \`language="ts", code="_result_ = await self.callMethod(name, args)"\`
  - 推荐用于"我已经知道方法名只想调它"的场景

## 元编程：编辑自己的 server/index.ts

你可以用 program.shell 写 \`${self.dir}/server/index.ts\`，新方法在下次调用立即生效（按 mtime 自动 reload）。

\`\`\`
open(program, language=shell, code='cat > server/index.ts <<EOF
export const llm_methods = {
  greet: {
    description: "向某人问好",
    params: [{ name: "name", type: "string", required: true }],
    fn: async (ctx, { name }) => "Hello, " + name + "!",
  },
};
EOF') → submit

open(program, function="greet", args={ name: "world" }) → submit
# returnValue 段会包含 "Hello, world!"
\`\`\`

当前不支持：
- 代码沙箱隔离（in-process 与内核共享进程）
- ui_methods 的 HTTP 暴露
- 命令白名单 / 沙箱隔离
```

- [ ] **Step 2: server/index.doc.js 更新**

把 server/index.doc.js 的 index 末尾追加：

```
## 当前实现阶段

OOC 系统在 \`program\` command 内部按需 \`import("\${stoneDir}/server/index.ts")\` 加载 \`llm_methods\`，按文件 mtime 缓存。

Agent 通过 \`program.shell\` 编辑此文件后，下一次 \`program.function\` 或 \`program.ts\` 中的 \`self.callMethod\` 会自动重新加载。

当前实现：
- 仅加载 \`export const llm_methods\`，\`ui_methods\` 暂未接 HTTP
- 方法签名：\`(ctx, args) => unknown | Promise<unknown>\`
- ctx 字段：\`ctx.self\`（dir / callMethod / getData / setData）/ \`ctx.thread\`（id / inject）

当前不实现：
- ui_methods 的 HTTP 端点暴露
- 跨 object 的 callMethod
- 方法权限控制
```

- [ ] **Step 3: persistable/index.doc.js 更新"当前实现阶段"段**

把 persistable/index.doc.js 的 "当前实现阶段" 段替换为：

```
## 当前实现阶段

当前实现覆盖：

**Stone（对象身份/数据）持久化**
- \`stones/{objectId}/.stone.json\` — metadata
- \`stones/{objectId}/self.md\` — 身份说明（读写）
- \`stones/{objectId}/readme.md\` — 对外说明（读写）
- \`stones/{objectId}/data.json\` — 属性数据（读写 + 顶层 merge）
- \`stones/{objectId}/server/index.ts\` — server 方法源码（读写）
- 其余目录（knowledge / memory / relations / client / files）仅建骨架，不读不写

**Flow（对象运行态）持久化**
- \`flows/{sessionId}/objects/{objectId}/.flow.json\` — metadata
- \`flows/{sessionId}/objects/{objectId}/threads/{threadId}/thread.json\` — 线程上下文
- \`flows/{sessionId}/objects/{objectId}/threads/{threadId}/debug/llm.input.json\` — 调用 LLM 前的输入快照
- \`flows/{sessionId}/objects/{objectId}/threads/{threadId}/debug/llm.output.json\` — LLM 返回快照

本阶段不实现 stone/flow 数据合并、多 object session 协作、跨 object talk 投递。
```

- [ ] **Step 4: 验证 doc 解析**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add meta
git commit -m "docs: document program ts/js, function path, server loader, stone persistence"
```

---

### Task 8: .gitignore + 集成测试 meta-programming

**Files:**
- Modify: `.gitignore`
- Create: `tests/integration/meta-programming.integration.test.ts`

- [ ] **Step 1: 加 .ooc-world-test 到 .gitignore**

在 .gitignore 末尾追加：

```
.ooc-world-test/
```

- [ ] **Step 2: 写集成测试**

新建 `tests/integration/meta-programming.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import { createStoneObject, readServerSource } from "../../src/persistable";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  setupTempFlow,
} from "./_fixture";
import { createFlowObject } from "../../src/persistable";
import type { ThreadContext } from "../../src/thinkable/context";

describe.skipIf(!hasLlmEnv)("integration: meta-programming", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent registers a method then calls it", async () => {
    // 同时建 stone + flow（共享 objectId="agent"）
    await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
    const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
    const root: ThreadContext = {
      id: "root",
      status: "running",
      events: [
        {
          category: "context_change",
          kind: "inject",
          text: [
            "请演示元编程能力：",
            "1) 用 program(language=shell) 写文件 ${self.dir}/server/index.ts，",
            "   注册一个 llm_method 名为 add，接收 {a, b} 两个数字，返回它们的和。",
            "   完整 code 示例：",
            "   cat > server/index.ts <<'EOF'",
            "   export const llm_methods = {",
            "     add: {",
            "       description: '两数相加',",
            "       params: [{name:'a',required:true},{name:'b',required:true}],",
            "       fn: async (_ctx, { a, b }) => a + b,",
            "     },",
            "   };",
            "   EOF",
            "   注意 cwd 是项目根目录，self.dir 是 stone 目录，所以你要先 cd 到 self.dir 或用绝对路径。",
            "   self.dir 的值在 ts 模式下能拿到，shell 里需要从外部得知。",
            "   你的 stone 目录是: " + flow.baseDir + "/stones/agent",
            "2) 用 program(function='add', args={a:7,b:8}) 调用方法",
            "3) 看到 returnValue 段后，open(end, summary='...15...') 结束",
          ].join("\n"),
        },
      ],
      activeForms: [],
      persistence: { ...flow, threadId: "root" },
    };

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    // server/index.ts 真的被写入
    const sourceText = await readServerSource({ baseDir: tempRoot, objectId: "agent" });
    expect(sourceText).toBeDefined();
    expect(sourceText).toContain("add");
    // 至少 3 次 form executed（写文件、调方法、end）
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(3);
    // summary 含 15
    expect(root.endSummary).toBeDefined();
    expect(root.endSummary).toContain("15");
  }, 240_000);
});
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore tests/integration/meta-programming.integration.test.ts
git commit -m "test(integration): meta-programming end-to-end"
```

---

### Task 9: 全量收敛验证

- [ ] **Step 1: 跑完整单元测试**

Run: `bun test src`
Expected: 全部 PASS。

- [ ] **Step 2: 跑 tsc**

Run: `bunx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 3: 跑 meta-programming 集成测试**

Run: `bun --env-file=.env test tests/integration/meta-programming.integration.test.ts`
Expected: PASS（≤3 分钟）。如果失败，先看是否 Agent 走偏（prompt 不够明确），调 prompt 后重试。

- [ ] **Step 4: 提交收敛 commit（若有）**

无新增改动则跳过。

---

## Self-Review

- **Spec coverage**：spec 8 个章节全部映射到 task。
- **Placeholder scan**：无 TBD/TODO。
- **Type consistency**：`StoneObjectRef` / `LlmMethods` / `ProgramSelf` / `ServerMethodContext` / `ProgramExecutionResult` 在所有 task 中保持一致名称与签名。
- **Test 覆盖**：persistable + server-loader + sandbox + server-self + program command 各有单元测试；meta-programming 端到端 1 个集成测试。
