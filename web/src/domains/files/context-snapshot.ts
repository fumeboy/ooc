/**
 * Context snapshot 解析 / 摘要 / 树形化工具。
 *
 * llm.input.json 中的 contextSnapshot 字段（与后端 src/persistable/debug-file.ts
 * 的 ContextSnapshot 同 shape）描述了某次 LLM 调用时刻的完整 thread 上下文：
 *
 *   { id, status, plan?, contextWindows[], inbox?, outbox?, events?, ... }
 *
 * 本文件把它转成树形 ViewerNode，供 ContextSnapshotViewer 渲染：
 *   thread
 *   ├── plan
 *   ├── contextWindows
 *   │   ├── <window id type status title>
 *   │   │   ├── ...type 特有字段（form: args/result；do: target+transcript；
 *   │   │   │                   talk/program/file/knowledge: 对应字段）
 *   │   │   └── sub_windows
 *   │   └── ...
 *   ├── inbox
 *   ├── outbox
 *   └── events
 *
 * 与 LLMInputJsonViewer 的旧 XML 树相比：
 * - 不再依赖 DOMParser 把 system message XML 解析回结构
 * - 字段名直接对齐后端类型；前端不需要"猜"标签语义
 */

/** 后端 src/executable/windows/types.ts ContextWindow 在前端的最小镜像。 */
export type ContextWindow =
  | { id: string; type: "root"; title: string; status?: string; createdAt?: number }
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
      loadedKnowledgePaths?: string[];
      commandKnowledgePaths?: string[];
      result?: string;
      createdAt?: number;
    }
  | {
      id: string;
      type: "do";
      parentWindowId?: string;
      title: string;
      status: "running" | "archived";
      targetThreadId: string;
      isCreatorWindow?: boolean;
      createdAt?: number;
    }
  | {
      id: string;
      type: "todo";
      parentWindowId?: string;
      title: string;
      status: "open" | "done";
      content: string;
      onCommandPath?: string[];
      createdAt?: number;
    }
  | {
      id: string;
      type: "talk";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      target: string;
      conversationId: string;
      createdAt?: number;
    }
  | {
      id: string;
      type: "program";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      history: Array<{
        execId: string;
        language: "shell" | "ts" | "js" | "function";
        code?: string;
        function?: string;
        args?: unknown;
        output: string;
        ok: boolean;
        startedAt: number;
      }>;
      createdAt?: number;
    }
  | {
      id: string;
      type: "file";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      path: string;
      lines?: [number, number];
      columns?: [number, number];
      createdAt?: number;
    }
  | {
      id: string;
      type: "knowledge";
      parentWindowId?: string;
      title: string;
      status: "open" | "closed";
      path: string;
      createdAt?: number;
    };

/** 与后端 ThreadMessage 同 shape；前端只读取关心的字段。 */
export type ThreadMessage = {
  id?: string;
  fromThreadId?: string;
  toThreadId?: string;
  content?: string;
  createdAt?: number;
  source?: string;
  windowId?: string;
  replyToWindowId?: string;
};

export type ContextSnapshot = {
  id: string;
  status?: string;
  plan?: string;
  contextWindows: ContextWindow[];
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  events?: unknown[];
  creatorThreadId?: string;
  parentThreadId?: string;
};

/** 前端通用的树节点抽象；与 LLMInputJsonViewer 中的 ViewerTreeNode 配套。 */
export type ContextNode = {
  id: string;
  label: string;
  /** 一行摘要，用于折叠态显示。 */
  summary?: string;
  /** 嵌套深度，渲染缩进用。 */
  depth: number;
  /** 字符数估算，便于显示 token 占用。 */
  charCount: number;
  /** 类型徽章，例如 "DO" / "TALK"。 */
  badge?: string;
  children: ContextNode[];
  /** 节点详情：详情面板根据 kind 走不同分支。 */
  data: ContextNodeData;
};

export type ContextNodeData =
  | { kind: "thread"; snapshot: ContextSnapshot }
  | { kind: "section"; section: "plan" | "contextWindows" | "inbox" | "outbox" | "events" }
  | { kind: "window"; window: ContextWindow }
  | { kind: "message"; message: ThreadMessage; channel: "inbox" | "outbox" }
  | { kind: "event"; event: unknown; index: number }
  | { kind: "exec"; exec: NonNullable<Extract<ContextWindow, { type: "program" }>>["history"][number] };

// ---- 摘要工具 ----

