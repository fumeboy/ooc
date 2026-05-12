# Executable Context Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把执行协议知识从 `context` 推断层迁移到 `executable` 子系统，删除 `protocol.ts`，并将 command knowledge 统一收敛到 `<knowledge>` 区域展示。

**Architecture:** `buildContext()` 继续负责主干编排，但不再生成业务协议。`src/executable/index.ts` 提供全局基础知识，`CommandTableEntry.knowledge(args, formStatus)` 提供 command-specific knowledge map，context 只展示 form 关联的 knowledge path 与去重后的 knowledge entries。

**Tech Stack:** TypeScript, Bun, Elysia, 当前 OOC executable/form/context 架构

---

## File Map

- Create: `src/executable/index.ts`
- Modify: `src/executable/commands/types.ts`
- Modify: `src/executable/commands/program.ts`
- Modify: `src/executable/forms/form.ts`
- Modify: `src/executable/server/enrich.ts`
- Modify: `src/thinkable/context/index.ts`
- Modify: `src/thinkable/context/render.ts`
- Delete: `src/thinkable/context/protocol.ts`
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/executable/__tests__/server-enrich.test.ts`
- Test: `src/executable/__tests__/commands.test.ts`

### Task 1: 锁定 context 新输出结构

**Files:**
- Modify: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，移除旧 protocol 断言并新增 knowledge path / knowledge entries 断言**

```ts
it("renders command knowledge paths on forms and knowledge entries in knowledge area", async () => {
  const thread: ThreadContext = {
    id: "t_protocol",
    status: "running",
    events: [],
    activeForms: [
      {
        formId: "f_program_open",
        command: "program",
        description: "写 server 文件",
        createdAt: 1,
        accumulatedArgs: {},
        commandPaths: ["program"],
        loadedKnowledgePaths: [],
        commandKnowledgePaths: ["internal/executable/program/base"],
        status: "open"
      }
    ]
  };

  const messages = await buildContext(thread);
  const xml = messages[0]?.content ?? "";

  expect(xml).not.toContain("<next_action>");
  expect(xml).not.toContain("<protocol_hint>");
  expect(xml).toContain("<command_knowledge_paths>");
  expect(xml).toContain("<path>internal/executable/program/base</path>");
  expect(xml).toContain('path="internal/executable/base"');
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL，提示仍然输出 `<next_action>` / `<protocol_hint>`，且缺少新的 `command_knowledge_paths` / `knowledge entries`

- [ ] **Step 3: 最小实现 context 渲染结构**

```ts
// render.ts
const commandKnowledgePaths = form.commandKnowledgePaths?.length
  ? `<command_knowledge_paths>${form.commandKnowledgePaths
      .map((path) => `<path>${escapeXml(path)}</path>`)
      .join("")}</command_knowledge_paths>`
  : "";
```

```ts
// 删除 next_action / protocol_hint / method_knowledge 渲染
```

- [ ] **Step 4: 重新运行 context 测试，确认转绿**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: PASS

### Task 2: 建立 executable 全局基础知识入口

**Files:**
- Create: `src/executable/index.ts`
- Modify: `src/thinkable/context/index.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，要求 buildContext 总是注入 executable 基础知识**

```ts
it("always injects executable basic knowledge into system context", async () => {
  const messages = await buildContext({ id: "t1", status: "running", events: [] });
  const xml = messages[0]?.content ?? "";
  expect(xml).toContain("open / refine / submit / close / wait");
});
```

- [ ] **Step 2: 运行单测，确认失败**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL，system context 中还没有 executable 基础知识

- [ ] **Step 3: 新增 `src/executable/index.ts` 并接入 `buildContext()`**

```ts
export const KNOWLEDGE = `
你通过 open / refine / submit / close / wait 五个执行原语行动。
refine 用于累积参数，不会执行。
submit 用于真正执行 command form。
executing 状态表示 form 正在执行，不要再次 refine / submit。
executed 状态表示 form 已有 result，应阅读结果后 close(form_id) 释放 form。
若当前没有可继续的执行动作且需要等待外部输入，使用 wait(reason="...")。
`;
```

```ts
const executableKnowledgeXml = `<knowledge_entries><knowledge path="internal/executable/base">${escapeXml(EXECUTABLE_KNOWLEDGE)}</knowledge></knowledge_entries>`;
```

- [ ] **Step 4: 重新运行 context 测试，确认通过**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: PASS

### Task 3: 扩展 command knowledge 接口与 form 模型

**Files:**
- Modify: `src/executable/commands/types.ts`
- Modify: `src/executable/forms/form.ts`
- Test: `src/executable/__tests__/commands.test.ts`
- Test: `src/executable/__tests__/forms.test.ts`

- [ ] **Step 1: 写失败测试，要求 command 条目可导出 dynamic knowledge，form 可记录 `commandKnowledgePaths`**

```ts
expect(programCommand.knowledge?.({}, "open")).toEqual(
  expect.objectContaining({
    "internal/executable/program/base": expect.any(String)
  })
);
```

```ts
expect(restored.commandKnowledgePaths).toEqual(["internal/executable/program/base"]);
```

- [ ] **Step 2: 运行相关测试，确认失败**

Run: `bun test src/executable/__tests__/commands.test.ts src/executable/__tests__/forms.test.ts`
Expected: FAIL，`knowledge` 接口不存在，`commandKnowledgePaths` 未定义

- [ ] **Step 3: 最小修改类型与 form 模型**

```ts
knowledge?: (
  args: Record<string, unknown>,
  formStatus: "open" | "executing" | "executed"
) => Record<string, string>;
```

```ts
commandKnowledgePaths?: string[];
```

- [ ] **Step 4: 运行 commands/forms 测试，确认基础类型链路通过**

Run: `bun test src/executable/__tests__/commands.test.ts src/executable/__tests__/forms.test.ts`
Expected: PASS 或仅剩 program enrich 相关红灯

### Task 4: 让 program command 产出 knowledge map

**Files:**
- Modify: `src/executable/commands/program.ts`
- Test: `src/executable/__tests__/commands.test.ts`

- [ ] **Step 1: 写失败测试，要求 program 在不同 args / formStatus 下生成不同 knowledge**

```ts
it("program knowledge returns missing-args guidance for open form", () => {
  const out = programCommand.knowledge?.({}, "open") ?? {};
  expect(out["internal/executable/program/base"]).toContain("缺少 language/code");
});
```

```ts
it("program knowledge returns executing guidance for executing form", () => {
  const out = programCommand.knowledge?.({ language: "shell", code: "ls" }, "executing") ?? {};
  expect(out["internal/executable/program/form-status"]).toContain("正在执行");
});
```

- [ ] **Step 2: 运行命令测试，确认失败**

Run: `bun test src/executable/__tests__/commands.test.ts`
Expected: FAIL，`programCommand.knowledge` 尚未实现

- [ ] **Step 3: 实现 `programCommand.knowledge(args, formStatus)`**

```ts
knowledge: (args, formStatus) => {
  const out: Record<string, string> = {};
  if (formStatus === "executing") {
    out["internal/executable/program/form-status"] = "该 form 正在执行；等待 result 写入后再继续，不要再次 refine 或 submit。";
    return out;
  }
  if (formStatus === "executed") {
    out["internal/executable/program/form-status"] = "先阅读 result；如果结果已经消费，使用 close(form_id, reason=...) 释放 form。";
    return out;
  }
  out["internal/executable/program/base"] = "...";
  return out;
}
```

- [ ] **Step 4: 运行 program command 测试，确认转绿**

Run: `bun test src/executable/__tests__/commands.test.ts`
Expected: PASS

### Task 5: 把 server method knowledge 合并进 program knowledge enrich

**Files:**
- Modify: `src/executable/server/enrich.ts`
- Test: `src/executable/__tests__/server-enrich.test.ts`

- [ ] **Step 1: 写失败测试，要求 enrich 后 form 记录 `commandKnowledgePaths`，且 function knowledge 被并入 program path map**

```ts
expect(result.commandKnowledgePaths).toContain("internal/executable/program/function");
```

```ts
const messages = await buildContext(threadWithForm(result));
expect(messages[0]?.content ?? "").toContain("两数相加");
```

- [ ] **Step 2: 运行 enrich 测试，确认失败**

Run: `bun test src/executable/__tests__/server-enrich.test.ts`
Expected: FAIL，仍在使用 `methodKnowledge`

- [ ] **Step 3: 将 enrich 升级为 command knowledge enrich**

```ts
const commandKnowledge = entry.knowledge?.(form.accumulatedArgs, form.status) ?? {};
const commandKnowledgePaths = Object.keys(commandKnowledge);
return { ...form, commandKnowledgePaths };
```

```ts
// program.function 模式下：
// method.knowledge(args) 的文本并入 commandKnowledge["internal/executable/program/function"]
```

- [ ] **Step 4: 重新运行 enrich 测试，确认通过**

Run: `bun test src/executable/__tests__/server-enrich.test.ts`
Expected: PASS

### Task 6: 在 context 中汇总并去重 knowledgeEntries

**Files:**
- Modify: `src/thinkable/context/index.ts`
- Modify: `src/thinkable/context/render.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，要求多个 form 共享同一路径时只渲染一次正文**

```ts
expect(xml.match(/internal\/executable\/program\/base/g)?.length).toBe(2); // 两次 path 引用
expect(xml.match(/<knowledge path="internal\/executable\/program\/base">/g)?.length).toBe(1); // 一次正文
```

- [ ] **Step 2: 运行 context 测试，确认失败**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL，当前还没有 dedupe 后的 knowledgeEntries 渲染

- [ ] **Step 3: 在 `buildContext()` 中汇总 executable knowledge**

```ts
const knowledgeEntries: Record<string, string> = {
  "internal/executable/base": EXECUTABLE_KNOWLEDGE,
  ...dedupedCommandKnowledge
};
```

```ts
renderKnowledgeEntries(knowledgeEntries);
```

- [ ] **Step 4: 重新运行 context 测试，确认通过**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: PASS

### Task 7: 删除 protocol.ts 并跑完整验证

**Files:**
- Delete: `src/thinkable/context/protocol.ts`
- Modify: `src/thinkable/context/render.ts`
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/executable/__tests__/commands.test.ts`
- Test: `src/executable/__tests__/server-enrich.test.ts`

- [ ] **Step 1: 删除 `protocol.ts` 引用与遗留逻辑**

```ts
// render.ts 删除：
import { inferNextAction, inferProtocolHint } from "./protocol";
```

- [ ] **Step 2: 跑针对性测试**

Run: `bun test src/thinkable/__tests__/context.test.ts src/executable/__tests__/commands.test.ts src/executable/__tests__/server-enrich.test.ts`
Expected: PASS

- [ ] **Step 3: 跑类型检查**

Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 最后检查诊断**

Run: IDE diagnostics on touched files
Expected: no new errors
