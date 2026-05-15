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
 *   │   │   ├── ...type 特有字段
 *   │   │   ├── transcript（do/talk window：按目标 / windowId 收纳的消息）
 *   │   │   └── sub_windows
 *   │   └── ...
 *   ├── inbox（fallback：未被任何 window 收纳的孤儿消息）
 *   ├── outbox（同上）
 *   └── events
 *
 * 这与后端 src/thinkable/context/render.ts 的视图归纳保持一致：
 * - filterMessagesForDoWindow / filterMessagesForTalkWindow 决定每条消息归属的 window
 * - 顶层 inbox/outbox 仅渲染 fallback，避免与 window 内 transcript 重复
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
      /** 来源：explicit=LLM 主动 pin；protocol=KNOWLEDGE/form 派生；activator=stone 知识命中 */
      source?: "explicit" | "protocol" | "activator";
      /** 合成 window 直接携带正文；explicit 来源时可能为空（render 端从 loader 取） */
      body?: string;
      /** activator 来源时区分 full / summary */
      presentation?: "full" | "summary";
      /** activator 来源时的描述（来自 frontmatter.description） */
      description?: string;
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
  /** do/talk window 节点专用：inbox/outbox 各自命中的消息条数，用于右侧 badge。 */
  messageCounts?: { inbox: number; outbox: number };
  children: ContextNode[];
  /** 节点详情：详情面板根据 kind 走不同分支。 */
  data: ContextNodeData;
};

export type TranscriptEntry = { message: ThreadMessage; channel: "inbox" | "outbox" };

export type ContextNodeData =
  | { kind: "thread"; snapshot: ContextSnapshot }
  | { kind: "section"; section: "plan" | "contextWindows" | "inbox" | "outbox" | "events" }
  | { kind: "window"; window: ContextWindow; transcript?: TranscriptEntry[] }
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
      return `${window.source ?? "explicit"} · ${window.path}` + (window.presentation ? ` · ${window.presentation}` : "");
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
      n += window.path.length + (window.body?.length ?? 0) + (window.description?.length ?? 0);
      break;
    case "root":
      break;
  }
  return n;
}

// ---- Window 视图归纳（与后端 src/thinkable/context/render.ts 同语义） ----

type DoWindowShape = Extract<ContextWindow, { type: "do" }>;
type TalkWindowShape = Extract<ContextWindow, { type: "talk" }>;

/**
 * do_window 的视图过滤：选出与该 window targetThreadId 相关的消息。
 * - 父侧 do_window：messages where to_thread_id == target（父 → 子）或 from_thread_id == target（子 → 父）
 * - 创建 creator do_window：targetThreadId 是父；同样规则
 */
function filterMessagesForDoWindow(
  window: DoWindowShape,
  inbox: ThreadMessage[],
  outbox: ThreadMessage[],
): Array<{ message: ThreadMessage; channel: "inbox" | "outbox" }> {
  const target = window.targetThreadId;
  const seen = new Set<string>();
  const acc: Array<{ message: ThreadMessage; channel: "inbox" | "outbox" }> = [];
  const collect = (channel: "inbox" | "outbox", list: ThreadMessage[]) => {
    for (const m of list) {
      const id = m.id;
      if (id && seen.has(id)) continue;
      if (m.fromThreadId === target || m.toThreadId === target) {
        if (id) seen.add(id);
        acc.push({ message: m, channel });
      }
    }
  };
  collect("inbox", inbox);
  collect("outbox", outbox);
  acc.sort((a, b) => (a.message.createdAt ?? 0) - (b.message.createdAt ?? 0));
  return acc;
}

/**
 * talk_window 的视图过滤：
 * - outbox 上 windowId === self.id（say 写入时的标记）
 * - inbox 上 replyToWindowId === self.id（control plane / cross-object 路由回溯）
 */
function filterMessagesForTalkWindow(
  window: TalkWindowShape,
  inbox: ThreadMessage[],
  outbox: ThreadMessage[],
): Array<{ message: ThreadMessage; channel: "inbox" | "outbox" }> {
  const acc: Array<{ message: ThreadMessage; channel: "inbox" | "outbox" }> = [];
  for (const m of outbox) if (m.windowId === window.id) acc.push({ message: m, channel: "outbox" });
  for (const m of inbox) if (m.replyToWindowId === window.id) acc.push({ message: m, channel: "inbox" });
  acc.sort((a, b) => (a.message.createdAt ?? 0) - (b.message.createdAt ?? 0));
  return acc;
}