function previewText(value: string, limit = 88): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return "(empty)";
  if (singleLine.length <= limit) return singleLine;
  return `${singleLine.slice(0, limit)}…`;
}

function jsonChars(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/** 估算 token 数：与 LLMInputJsonViewer 保持一致（chars/3 上取整）。 */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

// ---- 单个 window 节点构造 ----

function windowBadge(type: ContextWindow["type"]): string {
  switch (type) {
    case "command_exec": return "FORM";
    case "do":           return "DO";
    case "todo":         return "TODO";
    case "talk":         return "TALK";
    case "program":      return "PROG";
    case "file":         return "FILE";
    case "knowledge":    return "KNOW";
    case "root":         return "ROOT";
  }
}

function windowSummary(window: ContextWindow): string {
  switch (window.type) {
    case "command_exec":
      return `${window.command} (${window.status})`;
    case "do":
      return `→ ${window.targetThreadId}${window.isCreatorWindow ? " · creator" : ""}`;
    case "todo":
      return previewText(window.content);
    case "talk":
      return `→ ${window.target}`;
    case "program":
      return `${window.history.length} exec${window.history.length === 1 ? "" : "s"}`;
    case "file":
      return window.path + (window.lines ? ` [${window.lines.join("-")}]` : "");
    case "knowledge":
      return window.path;
    case "root":
      return "thread root";
  }
}

function windowCharCount(window: ContextWindow): number {
  let n = window.title.length;
  switch (window.type) {
    case "command_exec":
      n += window.command.length;
      n += jsonChars(window.accumulatedArgs ?? {});
      n += (window.result ?? "").length;
      break;
    case "do":
      n += window.targetThreadId.length;
      break;
    case "todo":
      n += window.content.length;
      n += (window.onCommandPath ?? []).join(",").length;
      break;
    case "talk":
      n += window.target.length;
      break;
    case "program":
      for (const ex of window.history) n += (ex.code ?? ex.function ?? "").length + ex.output.length;
      break;
    case "file":
      n += window.path.length;
      break;
    case "knowledge":
      n += window.path.length;
      break;
    case "root":
      break;
  }
  return n;
}

/** 构造单个 program exec 的子节点。 */
function buildExecNode(
  parentId: string,
  depth: number,
  exec: Extract<ContextWindow, { type: "program" }>["history"][number],
  index: number,
): ContextNode {
  const headLine = exec.language === "function" ? `fn:${exec.function}` : `${exec.language}: ${(exec.code ?? "").split("\n")[0] ?? ""}`;
  return {
    id: `${parentId}:exec:${exec.execId}`,
    label: `[#${index}] ${headLine}`,
    summary: previewText(exec.output),
    depth,
    charCount: (exec.code ?? "").length + exec.output.length,
    badge: exec.ok ? "ok" : "fail",
    children: [],
    data: { kind: "exec", exec },
  };
}

/** 构造单个 window 节点（含 sub_windows + program history 展开）。 */
function buildWindowNode(
  window: ContextWindow,
  allWindows: ContextWindow[],
  depth: number,
): ContextNode {
  const children: ContextNode[] = [];

  // program window 把 history 当作子节点展开
  if (window.type === "program") {
    window.history.forEach((exec, index) => {
      children.push(buildExecNode(window.id, depth + 1, exec, index));
    });
  }

  // 找出 parentWindowId === self.id 的 sub-window
  for (const sub of allWindows) {
    if (sub.type === "root") continue;
    const parentId = sub.parentWindowId;
    if (parentId === window.id) {
      children.push(buildWindowNode(sub, allWindows, depth + 1));
    }
  }

  const status = window.status ? ` ${window.status}` : "";
  return {
    id: `window:${window.id}`,
    label: `${window.title}${status}`,
    summary: windowSummary(window),
    depth,
    charCount: windowCharCount(window),
    badge: windowBadge(window.type),
    children,
    data: { kind: "window", window },
  };
}

// ---- 顶层 section 构造 ----

function buildContextWindowsSection(
  snapshot: ContextSnapshot,
  depth: number,
): ContextNode {
  const all = snapshot.contextWindows ?? [];
  // 顶层 = 非 root 且 parentWindowId 缺省 / 等于 "root"；root 自身视为顶层
  const topLevel = all.filter((w) => {
    if (w.type === "root") return true;
    const pid = w.parentWindowId;
    return !pid || pid === "root";
  });
  const children = topLevel.map((w) => buildWindowNode(w, all, depth + 1));
  return {
    id: "section:contextWindows",
    label: "context_windows",
    summary: `${all.length} window${all.length === 1 ? "" : "s"} total · ${topLevel.length} top-level`,
    depth,
    charCount: all.reduce((sum, w) => sum + windowCharCount(w), 0),
    children,
    data: { kind: "section", section: "contextWindows" },
  };
}

function buildMessagesSection(
  channel: "inbox" | "outbox",
  messages: ThreadMessage[] | undefined,
  depth: number,
): ContextNode {
  const list = messages ?? [];
  const children: ContextNode[] = list.map((m, idx) => {
    const dir = channel === "inbox" ? `← ${m.fromThreadId ?? "?"}` : `→ ${m.toThreadId ?? "?"}`;
    return {
      id: `${channel}:${m.id ?? idx}`,
      label: `[#${idx}] ${dir}${m.source ? ` · ${m.source}` : ""}`,
      summary: previewText(m.content ?? ""),
      depth: depth + 1,
      charCount: (m.content ?? "").length,
      children: [],
      data: { kind: "message", message: m, channel },
    };
  });
  return {
    id: `section:${channel}`,
    label: channel,
    summary: `${list.length} message${list.length === 1 ? "" : "s"}`,
    depth,
    charCount: children.reduce((sum, c) => sum + c.charCount, 0),
    children,
    data: { kind: "section", section: channel },
  };
}

function buildEventsSection(events: unknown[] | undefined, depth: number): ContextNode {
  const list = events ?? [];
  const children: ContextNode[] = list.map((event, idx) => {
    const rec = (event as Record<string, unknown>) ?? {};
    const category = typeof rec.category === "string" ? rec.category : "?";
    const kind = typeof rec.kind === "string" ? rec.kind : "?";
    const text = typeof rec.text === "string" ? rec.text : undefined;
    const charCount = jsonChars(event);
    return {
      id: `event:${idx}`,
      label: `[#${idx}] ${category}/${kind}`,
      summary: text ? previewText(text) : undefined,
      depth: depth + 1,
      charCount,
      children: [],
      data: { kind: "event", event, index: idx },
    };
  });
  return {
    id: "section:events",
    label: "events",
    summary: `${list.length} event${list.length === 1 ? "" : "s"}`,
    depth,
    charCount: children.reduce((sum, c) => sum + c.charCount, 0),
    children,
    data: { kind: "section", section: "events" },
  };
}

function buildPlanSection(plan: string | undefined, depth: number): ContextNode | null {
  if (!plan) return null;
  return {
    id: "section:plan",
    label: "plan",
    summary: previewText(plan),
    depth,
    charCount: plan.length,
    children: [],
    data: { kind: "section", section: "plan" },
  };
}

// ---- 顶层入口 ----

/** 把整个 ContextSnapshot 转成单根 ContextNode 树。 */
export function buildContextTree(snapshot: ContextSnapshot): ContextNode {
  const sections: ContextNode[] = [];
  const planNode = buildPlanSection(snapshot.plan, 1);
  if (planNode) sections.push(planNode);
  sections.push(buildContextWindowsSection(snapshot, 1));
  if (snapshot.inbox && snapshot.inbox.length > 0) sections.push(buildMessagesSection("inbox", snapshot.inbox, 1));
  if (snapshot.outbox && snapshot.outbox.length > 0) sections.push(buildMessagesSection("outbox", snapshot.outbox, 1));
  if (snapshot.events && snapshot.events.length > 0) sections.push(buildEventsSection(snapshot.events, 1));

  const total = sections.reduce((sum, s) => sum + s.charCount, 0);
  return {
    id: `thread:${snapshot.id}`,
    label: `thread ${snapshot.id}${snapshot.status ? ` · ${snapshot.status}` : ""}`,
    summary: `${snapshot.contextWindows?.length ?? 0} windows · ${snapshot.events?.length ?? 0} events`,
    depth: 0,
    charCount: total,
    children: sections,
    data: { kind: "thread", snapshot },
  };
}

/** 拍平树为 id → node 的查找表，便于渲染层根据 selectedId 取节点。 */
export function flattenContextTree(root: ContextNode): Map<string, ContextNode> {
  const map = new Map<string, ContextNode>();
  const stack: ContextNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    map.set(node.id, node);
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  return map;
}

/** 收集树上所有节点 id，便于初始全展开。 */
export function collectAllNodeIds(root: ContextNode): Set<string> {
  const ids = new Set<string>();
  const stack: ContextNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    ids.add(node.id);
    for (const child of node.children) stack.push(child);
  }
  return ids;
}
