/**
 * Context snapshot 解析 / 摘要 / 树形化工具。
 *
 * llm.input.json 中的 contextSnapshot 字段（与后端 src/observable/debug-file.ts
 * 的 ContextSnapshot 同 shape）描述了某次 LLM 调用时刻的完整 thread 上下文：
 *
 *   { id, status, plan?, contextWindows[], inbox?, outbox?, events?, ... }
 *
 * 本文件把它转成树形 ViewerNode，供 ContextSnapshotViewer 渲染：
 *   thread
 *   ├── plan
 *   ├── contextWindows
 *   │   ├── <window id type status title>
 *   │   │   ├── ...class 特有字段
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

/**
 * 后端 OocObjectInstance（runtime/ooc-class.ts）在前端的最小镜像 —— **信封 + data + win 三分**。
 *
 * 信封字段（id / class / title / status / createdAt / parentObjectId）由 runtime 管理，
 * 顶层平铺；业务数据归 `.data`（按 class 区分形态）；投影态归 `.win`。前端按 `.class` narrow，
 * 业务字段读 `.data.xxx`。
 */
type _ContextWindowData =
  | { class: "root"; data: Record<string, never> }
  | {
      class: "method_exec";
      data: {
        method: string;
        description?: string;
        accumulatedArgs?: Record<string, unknown>;
        intentPaths?: string[];
        loadedKnowledgePaths?: string[];
        methodKnowledgePaths?: string[];
        result?: string;
        schema?: { args: Record<string, {
          type: "string" | "number" | "boolean" | "array" | "object" | "any";
          required?: boolean;
          default?: unknown;
          description?: string;
          enum?: Array<string | number | boolean>;
        }> };
        fill?: Record<string, {
          status: "missing" | "provided" | "invalid";
          value?: unknown;
          error?: string;
          source: "initial" | "refine" | "default";
          refinedAt?: number;
        }>;
      };
    }
  | { class: "do"; data: { targetThreadId: string } }
  | { class: "todo"; data: { content: string; activatesOn?: string[]; status?: "open" | "done" } }
  | {
      // 会话窗三 class 同形（后端 talk/types.ts + thread/types.ts + reflect_request/types.ts）：
      // - talk：other-view（与对端 peer/sub thread 的对话）
      // - thread：self-view（普通 flow 里 thread 与其 creator 的对话；creator 窗）
      // - reflect_request：super flow 的 self-view（反思自视，额外挂沉淀 method）
      // 字段一致；前端按需用 isTalkLikeWindowClass 谓词同时认这三个 class。
      class: "talk" | "thread" | "reflect_request";
      data: {
        target: string;
        targetThreadId?: string;
        isForkWindow?: boolean;
      };
    }
  | {
      class: "terminal_process" | "interpreter_process";
      data: {
        history: Array<{
          execId: string;
          language: "shell" | "ts" | "js";
          code?: string;
          output: string;
          ok: boolean;
          startedAt: number;
        }>;
      };
    }
  | { class: "file"; data: { path: string }; win?: { lines?: [number, number]; columns?: [number, number] } }
  | {
      class: "knowledge";
      data: {
        path: string;
        /** 来源：explicit=LLM 主动 pin；protocol=KNOWLEDGE/form 派生；activator=stone 知识命中 */
        source?: "explicit" | "protocol" | "activator" | "relation";
        /** 合成 window 直接携带正文；explicit 来源时可能为空（render 端从 loader 取） */
        body?: string;
        /** activator 来源时区分 full / summary */
        presentation?: "full" | "summary";
        /** activator 来源时的描述（来自 frontmatter.description） */
        description?: string;
      };
    }
  | {
      class: "search";
      data: {
        kind: "glob" | "grep";
        query: string;
        matches: Array<{ index: number; path: string; line?: number; snippet?: string }>;
        truncated: boolean;
        searchRoot?: string;
      };
    }
  | {
      class: "skill_index";
      data: {
        skills: Array<{
          name: string;
          description: string;
          skillFilePath: string;
          scope: "branch" | "object" | "external";
        }>;
      };
    }
  | {
      class: "feishu_chat";
      data: {
        chatId: string;
        chatName: string;
        chatType?: "group" | "p2p" | "topic";
        mode: "tail" | "search" | "thread";
        tailCount?: number;
        searchQuery?: string;
        threadAnchorMessageId?: string;
        lastRefreshAtMs?: number;
        buffer: Array<{
          messageId: string;
          sender: string;
          senderKind?: "user" | "bot" | "system";
          createTimeMs: number;
          text: string;
          replyToMessageId?: string;
        }>;
      };
    }
  | {
      class: "feishu_doc";
      data: {
        docToken: string;
        docKind: "doc" | "docx" | "sheet" | "base" | "wiki" | "drive_md";
        docTitle: string;
        content: {
          format: "markdown" | "blocks";
          body: string;
          blocks?: Array<{ blockId: string; blockType?: string; text?: string; parentBlockId?: string }>;
        };
        versionId?: string;
        mode: "read" | "edit";
        lastFetchedAtMs?: number;
      };
    }
  | {
      /**
       * Plan window:
       * - 业务数据（title / steps / description / status / parentPlanWindowId / parentStepId）归 `.data`
       * - 支持 sub plan 嵌套：parentPlanWindowId + parentStepId 反向链；step.subPlanWindowId 正向链
       */
      class: "plan";
      data: {
        title: string;
        status: "active" | "done" | "archived";
        description?: string;
        steps: Array<{
          id: string;
          text: string;
          status: "pending" | "in-progress" | "done" | "blocked";
          subPlanWindowId?: string;
        }>;
        parentPlanWindowId?: string;
        parentStepId?: string;
      };
    };

