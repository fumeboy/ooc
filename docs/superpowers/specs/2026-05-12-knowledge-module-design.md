# OOC Object Knowledge Module Design

**Date:** 2026-05-12
**Scope:** 实现单 object 阶段的 knowledge 模块：自动激活 + 手动 pin + 热重载。

---

## 背景

`meta/object/thinkable/knowledge/index.doc.js` 已经定义 knowledge 模型："每篇 knowledge = markdown 文档 + yaml frontmatter"。当前 `src/` 里有几个待填充的字段（`thread.activatedKnowledge` / `pinnedKnowledge` / `form.loadedKnowledgePaths`），但没有任何加载、激活、渲染逻辑——LLM 看不到任何 knowledge。

本设计补齐：
1. 加载 + frontmatter 解析（扫 `stone/knowledge/` 下 .md）
2. 自动激活（按 form 的 commandPath 匹配 `activates_on`）
3. context 渲染（注入到 system XML，分 description-only / full content 两档）
4. 手动 pin（`open(type=knowledge)` / `close(type=knowledge)` 显式加载/卸载）
5. 热重载（Agent 修改 .md 后下一轮立即生效，mtime cache）

**非目标**：跨线程继承、kernel built-in knowledge、flow 第二来源、版本化。详见 §VIII。

---

## 关键设计决策

### 决策 1：每轮 think 懒求值，无快照字段

`buildContext` 每轮调用 `activator(thread, index)`：
1. 收集所有 activeForms 的 commandPaths（去重）
2. 加上 `thread.pinnedKnowledge`
3. 扫 knowledge 索引找匹配项
4. 渲染成 `<active_knowledge>` XML

`thread` 上**不**新增"当前激活了什么"的状态字段——状态完全派生。

理由：
- "form 关闭自动卸载"在懒求值下是隐式后果（form 没了 → commandPath 没了 → 不激活），无需专门卸载逻辑
- Agent 编辑 knowledge .md 后下一轮立即生效，无需手动失效快照
- 多 form 自动 union 激活集合，无需手动合并

### 决策 2：knowledge ID = `knowledge/` 相对路径不带 `.md`

例：`build-tools/file-ops`、`api/openai`、`memory/index`

理由：
- 与文件系统结构 1:1 映射，无歧义
- 支持子目录组织（文档约定允许多级）
- frontmatter 的 `filename` 字段作为文档化值，**如不一致以文件路径为准**

### 决策 3：删除 `thread.activatedKnowledge` 字段

懒求值设计下该字段是派生状态，违反 SSoT。`thread.pinnedKnowledge` 保留作为手动 pin 的真值来源。

现有 `open(type=knowledge)` 同时写两个字段的代码改为只写 `pinnedKnowledge`。

### 决策 4：close 工具加 `type="knowledge"` 分支

与 open 的 `type=command/knowledge/file` 三分对称。close 当前只认 `form_id`，扩展后：
- `close(form_id=X)`：现有 form 关闭逻辑
- `close(type="knowledge", path=X)`：从 `thread.pinnedKnowledge` 移除 path

### 决策 5：渲染上限

- 单篇 full content：8KB 截断（与 program output 截断对齐）
- 激活集合总数：> 20 项时只取前 20，inject 一条 warning

避免 context 爆炸。这两个数值经验取值，后续可调。

### 决策 6：YAML parser 用 `js-yaml`

理由：
- 手写 yaml 解析容易踩边界 case（multi-line strings, anchors, etc.）
- js-yaml 是事实标准（~30KB），加 1 个依赖换稳定性值得
- 已有 `bun add js-yaml` 路径

### 决策 7：activates_on 匹配规则 = 字符串集合相交

commandPaths 已经是完整点分路径（如 `talk.continue`），不做前缀匹配。

```
union ∩ doc.activates_on.show_content_when ≠ ∅  →  full
union ∩ doc.activates_on.show_description_when ≠ ∅  →  summary
两者都命中：full 优先
都不命中：不激活
```

手动 pin 总是 full，覆盖 activates_on 规则。

---

## I. 数据类型（src/thinkable/knowledge/types.ts）

