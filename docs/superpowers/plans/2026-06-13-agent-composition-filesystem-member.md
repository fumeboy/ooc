# Agent Composition · filesystem 成员对象 Implementation Plan

> **For agentic workers:** Increment 1 of the Object/Agent/组合 redesign（设计裁决见 `docs/2026-06-12-context-window-buffer-view-redesign.md` 与 grill 共识）。本 plan 锚定真实代码（file:line）。

**Goal:** 证明组合机制端到端：**一个 agent 类声明成员对象 → 成员作为 context window 出现在 agent context → agent exec 成员方法造出对象**。以 `filesystem` 单例成员为载体，纯加法，不碰 root god-object / agency / ROOT_WINDOW_ID 锚。

**Architecture:** filesystem 是一个新 builtin 类（seeded type），其方法**复用** root 已导出的 `grepMethod`/`globMethod`/`openFileMethod`/`writeFileMethod`（委托同样的 search/file constructor，零重写）。supervisor 类经 `ooc.members` 声明持有 filesystem。新增 `injectMemberWindowsIfObjectThread`（仿 `injectPeerWindowsIfObjectThread`）在 thread 加载时注入 member 窗；member 窗非持久化（仿 self 窗）每轮重注入。exec 路由不变（`window_id → parent.class → 方法表`），member 窗天然可 exec。

**Tech Stack:** bun runtime, TypeScript, bun:test, storybook（Tier A 确定性 + Tier B 真实 LLM agent-native）。

**Scope（本 increment 做 / 不做）：**
- ✅ 做：filesystem builtin 类 + 组合声明/注入机制 + supervisor 持有 filesystem + Tier A 确定性验证 + Tier B 真实 LLM World 体验。
- ⛔ 不做（后续 increment）：`agent` 基类 + 搬 agency 出 root；terminal/interpreter/world/knowledge 成员；拆 root god-object；ROOT_WINDOW_ID 锚迁移；member 窗 buffer/view 数据结构重构（用户已否决）。

---

## File Structure

**新建（filesystem builtin 五件套，克隆 example 模板）：**
- `packages/@ooc/builtins/filesystem/package.json` — objectId `_builtin/filesystem`, kind builtin, type object, **`ooc.members` 不在此**（成员声明在持有方 supervisor）。
- `packages/@ooc/builtins/filesystem/types.ts` — `FilesystemWindow extends BaseContextWindow { class:"filesystem"; status:"open"|"closed" }`。
- `packages/@ooc/builtins/filesystem/executable/index.ts` — `registerExecutable("filesystem", { methods: { grep, glob, open_file, write_file } })`，**复用 root 导出的 method 对象**。
- `packages/@ooc/builtins/filesystem/readable.ts` — `readable` hook（渲染身份）+ `registerReadable("filesystem", { readable })`。boot 校验要求每 type 配 readable。
- `packages/@ooc/builtins/filesystem/index.ts` — barrel side-effect。
- `packages/@ooc/builtins/filesystem/self.md` — Object 口吻身份。

**改核心（注册 + 类型 + 组合机制）：**
- `packages/@ooc/core/runtime/object-registry.ts:73-91` — `BASE_TYPE_DEFINITIONS` 加 `["filesystem", { methods: {} }]`；`:39-43` `RENDERABLE_VISIBLE_TYPES` 加 `"filesystem"`。
- `packages/@ooc/core/executable/windows/_shared/types.ts:43-99` — import + union + re-export `FilesystemWindow`。
- `packages/@ooc/core/extendable/index.ts:21-28` — 加 `import "@ooc/builtins/filesystem";`（触发注册副作用）。
- `packages/@ooc/core/_shared/types/context-window.ts:118,196` — `BaseContextWindow` 加 `isMemberWindow?: boolean`；`isNonPersistedWindow` 加 `|| window.isMemberWindow === true`。
- `packages/@ooc/core/executable/windows/_shared/init.ts` — 新增 `injectMemberWindowsIfObjectThread(thread)` + `readDeclaredMembers(ref)`。
- `packages/@ooc/core/executable/windows/index.ts:65` — re-export `injectMemberWindowsIfObjectThread`。
- 3 个 peer-注入调用点各加一行 member 注入：`talk/delivery.ts:163`、`app/server/modules/flows/service.ts:642`、`persistable/thread-json.ts:258`。