/** 所有 ContextWindow 共享的信封 + enrichment 字段。 */
interface _ContextWindowEnvelope {
  id: string;
  title: string;
  status?: string;
  createdAt?: number;
  /** 父对象 id（后端 OocObjectInstance.parentObjectId）；旧数据可能写 parentWindowId。 */
  parentObjectId?: string;
  parentWindowId?: string;
  /** 投影态（与 data 分离）；多数 class 无投影态。 */
  win?: unknown;
  /**
   * 沿 parentClass 继承链回退后首个可渲染的 ancestor type；渲染 key 用 effectiveVisibleType ?? class。
   */
  effectiveVisibleType?: string;
  provenance?: {
    kind: "explicit" | "derived" | "system" | "related";
    reason: {
      mechanism: string;
      sourceId?: string;
      detail?: Record<string, unknown>;
    };
    createdAt: number;
    lastTouchedAt: number;
  };
  relevance?: {
    score: number;
    priorityHint?: "critical" | "high" | "normal" | "low";
    signalCount: number;
  };
  boundFormId?: string;
}

/**
 * ContextWindow —— 信封 + data（+ win）。镜像后端 `OocObjectInstance`。
 * 按 `.class` narrow（discriminant 在 `_ContextWindowData`），业务字段读 `.data.xxx`。
 */
export type ContextWindow = _ContextWindowEnvelope & _ContextWindowData;

/**
 * creator 窗身份编码在 window id 里（镜像后端 `creatorWindowIdOf`：id=`w_creator_<threadId>`）——
 * 不再有 `data.isCreatorWindow` 字段，前端按 id 派生「这是不是 creator 窗」。
 */
export function isCreatorWindowId(id: string | undefined): boolean {
  return !!id && id.startsWith("w_creator_");
}

/** 取 window 的父对象 id（兼容旧 parentWindowId 字段）。 */
export function windowParentId(window: ContextWindow): string | undefined {
  return window.parentObjectId ?? window.parentWindowId;
}

/**
 * 会话窗谓词（镜像后端 isTalkLikeClass）—— talk / thread / reflect_request 三者同形。
 * 凡是按"会话 / self-view 窗"语义处理的 UI（transcript 折叠、composer、chat-line 提升），
 * 用本谓词同时认这三个 class，避免 self-view 窗从 talk 改投影到 thread/reflect_request 后漏渲。
 */
export function isTalkLikeWindowClass(cls: string | undefined): boolean {
  return cls === "talk" || cls === "thread" || cls === "reflect_request";
}