```ts
/** knowledge 文档的 yaml frontmatter 形式。所有字段可选（缺失时按默认值处理）。 */
export interface KnowledgeFrontmatter {
  filename?: string;
  title?: string;
  description?: string;
  activates_on?: {
    show_description_when?: string[];
    show_content_when?: string[];
  };
}

/** 解析后的单篇 knowledge 文档。 */
export interface KnowledgeDoc {
  /** 相对 knowledge/ 的 ID 路径（不含 .md），如 "build-tools/file-ops"。 */
  path: string;
  /** 物理绝对路径，用于 mtime 检查。 */
  file: string;
  /** 解析后的 frontmatter；缺失字段保持 undefined，由消费者决定默认值。 */
  frontmatter: KnowledgeFrontmatter;
  /** markdown 正文（不含 frontmatter）。 */
  body: string;
  /** 文件 mtimeMs，用于热重载判定。 */
  mtime: number;
}

/** loader 返回的索引。 */
export interface KnowledgeIndex {
  /** path -> doc。 */
  byPath: Map<string, KnowledgeDoc>;
}

/** 激活器输出的单条结果。 */
export interface ActivationResult {
  /** 命中的 knowledge path。 */
  path: string;
  /** 渲染形态：summary 只渲 description，full 渲完整 body。 */
  presentation: "summary" | "full";
  /** 引用：渲染时直接读 doc。 */
  doc: KnowledgeDoc;
  /** 命中原因，供调试 / inject 注释（这一阶段先不暴露给 LLM）。 */
  reason: "pinned" | "command_path_full" | "command_path_summary";
}
```

---

## II. parser（src/thinkable/knowledge/parser.ts）

```ts
import yaml from "js-yaml";

/** 把 .md 文本拆成 frontmatter 与 body。 */
export function parseKnowledgeFile(text: string): {
  frontmatter: KnowledgeFrontmatter;
  body: string;
} {
  // 没有 frontmatter 时，整体作为 body
  if (!text.startsWith("---\n")) {
    return { frontmatter: {}, body: text };
  }
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, body: text };
  }
  const fmText = text.slice(4, end);
  const body = text.slice(end + 5);
  let frontmatter: KnowledgeFrontmatter = {};
  try {
    const parsed = yaml.load(fmText);
    if (parsed && typeof parsed === "object") {
      frontmatter = parsed as KnowledgeFrontmatter;
    }
  } catch {
    // yaml 损坏 → 退回到空 frontmatter，body 仍然可用
  }
  return { frontmatter, body };
}
```

边界：
- 没有 frontmatter（无 `---` 起始）→ 整篇当 body
- frontmatter 没有闭合（找不到第二个 `---`）→ 整篇当 body
- yaml 语法错 → frontmatter 退回 `{}`，不抛出

**不**做的事：不校验 frontmatter 字段类型；activator 消费时按可选字段处理。

---

## III. loader（src/thinkable/knowledge/loader.ts）

```ts
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { knowledgeDir, type StoneObjectRef } from "../../persistable";
import { parseKnowledgeFile } from "./parser";
import type { KnowledgeDoc, KnowledgeIndex } from "./types";

/** 内部 cache：stoneDir → { 索引 + 上次扫描时各文件 mtime 集合 }。 */
const cache = new Map<string, { index: KnowledgeIndex; signature: string }>();

/**
 * 加载 stone 的 knowledge 索引。
 * - 第一次：递归扫 knowledge/，解析所有 .md
 * - 后续：用目录 + 文件 mtime 组成 signature，未变即返回缓存
 *
 * memory/ 和 relations/ 也是 knowledge 的一部分，本阶段一并扫，按相对路径作为 ID。
 */
export async function loadKnowledgeIndex(ref: StoneObjectRef): Promise<KnowledgeIndex> {
  const root = knowledgeDir(ref);
  // collectMdFiles 返回所有 .md 路径 + 它们的 mtime
  const files = await collectMdFiles(root);
  const signature = files.map((f) => `${f.path}@${f.mtime}`).sort().join("|");
  const cached = cache.get(root);
  if (cached && cached.signature === signature) {
    return cached.index;
  }

  const byPath = new Map<string, KnowledgeDoc>();
  for (const f of files) {
    const text = await readFile(f.path, "utf8");
    const { frontmatter, body } = parseKnowledgeFile(text);
    const rel = relative(root, f.path).replace(/\.md$/, "");
    const idPath = rel.split(/[\\/]/).join("/"); // 统一斜杠
    byPath.set(idPath, {
      path: idPath,
      file: f.path,
      frontmatter,
      body,
      mtime: f.mtime,
    });
  }

  const index: KnowledgeIndex = { byPath };
  cache.set(root, { index, signature });
  return index;
}

/** 测试钩子。 */
export function clearKnowledgeLoaderCache(): void {
  cache.clear();
}

async function collectMdFiles(root: string): Promise<Array<{ path: string; mtime: number }>> {
  const result: Array<{ path: string; mtime: number }> = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const s = await stat(p);
        result.push({ path: p, mtime: s.mtimeMs });
      }
    }
  }
  await walk(root);
  return result;
}
```

性能：
- 第一次扫：N 个文件 × 一次 readFile + 一次 yaml.load。10 个文件级别，亚 100ms
- 后续：仅 N 次 stat + 字符串签名比较。亚 ms

---

## IV. activator（src/thinkable/knowledge/activator.ts）