/** 收集所有已被 do/talk window 视图收纳的消息 id；其余消息走顶层 inbox/outbox 兜底。 */
function collectWindowConsumedMessageIds(snapshot: ContextSnapshot): Set<string> {
  const consumed = new Set<string>();
  const inbox = snapshot.inbox ?? [];
  const outbox = snapshot.outbox ?? [];
  for (const w of snapshot.contextWindows ?? []) {
    if (w.type === "do") {
      for (const e of filterMessagesForDoWindow(w, inbox, outbox)) {
        if (e.message.id) consumed.add(e.message.id);
      }
    } else if (w.type === "talk") {
      for (const e of filterMessagesForTalkWindow(w, inbox, outbox)) {
        if (e.message.id) consumed.add(e.message.id);
      }
    }
  }
  return consumed;
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

/** 构造单个 window 节点（含 sub_windows + program history）。
 *
 * do/talk window 的 transcript（按窗口归纳的消息）不进入树的 children，
 * 而是挂到 data.transcript 上由右侧详情面板平铺渲染；
 * messageCounts 仍写入节点供左树右侧 badge 使用。
 */
function buildWindowNode(
  window: ContextWindow,
  allWindows: ContextWindow[],
  inbox: ThreadMessage[],
  outbox: ThreadMessage[],
  depth: number,
): ContextNode {
  const children: ContextNode[] = [];
  let extraChars = 0;
  let messageCounts: { inbox: number; outbox: number } | undefined;
  let transcript: TranscriptEntry[] | undefined;

  if (window.type === "do" || window.type === "talk") {
    transcript = window.type === "do"
      ? filterMessagesForDoWindow(window, inbox, outbox)
      : filterMessagesForTalkWindow(window, inbox, outbox);
    let inboxN = 0;
    let outboxN = 0;
    for (const entry of transcript) {
      extraChars += (entry.message.content ?? "").length;
      if (entry.channel === "inbox") inboxN += 1;
      else outboxN += 1;
    }
    messageCounts = { inbox: inboxN, outbox: outboxN };
  }

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
      children.push(buildWindowNode(sub, allWindows, inbox, outbox, depth + 1));
    }
  }

  const status = window.status ? ` ${window.status}` : "";
  return {
    id: `window:${window.id}`,
    label: `${window.title}${status}`,
    summary: windowSummary(window),
    depth,
    charCount: windowCharCount(window) + extraChars,
    badge: windowBadge(window.type),
    messageCounts,
    children,
    data: { kind: "window", window, transcript },
  };
}

// ---- 顶层 section 构造 ----

function buildContextWindowsSection(
  snapshot: ContextSnapshot,
  depth: number,
): ContextNode {
  const all = snapshot.contextWindows ?? [];
  const inbox = snapshot.inbox ?? [];
  const outbox = snapshot.outbox ?? [];
  // 顶层 = 非 root 且 parentWindowId 缺省 / 等于 "root"；root 自身视为顶层
  const topLevel = all.filter((w) => {
    if (w.type === "root") return true;
    const pid = w.parentWindowId;
    return !pid || pid === "root";
  });
  const children = topLevel.map((w) => buildWindowNode(w, all, inbox, outbox, depth + 1));
  return {
    id: "section:contextWindows",
    label: "context_windows",
    summary: `${all.length} window${all.length === 1 ? "" : "s"} total · ${topLevel.length} top-level`,
    depth,
    charCount: children.reduce((sum, c) => sum + c.charCount, 0),
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

  // 顶层 inbox/outbox 仅展示未被 do/talk window 收纳的 fallback 消息（与后端 render 一致）
  const consumedIds = collectWindowConsumedMessageIds(snapshot);
  const isFallback = (m: ThreadMessage) => !m.id || !consumedIds.has(m.id);
  const fallbackInbox = (snapshot.inbox ?? []).filter(isFallback);
  const fallbackOutbox = (snapshot.outbox ?? []).filter(isFallback);
  if (fallbackInbox.length > 0) sections.push(buildMessagesSection("inbox", fallbackInbox, 1));
  if (fallbackOutbox.length > 0) sections.push(buildMessagesSection("outbox", fallbackOutbox, 1));
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