/** 与后端 ThreadMessage 同 shape；前端只读取关心的字段。 */
export type ThreadMessage = {
  id?: string;
  fromThreadId?: string;
  toThreadId?: string;
  /** 跨对象 talk 时由 deliverTalkMessage 写入,UI 用作 sender label。旧数据可能缺。 */
  fromObjectId?: string;
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
  | { kind: "windowGroup"; windowType: ContextWindow["class"] }
  | { kind: "window"; window: ContextWindow; transcript?: TranscriptEntry[] }
  | { kind: "message"; message: ThreadMessage; channel: "inbox" | "outbox" }
  | { kind: "event"; event: unknown; index: number }
  | { kind: "exec"; exec: ProcessExecEntry };

/** 进程 window（terminal_process / interpreter_process）的单条 exec 记录。 */
export type ProcessExecEntry = {
  execId: string;
  language: "shell" | "ts" | "js";
  code?: string;
  output: string;
  ok: boolean;
  startedAt: number;
};

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

function windowBadge(window: ContextWindow): string {
  switch (window.class) {
    case "method_exec": return "FORM";
    case "do":           return "DO";
    case "todo":         return "TODO";
    case "talk":         return "TALK";
    case "thread":       return "SELF";
    case "reflect_request": return "RFLCT";
    case "terminal_process":   return "TERM";
    case "interpreter_process": return "INTERP";
    case "file":         return "FILE";
    case "knowledge":    return "KNOW";
    case "search":       return "SRCH";
    case "root":         return "ROOT";
    case "skill_index":  return "SKILLS";
    case "feishu_chat":  return "FSCHAT";
    case "feishu_doc":   return "FSDOC";
    case "plan": {
      // plan 分支：badge 携带 step count 摘要(如 "3/5 done")，方便在左树一眼看进度。
      const total = window.data.steps.length;
      const doneN = window.data.steps.filter((s) => s.status === "done").length;
      return `PLAN ${doneN}/${total}`;
    }
    // ContextWindow union 加宽，穷尽性不再封闭：未知类型给兜底 badge。
    default:
      return String((window as { class: string }).class).toUpperCase().slice(0, 6);
  }
}

function windowSummary(window: ContextWindow): string {
  switch (window.class) {
    case "method_exec":
      return `${window.data.method} (${window.status})`;
    case "do":
      return `→ ${window.data.targetThreadId}${isCreatorWindowId(window.id) ? " · creator" : ""}`;
    case "todo":
      return previewText(window.data.content);
    case "talk":
    case "thread":
    case "reflect_request":
      return `→ ${window.data.target}`;
    case "terminal_process":
    case "interpreter_process":
      return `${window.data.history.length} exec${window.data.history.length === 1 ? "" : "s"}`;
    case "file":
      return window.data.path + (window.win?.lines ? ` [${window.win.lines.join("-")}]` : "");
    case "knowledge":
      return `${window.data.source ?? "explicit"} · ${window.data.path}` + (window.data.presentation ? ` · ${window.data.presentation}` : "");
    case "search":
      return `${window.data.kind} · ${window.data.query} · ${window.data.matches.length}${window.data.truncated ? "+" : ""} hit${window.data.matches.length === 1 ? "" : "s"}`;
    case "root":
      return "thread root";
    case "skill_index":
      return `${window.data.skills.length} skill${window.data.skills.length === 1 ? "" : "s"}`;
    case "feishu_chat":
      return `${window.data.chatName} · ${window.data.mode} · ${window.data.buffer.length} msg${window.data.buffer.length === 1 ? "" : "s"}`;
    case "feishu_doc":
      return `${window.data.docKind} · ${window.data.docTitle}`;
    case "plan":
      // 一行摘要：plan title；description 留给详情面板渲染避免左树太宽。
      return window.data.title || window.title;
    // ContextWindow union 加宽，穷尽性不再封闭：未知类型回退到 title。
    default:
      return (window as { title?: string }).title ?? "";
  }
}

function windowCharCount(window: ContextWindow): number {
  let n = window.title.length;
  switch (window.class) {
    case "method_exec":
      n += window.data.method.length;
      n += jsonChars(window.data.accumulatedArgs ?? {});
      n += (window.data.result ?? "").length;
      break;
    case "do":
      n += window.data.targetThreadId.length;
      break;
    case "todo":
      n += window.data.content.length;
      n += (window.data.activatesOn ?? []).join(",").length;
      break;
    case "talk":
    case "thread":
    case "reflect_request":
      n += window.data.target.length;
      break;
    case "terminal_process":
    case "interpreter_process":
      for (const ex of window.data.history) n += (ex.code ?? "").length + ex.output.length;
      break;
    case "file":
      n += window.data.path.length;
      break;
    case "knowledge":
      n += window.data.path.length + (window.data.body?.length ?? 0) + (window.data.description?.length ?? 0);
      break;
    case "search":
      n += window.data.query.length;
      for (const m of window.data.matches) n += m.path.length + (m.snippet?.length ?? 0);
      break;
    case "root":
      break;
    case "skill_index":
      for (const s of window.data.skills) n += s.name.length + s.description.length;
      break;
    case "feishu_chat":
      for (const m of window.data.buffer) n += m.text.length + m.sender.length;
      break;
    case "feishu_doc":
      n += window.data.content.body.length;
      break;
    case "plan":
      // title 已在外层兜底；这里加 description + 所有 step text。
      n += (window.data.description ?? "").length;
      for (const s of window.data.steps) n += s.text.length;
      break;
  }
  return n;
}

// ---- Window 视图归纳（与后端 src/thinkable/context/render.ts 同语义） ----

type DoWindowShape = Extract<ContextWindow, { class: "do" }>;
// 会话窗三 class 同形（talk/thread/reflect_request）共用一个 union 成员，Extract 按其判别符整体取出。
type TalkWindowShape = Extract<ContextWindow, { class: "talk" | "thread" | "reflect_request" }>;

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
  const target = window.data.targetThreadId;
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
    if (w.class === "do") {
      for (const e of filterMessagesForDoWindow(w, inbox, outbox)) {
        if (e.message.id) consumed.add(e.message.id);
      }
    } else if (isTalkLikeWindowClass(w.class)) {
      for (const e of filterMessagesForTalkWindow(w as TalkWindowShape, inbox, outbox)) {
        if (e.message.id) consumed.add(e.message.id);
      }
    }
  }
  return consumed;
}

