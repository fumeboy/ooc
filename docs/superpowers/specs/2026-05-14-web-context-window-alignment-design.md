# Web ContextWindow Alignment Design

**日期：** 2026-05-14

## 目标

把 `web/` 前端的 chat 模型、tool 卡片渲染、与新增的 ContextWindow 抽象对齐。

具体来说：

1. `ThreadContext` 前端类型补 `contextWindows` 字段，能解析后端返回的新 shape
2. tool 卡片识别新 close 协议（`window_id` 替代 `form_id`）；refine/submit 仍用 form_id（其实是 command_exec 的 window id）
3. 新增 `ContextWindowsPanel` 组件，在 chat panel 内可视化当前 thread 持有的 windows（root / command_exec / do / todo）

## 背景

后端 Step 1 重构后 `thread.json` 的 shape：

```ts
type ThreadContext = {
  id: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  events: ProcessEvent[];
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  contextWindows: ContextWindow[];  // 新增
  // ...其它
};

type ContextWindow =
  | RootWindow
  | CommandExecWindow      // command_exec form
  | DoWindow               // 父侧或 creator 对话窗口
  | TodoWindow;
```

前端目前的 `ThreadContext` 只有 `events` 与 `inbox`，对 `contextWindows` 完全无感。

`open` 工具 LLM 调用时新参数：`title` + `command` + `args` + 可选 `parent_window_id`；`close` 现在用 `window_id`。formatter 对 close 仍读 `form_id`，会缺失。

## 设计

### 1. 类型补全

`web/src/domains/chat/model.ts`：

```ts
export type ThreadMessage = {
  id?: string;
  fromThreadId?: string;
  toThreadId?: string;
  content?: string;
  createdAt?: number;
  source?: string;
};

export type ContextWindow =
  | { id: string; type: "root"; title: string; status: string; createdAt?: number }
  | {
      id: string;
      type: "command_exec";
      parentWindowId: string;
      title: string;
      status: "open" | "executing" | "executed";
      command: string;
      description?: string;
      accumulatedArgs?: Record<string, unknown>;
      commandPaths?: string[];
      result?: string;
    }
  | {
      id: string;
      type: "do";
      parentWindowId?: string;
      title: string;
      status: "running" | "archived";
      targetThreadId: string;
      isCreatorWindow?: boolean;
    }
  | {
      id: string;
      type: "todo";
      parentWindowId?: string;
      title: string;
      status: "open" | "done";
      content: string;
      onCommandPath?: string[];
    };

export type ThreadContext = {
  id: string;
  status?: string;
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  events?: unknown[];
  contextWindows?: ContextWindow[];
};
```

### 2. tool 卡片协议升级

formatter `buildToolSummaryFields` 对 close 做兼容读取：

```ts
if (toolName === "close") {
  const windowId = asDisplayText(argumentsValue.window_id) ?? asDisplayText(argumentsValue.form_id);
  if (windowId) fields.push({ label: "window", value: windowId });
}
```

open 卡片的字段也补 `parent_window_id`、`title`、`args`：

```ts
if (toolName === "open") {
  const parent = asDisplayText(argumentsValue.parent_window_id);
  if (parent) fields.push({ label: "parent", value: parent });
  const command = asDisplayText(argumentsValue.command);
  if (command) fields.push({ label: "command", value: command });
  if (isRecord(argumentsValue.args)) {
    for (const [k, v] of Object.entries(argumentsValue.args)) {
      const text = asDisplayText(v);
      if (text) fields.push({ label: k, value: text });
    }
  }
}
```

### 3. ContextWindowsPanel

新增 `web/src/domains/chat/components/ContextWindowsPanel.tsx`，在 ChatPanel 内（chat-timeline 之前）以可折叠区域展示：

- 每个 window 一行：图标 + type + title + status badge
- command_exec 展开后显示：command + accumulatedArgs + result (executed)
- do 展开后显示：targetThreadId + isCreatorWindow 标记
- todo 展开后显示：content + onCommandPath
- 复用现有 tui-* 样式，不新增 CSS

集成到 ChatPanel，放在 chat-timeline 之前作为"当前 window 状态"摘要。

### 4. ThreadContext 类型反向兼容

`fetchThread` 返回的 JSON 可能还携带旧字段（`activeForms` 等），前端类型用 optional 处理；formatter 不再读 activeForms，新 panel 只读 contextWindows。

## 实施范围

只做 4 个文件的修改：

- `web/src/domains/chat/model.ts` — 类型扩展
- `web/src/domains/chat/formatter.ts` — close/open 字段
- `web/src/domains/chat/components/ContextWindowsPanel.tsx` — 新组件
- `web/src/domains/chat/components/ChatPanel.tsx` — 集成 panel

## 不在范围内

- 服务端协议变更
- 新 window 类型（talk/program/file/knowledge）的可视化（Step 2 后再做）
- 现有 TuiBlock 测试调整（除非 tsc fail）
