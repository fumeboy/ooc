# Context XML Serializer And Program Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 调整 `program` 的 executing/executed knowledge 表述，并将 `context/knowledge.ts` 合并到 `context/render.ts`，改为支持缩进和 XML 注释的标准序列化渲染。

**Architecture:** `program` command 只修改 knowledge 文案，使其在脱离 `<form>` 上下文时仍然语义完整。`render.ts` 升级为统一 XML 渲染器：先构建轻量 XML 节点树，再用 serializer 统一输出缩进良好的 XML 文本，并把原 `knowledge.ts` 的 active knowledge 渲染逻辑并入其中。

**Tech Stack:** TypeScript, Bun, 当前 OOC thinkable/executable/context 架构

---

## File Map

- Modify: `src/executable/commands/program.ts`
- Modify: `src/thinkable/context/render.ts`
- Modify: `src/thinkable/context/index.ts`
- Delete: `src/thinkable/context/knowledge.ts`
- Test: `src/executable/__tests__/commands.test.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

### Task 1: 锁定 program knowledge 文案

**Files:**
- Modify: `src/executable/__tests__/commands.test.ts`
- Modify: `src/executable/commands/program.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("should describe program executing/executed knowledge without relying on inline form wording", () => {
  expect(
    programCommand.knowledge?.({ language: "shell", code: "ls" }, "executing")?.["internal/executable/program/form-status"]
  ).toContain("对于 command program 的 executing 状态的 form");

  expect(
    programCommand.knowledge?.({ function: "readFile", args: { path: "a" } }, "executed")?.["internal/executable/program/form-status"]
  ).toContain("对于 command program 的 executed 状态的 form");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/executable/__tests__/commands.test.ts`
Expected: FAIL，当前文案仍是“该 form ...”

- [ ] **Step 3: 最小实现**

```ts
entries[PROGRAM_FORM_STATUS_PATH] =
  "对于 command program 的 executing 状态的 form，应等待 result 写入后再继续，不要再次 refine 或 submit。";
```

```ts
entries[PROGRAM_FORM_STATUS_PATH] =
  "对于 command program 的 executed 状态的 form，应先阅读 result；如果结果已经消费，使用 close(form_id, reason=...) 释放 form。";
```

- [ ] **Step 4: 重新运行测试，确认转绿**

Run: `bun test src/executable/__tests__/commands.test.ts`
Expected: PASS

### Task 2: 用标准 serializer 重构 context XML 渲染

**Files:**
- Modify: `src/thinkable/__tests__/context.test.ts`
- Modify: `src/thinkable/context/render.ts`
- Modify: `src/thinkable/context/index.ts`
- Delete: `src/thinkable/context/knowledge.ts`

- [ ] **Step 1: 写失败测试，锁定缩进与 XML 注释**

```ts
it("renders indented xml with comments for active forms and knowledge entries", async () => {
  const messages = await buildContext({
    id: "t_comment",
    status: "running",
    events: [],
    activeForms: [{
      formId: "f_1",
      command: "program",
      description: "shell",
      createdAt: 1,
      accumulatedArgs: { language: "shell", code: "ls" },
      commandPaths: ["program", "program.shell"],
      loadedKnowledgePaths: [],
      status: "open"
    }]
  });

  const xml = messages[0]?.content ?? "";
  expect(xml).toContain("<!-- active forms -->");
  expect(xml).toContain("<!-- executable knowledge entries -->");
  expect(xml).toContain("\n  <thread ");
  expect(xml).toContain("\n    <active_forms>");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL，当前输出没有 XML 注释，也没有统一缩进

- [ ] **Step 3: 最小实现 serializer 和节点模型**

```ts
type XmlNode =
  | { kind: "element"; tag: string; attrs?: Record<string, string>; children?: XmlNode[] }
  | { kind: "text"; value: string }
  | { kind: "comment"; value: string };
```

```ts
function serializeXml(node: XmlNode, depth = 0): string {
  // 统一缩进、属性转义、注释输出
}
```

```ts
export async function computeKnowledgeXml(thread: ThreadContext): Promise<string> {
  // 从 knowledge.ts 移入 render.ts，并返回 serializer 输出
}
```

- [ ] **Step 4: 重新运行 context 测试，确认转绿**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: PASS

### Task 3: 清理合并后的入口并做最终验证

**Files:**
- Modify: `src/thinkable/context/index.ts`
- Delete: `src/thinkable/context/knowledge.ts`
- Test: `src/executable/__tests__/commands.test.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 更新 `context/index.ts` 导入，移除对 `knowledge.ts` 的依赖**

```ts
import { computeKnowledgeXml, renderActiveForms, renderKnowledgeEntries, ... } from "./render";
```

- [ ] **Step 2: 删除 `src/thinkable/context/knowledge.ts`**

Expected: 相关引用全部转到 `render.ts`

- [ ] **Step 3: 跑针对性测试**

Run: `bun test src/executable/__tests__/commands.test.ts src/thinkable/__tests__/context.test.ts`
Expected: PASS

- [ ] **Step 4: 跑类型检查**

Run: `bunx tsc --noEmit`
Expected: exit 0