/** 构造单个进程 exec 的子节点。 */
function buildExecNode(
  parentId: string,
  depth: number,
  exec: ProcessExecEntry,
  index: number,
): ContextNode {
  const headLine = `${exec.language}: ${(exec.code ?? "").split("\n")[0] ?? ""}`;
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

/** 构造单个 window 节点（含 sub_windows + process history）。
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

  if (window.class === "do" || isTalkLikeWindowClass(window.class)) {
    transcript = window.class === "do"
      ? filterMessagesForDoWindow(window, inbox, outbox)
      : filterMessagesForTalkWindow(window as TalkWindowShape, inbox, outbox);
    let inboxN = 0;
    let outboxN = 0;
    for (const entry of transcript) {
      extraChars += (entry.message.content ?? "").length;
      if (entry.channel === "inbox") inboxN += 1;
      else outboxN += 1;
    }
    messageCounts = { inbox: inboxN, outbox: outboxN };
  }

  // 进程 window 把 history 当作子节点展开
  if (window.class === "terminal_process" || window.class === "interpreter_process") {
    window.data.history.forEach((exec, index) => {
      children.push(buildExecNode(window.id, depth + 1, exec, index));
    });
  }

  // 找出 parent === self.id 的 sub-window
  for (const sub of allWindows) {
    if (sub.class === "root") continue;
    const parentId = windowParentId(sub);
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
    badge: windowBadge(window),
    messageCounts,
    children,
    data: { kind: "window", window, transcript },
  };
}

// ---- 顶层 section 构造 ----

/** 在分组视图中,window type 之间的稳定显示顺序(语义优先级)。 */
const WINDOW_TYPE_ORDER: ContextWindow["class"][] = [
  "root",
  "method_exec",
  "do",
  "talk",
  // plan 与 todo 同属行动结构，先于具体执行 (terminal_process/file/…) 渲染让用户先看到任务规划
  "plan",
  "todo",
  "terminal_process",
  "interpreter_process",
  "file",
  "knowledge",
  "search",
  "skill_index",
  "feishu_chat",
  "feishu_doc",
];

function buildContextWindowsSection(
  snapshot: ContextSnapshot,
  depth: number,
): ContextNode {
  const all = snapshot.contextWindows ?? [];
  const inbox = snapshot.inbox ?? [];
  const outbox = snapshot.outbox ?? [];
  // 顶层 = 非 root 且 parentWindowId 缺省 / 等于 "root"；root 自身视为顶层
  const topLevel = all.filter((w) => {
    if (w.class === "root") return true;
    const pid = windowParentId(w);
    return !pid || pid === "root";
  });

  // 按 type 分组;组内按 createdAt 升序(早 → 晚),createdAt 缺省视为 0
  const buckets = new Map<ContextWindow["class"], ContextWindow[]>();
  for (const w of topLevel) {
    const bucket = buckets.get(w.class) ?? [];
    bucket.push(w);
    buckets.set(w.class, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  // 输出顺序:WINDOW_TYPE_ORDER 中已知类型优先,未知类型按字典序追加
  const orderedTypes: ContextWindow["class"][] = [];
  for (const t of WINDOW_TYPE_ORDER) {
    if (buckets.has(t)) orderedTypes.push(t);
  }
  for (const t of Array.from(buckets.keys()).sort()) {
    if (!orderedTypes.includes(t)) orderedTypes.push(t);
  }

  const groupChildren: ContextNode[] = orderedTypes.map((type) => {
    const bucket = buckets.get(type)!;
    const windowChildren = bucket.map((w) =>
      buildWindowNode(w, all, inbox, outbox, depth + 2),
    );
    const groupCharCount = windowChildren.reduce((sum, c) => sum + c.charCount, 0);
    return {
      id: `windowGroup:${type}`,
      label: `${type} (${bucket.length})`,
      summary: undefined,
      depth: depth + 1,
      charCount: groupCharCount,
      children: windowChildren,
      data: { kind: "windowGroup", windowType: type },
    };
  });

  return {
    id: "section:contextWindows",
    label: "context_windows",
    summary: `${all.length} window${all.length === 1 ? "" : "s"} total · ${topLevel.length} top-level · ${orderedTypes.length} type${orderedTypes.length === 1 ? "" : "s"}`,
    depth,
    charCount: groupChildren.reduce((sum, c) => sum + c.charCount, 0),
    children: groupChildren,
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
    const fromLabel = m.fromObjectId ? `${m.fromObjectId} · ${m.fromThreadId ?? "?"}` : (m.fromThreadId ?? "?");
    const dir = channel === "inbox" ? `← ${fromLabel}` : `→ ${m.toThreadId ?? "?"}`;
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

/**
 * 收集初次进入 viewer 时应展开的节点 id。
 *
 * 与 collectAllNodeIds 的区别:**events section 自身不加入展开集合**,
 * 让长串 event 默认折叠(parent 折叠 → children 不渲染),
 * 避免左树被 100+ 条 llm_interaction / tool_runtime 事件淹没。
 * 用户想看 events 时手动展开 section 即可。
 */
export function collectInitialExpandedIds(root: ContextNode): Set<string> {
  const ids = new Set<string>();
  const stack: ContextNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    // events section 自己保持折叠(不进 expanded 集);其它节点全展开
    const isEventsSection = node.data.kind === "section" && node.data.section === "events";
    if (!isEventsSection) {
      ids.add(node.id);
      for (const child of node.children) stack.push(child);
    }
    // events section 既不加入 expanded,也不递归 children(children 反正不渲染,
    // 即使预先展开它们,折叠的父节点也不会显示——但还是省掉这次遍历)
  }
  return ids;
}

/**
 * 找出树上 id == targetId 的节点路径(从 root 到该节点);找不到返回空数组。
 *
 * 用作"导航到某个 window":拿到完整路径后把每一级父 node id 都加进 expanded set,
 * 保证目标节点在折叠视图下也能可见。
 */
export function findNodePath(root: ContextNode, targetId: string): ContextNode[] {
  function dfs(node: ContextNode, path: ContextNode[]): ContextNode[] | undefined {
    const next = [...path, node];
    if (node.id === targetId) return next;
    for (const child of node.children) {
      const found = dfs(child, next);
      if (found) return found;
    }
    return undefined;
  }
  return dfs(root, []) ?? [];
}