**改 supervisor 声明成员：**
- `packages/@ooc/builtins/supervisor/package.json` — `ooc.members: ["filesystem"]`。

**测试：**
- `packages/@ooc/builtins/filesystem/__tests__/filesystem.test.ts` — 注册/复用方法的单测（仿 example.test.ts）。
- `packages/@ooc/storybook/stories/class.story.ts` — 追加 TC-COMP-01..04（Tier A 确定性）+ runAgentNative 组合体验（Tier B）。

---

## Tasks

### Task 1: filesystem builtin 类（五件套 + 注册）

- [ ] **types.ts**
```ts
import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
export interface FilesystemWindow extends BaseContextWindow {
  class: "filesystem";
  status: "open" | "closed";
}
```
- [ ] **executable/index.ts**（复用 root 导出 method，零重写）
```ts
import { grepMethod } from "@ooc/builtins/root/executable/method.grep.js";
import { globMethod } from "@ooc/builtins/root/executable/method.glob.js";
import { openFileMethod } from "@ooc/builtins/root/executable/method.open-file.js";
import { writeFileMethod } from "@ooc/builtins/root/executable/method.write-file.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";

builtinRegistry.registerExecutable("filesystem", {
  methods: { grep: grepMethod, glob: globMethod, open_file: openFileMethod, write_file: writeFileMethod },
});
```
- [ ] **readable.ts**
```ts
import { builtinRegistry, type RenderContext } from "@ooc/core/extendable/_shared/registry.js";
import { xmlElement, xmlText, type XmlNode } from "@ooc/core/_shared/types/xml.js";
export function readable(_ctx: RenderContext): XmlNode[] {
  return [xmlElement("about", {}, [xmlText(
    "文件系统对象。grep/glob 查询、open_file/write_file 读写——结果作为 search/file 对象出现。",
  )])];
}
builtinRegistry.registerReadable("filesystem", { readable });
```
- [ ] **index.ts**：`import "./readable.js"; export * from "./executable/index.js"; export type * from "./types.js";`
- [ ] **package.json**（克隆 example，objectId `_builtin/filesystem`）；**self.md**（Object 口吻）。
- [ ] **核心注册**：seed BASE_TYPE_DEFINITIONS + RENDERABLE_VISIBLE_TYPES + union(types.ts) + `import "@ooc/builtins/filesystem"`（extendable/index.ts）。
- [ ] **单测**（filesystem.test.ts）断言 `getObjectDefinition("filesystem").methods.grep/glob/open_file/write_file` 存在且 `.readable` 定义。
- [ ] 跑 `bun test packages/@ooc/builtins/filesystem` → PASS；`bun run build`/typecheck 不破。

### Task 2: 组合机制（声明 + 注入 + 非持久化）