```ts
import type { ThreadContext } from "../context";
import type { KnowledgeIndex, ActivationResult } from "./types";

const MAX_RESULTS = 20;

/** 计算激活集合。返回顺序：pinned 优先 → command_path_full → command_path_summary。 */
export function computeActivations(
  thread: ThreadContext,
  index: KnowledgeIndex
): ActivationResult[] {
  // 1) 收集所有 activeForms 的 commandPaths 与 thread.pinnedKnowledge
  const union = new Set<string>();
  for (const f of thread.activeForms ?? []) {
    for (const p of f.commandPaths) union.add(p);
  }
  const pinned = new Set(thread.pinnedKnowledge ?? []);

  const seen = new Set<string>();
  const out: ActivationResult[] = [];

  // 2) pinned 优先输出，强制 full
  for (const path of pinned) {
    const doc = index.byPath.get(path);
    if (!doc) continue; // 不存在的 pin 静默忽略
    seen.add(path);
    out.push({ path, presentation: "full", doc, reason: "pinned" });
  }

  // 3) 自动激活：先 full，再 summary，避免同篇先 summary 后被 full 覆盖时顺序混乱
  const fullCandidates: ActivationResult[] = [];
  const summaryCandidates: ActivationResult[] = [];
  for (const doc of index.byPath.values()) {
    if (seen.has(doc.path)) continue;
    const on = doc.frontmatter.activates_on;
    if (!on) continue;
    const fullHit = (on.show_content_when ?? []).some((p) => union.has(p));
    if (fullHit) {
      fullCandidates.push({ path: doc.path, presentation: "full", doc, reason: "command_path_full" });
      continue;
    }
    const summaryHit = (on.show_description_when ?? []).some((p) => union.has(p));
    if (summaryHit) {
      summaryCandidates.push({ path: doc.path, presentation: "summary", doc, reason: "command_path_summary" });
    }
  }
  out.push(...fullCandidates, ...summaryCandidates);

  // 4) 上限保护
  return out.slice(0, MAX_RESULTS);
}
```

---

## V. context 渲染（修改 src/thinkable/context.ts）

### 删除字段

```ts
// 删
activatedKnowledge?: string[];
```

`pinnedKnowledge` 保留。

### buildContext 改造

```ts
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  let knowledgeXml = "";
  if (thread.persistence) {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const index = await loadKnowledgeIndex(stoneRef).catch(() => null);
    if (index) {
      const activations = computeActivations(thread, index);
      knowledgeXml = renderActiveKnowledge(activations);
    }
  }

  const content = [
    "<context>",
    `<thread id="${escapeXml(thread.id)}" status="${escapeXml(thread.status)}">`,
    renderOptionalTag("creator_thread_id", thread.creatorThreadId),
    renderOptionalTag("parent_thread_id", thread.parentThreadId),
    renderOptionalTag("plan", thread.plan),
    renderActiveForms(thread.activeForms),
    knowledgeXml,                            // ← 新
    renderMessages("inbox", thread.inbox),
    renderMessages("outbox", thread.outbox),
    "</thread>",
    "</context>"
  ].join("");
  // ... 后续不变
}
```

### renderActiveKnowledge

```ts
const MAX_KNOWLEDGE_BYTES = 8192;

function truncateKnowledge(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= MAX_KNOWLEDGE_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_KNOWLEDGE_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

function renderActiveKnowledge(activations: ActivationResult[]): string {
  if (activations.length === 0) return "";
  const items = activations.map((a) => {
    const desc = a.doc.frontmatter.description ?? "";
    const descXml = desc ? `<description>${escapeXml(desc)}</description>` : "";
    const contentXml = a.presentation === "full"
      ? `<content>${escapeXml(truncateKnowledge(a.doc.body))}</content>`
      : "";
    return [
      `<knowledge path="${escapeXml(a.path)}" presentation="${a.presentation}">`,
      descXml,
      contentXml,
      "</knowledge>"
    ].join("");
  }).join("");
  return `<active_knowledge>${items}</active_knowledge>`;
}
```

---

## VI. 手动 pin 通道改造

### open 工具（src/executable/tools/open.ts）

把现有的：

```ts
thread.activatedKnowledge = pushUnique(thread.activatedKnowledge, path);
thread.pinnedKnowledge = pushUnique(thread.pinnedKnowledge, path);
```

改成：

```ts
thread.pinnedKnowledge = pushUnique(thread.pinnedKnowledge, path);
```

（删除对已删字段 activatedKnowledge 的写入。）

### close 工具（src/executable/tools/close.ts）扩展

在现有 form_id 分支前加 type=knowledge 分支：

```ts
const type = args.type as string | undefined;
if (type === "knowledge") {
  const path = args.path as string;
  if (!path) {
    inject `[错误] close(type=knowledge) 缺少 path 参数`;
    return;
  }
  const before = thread.pinnedKnowledge ?? [];
  if (!before.includes(path)) {
    inject `[提示] knowledge ${path} 未被 pin，无需 close`;
    return;
  }
  thread.pinnedKnowledge = before.filter(p => p !== path);
  inject `[close] knowledge ${path} 已卸载`;
  return;
}
// 后续保持现有 form_id 分支
```