- [ ] **context-window.ts**：`BaseContextWindow` 加 `isMemberWindow?: boolean`；`isNonPersistedWindow` 改 `return window.isSelfWindow === true || window.isMemberWindow === true;`。
- [ ] **init.ts** 新增（仿 peer 注入，async）：
```ts
async function readDeclaredMembers(ref: StoneObjectRef): Promise<string[]> {
  const classId = await readStoneClass(ref);
  const cands = [ref, ...(classId ? [{ baseDir: ref.baseDir, objectId: classId }] : [])];
  for (const c of cands) {
    const dir = resolveBuiltinReadDir(c) ?? stoneDir(c);
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      const m = pkg?.ooc?.members;
      if (Array.isArray(m) && m.length) return m.filter((x): x is string => typeof x === "string");
    } catch { /* next */ }
  }
  return [];
}
export async function injectMemberWindowsIfObjectThread(thread: ThreadContext): Promise<void> {
  const p = thread.persistence; const selfId = p?.objectId;
  if (!p || !selfId || selfId === "user") return;
  let members: string[];
  try { members = await readDeclaredMembers(deriveStoneFromThread(p)); }
  catch (e) { console.debug(`[member-windows] io_error self=${selfId} msg=${(e as Error).message}`); return; }
  if (!members.length) return;
  const list = thread.contextWindows ?? (thread.contextWindows = []);
  const existing = new Set(list.map((w) => w.id));
  const now = Date.now(); const add: ContextWindow[] = [];
  for (const m of members) {
    if (existing.has(m)) continue;
    add.push({ id: m, class: m as any, parentWindowId: ROOT_WINDOW_ID, title: `member: ${m}`,
      status: "open", createdAt: now, isMemberWindow: true } as ContextWindow);
  }
  if (add.length) thread.contextWindows = [...list, ...add];
}
```
  imports 补：`readStoneClass`、`resolveBuiltinReadDir`、`stoneDir`、`StoneObjectRef`（@ooc/core/persistable）、`readFile`(node:fs/promises)、`join`(node:path)。
- [ ] **windows/index.ts:65** re-export `injectMemberWindowsIfObjectThread`。
- [ ] 3 个调用点各加 `await injectMemberWindowsIfObjectThread(<thread>);` 紧跟 peer 注入。
- [ ] **supervisor/package.json** 加 `"members": ["filesystem"]` 到 `ooc`。

### Task 3: Tier A storybook（class.story.ts 追加 TC-COMP-01..04）

确定性、零 LLM。在 `runControlPlane()` 末尾 try 内追加：
- TC-COMP-01：`getObjectDefinition("filesystem")` 含 grep/glob/open_file/write_file + readable。
- TC-COMP-02：`_builtin/filesystem` 注册 + 读 supervisor builtin package.json `ooc.members` ⊇ ["filesystem"]。
- TC-COMP-03：instantiate supervisor → 构造 supervisor thread → `await injectMemberWindowsIfObjectThread(thread)` → `thread.contextWindows.some(w => w.class==="filesystem" && w.isMemberWindow)`。
- TC-COMP-04（机制命门）：`WindowManager.fromThread(threadWithMember, builtinRegistry).openMethodExec({ thread, parentWindowId:"filesystem", method:"grep", args:{pattern:"plan", path: baseDir} })` → manager.list() 出现 `class==="search"` 窗。
- [ ] 收进 `_control-plane.test.ts`（已自动按 STORIES 跑）；`bun run test:storybook` 0 FAIL。
- [ ] `bun run verify`（或等价 typecheck+test）不回归。

### Task 4: Tier B 真实 LLM World 体验 + 迭代

- [ ] 启隔离 world：`NO_PROXY=localhost,127.0.0.1 bun run packages/@ooc/core/app/server/index.ts --world /tmp/ooc-live-<ts> --port 3000`（.env 真实 Claude proxy 自动加载）。
- [ ] `class.story.ts` 的 `runAgentNative()` 追加组合体验：派 supervisor 一个需 grep 的任务，verify 检查 execs 里对 `filesystem` 的方法调用 / 出现 search 结果。
- [ ] `RUN_STORYBOOK_AGENT=1 OOC_BACKEND=http://127.0.0.1:3000 bun run packages/@ooc/storybook/runner.ts` 观测。
- [ ] 用 `/api/runtime/activity` + `<W>/flows/.../thread.json` 观测 agent 是否发现并使用 filesystem 成员；session 用 `_test_` 前缀，验后清理。
- [ ] 据真实体验暴露的问题（可发现性 / 渲染 / 方法可调用性 / 预算）迭代修复，回归 Tier A。

---

## 验证 Gate（每步）
- `bun test packages/@ooc/builtins/filesystem`（Task 1）
- `bun run test:storybook`（Task 3，CI gate，0 FAIL）
- `bun run verify`（全量回归不破）
- Tier B：真实 world agent 能在 context 看到 filesystem 成员并调用其方法（≥OK）。