### close 工具 schema 更新

`required` 字段从 `["form_id", "reason"]` 改为 `["reason"]`，并把 form_id / type / path 标为可选（含校验逻辑）。提示 LLM 二选一调用。

---

## VII. 文件改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `package.json` | Modify | 加 `js-yaml` 依赖（+ `@types/js-yaml`）|
| `src/thinkable/knowledge/types.ts` | Create | 数据类型 |
| `src/thinkable/knowledge/parser.ts` | Create | frontmatter 解析 |
| `src/thinkable/knowledge/loader.ts` | Create | mtime cache 索引 |
| `src/thinkable/knowledge/activator.ts` | Create | 激活集合计算 |
| `src/thinkable/knowledge/index.ts` | Create | re-export |
| `src/thinkable/knowledge/__tests__/parser.test.ts` | Create | parser 单测 |
| `src/thinkable/knowledge/__tests__/loader.test.ts` | Create | loader + 热重载 单测 |
| `src/thinkable/knowledge/__tests__/activator.test.ts` | Create | 激活逻辑单测 |
| `src/thinkable/context.ts` | Modify | 删 activatedKnowledge 字段；buildContext 调 activator；加 renderActiveKnowledge |
| `src/thinkable/__tests__/context.test.ts` | Modify | 加 active_knowledge 渲染断言 |
| `src/executable/tools/open.ts` | Modify | 删 activatedKnowledge 写入 |
| `src/executable/tools/close.ts` | Modify | 加 type=knowledge 分支；schema 更新 |
| `src/executable/__tests__/tools.test.ts` | Modify | 加 close(type=knowledge) 单测 |
| `meta/object/thinkable/knowledge/index.doc.js` | Modify | 加 sources 绑定 + "当前实现阶段" 段 |
| `tests/integration/knowledge-activation.integration.test.ts` | Create | 端到端：写一篇 knowledge → open program form → context 中看到 knowledge → submit 后下一轮 form 没了 knowledge 也不再激活 |

---

## VIII. 非目标

- **跨线程继承**：子线程 context 含父链激活的 knowledge。需要 buildContext 沿 parent 链聚合，属多线程语义重构，单独一轮做。
- **kernel built-in knowledge**：OOC 系统自带的通用 knowledge（如 program/shell 速查表）。涉及"哪些算系统内置、谁维护、版本怎么管"独立设计题。
- **flow 第二来源**：`flow/.../knowledge/` 在 stone 之上叠加；stone 已经够单 object 用。
- **knowledge 版本化 / git 历史**：等真有需求再讨论。
- **summary 与 full 之间的"intermediate"档**：保持二档，避免过度设计。
- **activates_on 之外的激活条件**（如基于 thread.status、events 内容）：当前只支持 commandPath 字符串集合相交。

---

## IX. 自检（按 goal.md）

| 问题 | 答案 |
|---|---|
| 它在新系统里为什么存在 | LLM 不能预知所有 API；按当前手头任务动态拉相关知识进 context 是文档"渐进式披露"机制的核心 |
| 最小职责是什么 | parser：拆 yaml + body；loader：扫盘 + cache；activator：集合相交 + 排序；renderer：拼 XML |
| 边界几句话说清 | 只读 stone/knowledge/；只 .md + yaml frontmatter；激活仅基于 commandPath 字符串集合相交；上限 20 项 / 单篇 8KB |
| 依赖哪些模块 | js-yaml（新增）/ 已有 persistable.knowledgeDir / 已有 thread.activeForms / persistence |
| 暂不迁会失去什么 | 没 knowledge → 渐进式披露形同虚设，所有 command 必须靠 prompt 描述能力，难以扩展 |
| 迁入后系统更简单还是更复杂 | 简单：删了 activatedKnowledge 字段；引入的 5 个文件每个 ≤ 150 行；激活逻辑就是集合相交，无状态 |

---

## X. 实施顺序建议

1. **依赖与类型** — 加 js-yaml；写 types.ts
2. **parser** + 单测（frontmatter 边界 case：缺失/损坏/正常）
3. **loader** + 单测（首次扫描 / mtime 缓存 / 热重载）
4. **activator** + 单测（pinned / full / summary / 集合相交 / 上限）
5. **context 渲染** —— 删字段，buildContext 接 activator，加 renderActiveKnowledge；修受影响测试
6. **open/close 工具改造** + 单测
7. **文档同步**：knowledge/index.doc.js 加 sources + 当前实现阶段
8. **集成测试**：knowledge-activation 端到端
9. **最终验证**：bun test src + tsc + 集成测试
