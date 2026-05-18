/**
 * ContextWindow 抽象 — 取代旧的 ActiveForm + thread.windows + pinnedKnowledge 三套并列概念。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 核心思想：
 * - 一个 thread 持有一组 ContextWindow（flat 数组，层级通过 parentWindowId 表达）
 * - 每个 window 都是"持续占 context 的实体"，对 LLM 而言行为一致：通过 5 原语 open / refine /
 *   submit / close / wait 与之交互
 * - 各 window type 通过 WindowRegistry（registry.ts）声明自身注册的 command、关闭副作用与渲染规则
 *
 * Step 1 实现的 window type（见 spec § 迁移节奏 Step 1）：
 * - root         — 每个 thread 隐含的根 window；注册全局 command（约等于今天 commands/ 目录）
 * - command_exec — 调用某 command 时的临时 sub-window，承载 args 累积与 knowledge 渐进激活
 *                  对应旧 ActiveForm 概念
 * - do           — fork 子线程后产生的对话窗口；transcript 是 inbox/outbox 在该子线程视角的视图
 * - todo         — 由 root.todo command 直建（args 完整时一步提交），表示一条可见待办
 *
 * Step 2 才会引入：talk / program / file / knowledge — 当前不在 union 中，避免假装已实现。
 */

/** Window 类型枚举；新增类型必须同步在 WINDOW_REGISTRY 中注册。 */
export type WindowType = "root" | "command_exec" | "do" | "todo" | "talk" | "program" | "file" | "knowledge" | "search";

/**
 * Window 状态值汇总。
 *
 * - command_exec：open → executing → executed
 *   - 成功后系统自动从 contextWindows 移除（spec § submit 段）
 *   - 失败则保留 executed + result（错误信息），等 LLM 显式 close
 * - do：running → archived（被 close 时切到 archived，对应 B=ii archive 语义）
 * - todo：open → done（被 close 时切到 done）
 * - talk：open → closed（close 释放，与对端无关）
 * - program：open → closed（close 释放）
 * - file / knowledge：open → closed（close 释放，可触发 reload）
 * - root：仅 active；与 thread 同生命周期，不能被关闭
 */
export type WindowStatus = "open" | "executing" | "executed" | "running" | "archived" | "done" | "active" | "closed";

/**
 * 所有 ContextWindow 共享的字段。
 *
 * - id：全局唯一稳定 ID（root 固定为 "root"，其它类型用 generateWindowId）
 * - parentWindowId：command_exec 必有 parent；其它类型不显式挂 parent 时默认在 root 下
 * - title：所有 window 强制必填（spec § ContextWindow 抽象）
 * - windowKnowledgePaths：本 window 自身关联的 knowledge path（用于 close 时释放引用计数）
 */
export interface BaseContextWindow {
  id: string;
  type: WindowType;
  parentWindowId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  windowKnowledgePaths?: string[];
}

/**
 * Root window — 每个 thread 隐含一个，固定 id="root"，title=thread 自身的标题。
 *
 * 不可被 LLM 显式 open / close。注册的 command 集合 = 今天 src/executable/commands 目录全集。
 */
export interface RootWindow extends BaseContextWindow {
  type: "root";
  status: "active";
}

/**
 * Command exec form — 调用某 command 时的临时 sub-window。
 *
 * 替代旧 ActiveForm 概念；字段与 ActiveForm 一一对应：
 * - command          ← 旧 form.command
 * - description      ← 旧 form.description
 * - accumulatedArgs  ← 旧 form.accumulatedArgs
 * - commandPaths     ← 旧 form.commandPaths（match() 派生）
 * - loadedKnowledgePaths ← 旧 form.loadedKnowledgePaths
 * - status           ← 旧 form.status（open/executing/executed）
 * - result           ← 旧 form.result
 * - commandKnowledgePaths ← 旧 form.commandKnowledgePaths
 *
 * parentWindowId 是该 command 注册到的 window 的 id（root 命令时 = "root"；
 *    do_window 上的 continue 时 = 该 do_window 的 id）。
 */
export interface CommandExecWindow extends BaseContextWindow {
  type: "command_exec";
  parentWindowId: string;
  command: string;
  description: string;
  accumulatedArgs: Record<string, unknown>;
  commandPaths: string[];
  loadedKnowledgePaths: string[];
  commandKnowledgePaths?: string[];
  status: "open" | "executing" | "executed";
  result?: string;
}

/**
 * Do window — fork 子线程后在父线程下产生的对话窗口。
 *
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 command（详见 windows/do.ts）：continue / wait / close
 * - close 语义（B=ii archive）：标记 child thread 为 archived 状态；对应 onClose hook
 * - 特殊子类：初始 creator do_window（id 派生自 thread.id，targetThreadId=creator），不可被 close
 */
export interface DoWindow extends BaseContextWindow {
  type: "do";
  targetThreadId: string;
  status: "running" | "archived";
  /** 标记为初始 creator do_window，不可被 LLM close（spec § 初始 creator 对话 window）。 */
  isCreatorWindow?: boolean;
}

/**
 * Todo window — 由 root.todo command 一步直建（args 给齐时 open 立即提交 form）。
 *
 * - content：待办正文（同时作为 title 来源；过长截断）
 * - onCommandPath：可选；命中这些 command path 时强提醒（替代旧 todo form 的 on_command_path）
 * - 没有 LLM 可调用的 command；只能被 close
 */
export interface TodoWindow extends BaseContextWindow {
  type: "todo";
  content: string;
  onCommandPath?: string[];
  status: "open" | "done";
}

/**
 * Talk window — 与另一个 flow object 的某条 thread 保持持续会话。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 * - target：目标 flow object 的 objectId；user 也是一个 flow object，写作 "user"
 * - targetThreadId：会话对端 thread id；首次 say 时由 talk-delivery 创建并回填
 * - conversationId：同 target 多窗口区分；当前固定等于 windowId
 * - isCreatorWindow：标记为"指向 caller 的初始 creator talk_window"（不可被 LLM close）
 *   user.root 上指向 supervisor 的初始 talk_window 不带这个标记（user 是被动对象，无所谓 creator）
 * - 注册的 command（windows/talk.ts）：say / wait / close
 * - 视图：transcript 按 outbox.windowId === self.id || inbox.replyToWindowId === self.id 过滤
 */
export interface TalkWindow extends BaseContextWindow {
  type: "talk";
  /** 目标 flow object id；"user" 也是一个 object。 */
  target: string;
  /** 对端 thread id；首条消息派送时由 talk-delivery 解析/创建并回填。 */
  targetThreadId?: string;
  conversationId: string;
  status: "open" | "closed";
  /** 标记为初始 creator talk_window（callee thread 自带的、指向 caller 的那一条），不可被 close。 */
  isCreatorWindow?: boolean;
}

/**
 * Program window — REPL 风格的代码执行窗口。
 *
 * - history：每次 exec 一条记录；每次都是独立 sandbox（spec § program_window）
 * - ts/js sandbox 通过 self.getThreadLocal/setThreadLocal 跨 exec 共享数据（落到 thread.threadLocalData）
 * - 注册 command：exec / close
 */
export interface ProgramWindow extends BaseContextWindow {
  type: "program";
  status: "open" | "closed";
  history: ProgramExecRecord[];
}

export interface ProgramExecRecord {
  execId: string;
  language: "shell" | "ts" | "js" | "function";
  code?: string;
  function?: string;
  args?: unknown;
  output: string;
  ok: boolean;
  startedAt: number;
}

/**
 * File window — 显示某个文件的内容（按 lines/columns 切片）。
 *
 * - path：文件绝对路径或工作目录相对路径
 * - lines / columns：可选切片范围
 * - 注册 command：set_range / reload / close
 */
export interface FileWindow extends BaseContextWindow {
  type: "file";
  status: "open" | "closed";
  path: string;
  lines?: [number, number];
  columns?: [number, number];
}

/**
 * Knowledge window — 一段 knowledge 文本作为 window 出现在 context 中。
 *
 * 四种 source（spec 2026-05-14 + 后续统一 + 2026-05-18 relation）：
 * - explicit  ：LLM 通过 \`open(command="open_knowledge", path)\` 显式 pin；
 *               持久化到 thread.contextWindows；可被 LLM \`close\` 释放。
 *               render 时从 stone knowledge loader 取正文。
 * - protocol  ：每轮自动注入的协议常量（src/executable/index.ts KNOWLEDGE）
 *               与每个 command_exec form 的 \`knowledge()\` 派生条目；
 *               不持久化，每轮 buildInputItems / captureContextSnapshot 时合成；
 *               LLM 不可 close（\`close\` hook 会拒绝并写 inject）。
 * - activator ：stones/{id}/knowledge/*.md 经 commandPaths 命中激活的条目；
 *               同样合成、不持久化、不可 close；额外携带 presentation=full|summary。
 * - relation  ：thread.contextWindows 中存在 talk_window(target=peerId) 时,
 *               按 peerId 派生最多 2 条:peer 的 stones/{peer}/readme.md 与
 *               自己的 stones/{self}/knowledge/relations/{peer}.md(后者缺失时
 *               合成占位 body 提示 LLM 写入)。同样不持久化、不可 close;由
 *               src/thinkable/knowledge/synthesizer.ts:deriveRelationKnowledge 派生。
 *               详见 meta/object/collaborable/relation。
 *
 * 合成的 KnowledgeWindow 自带 \`body\`，render 层不再需要回调 loader。
 * activator 来源走总数 20 项 + 单篇 8KB 截断。
 */
export interface KnowledgeWindow extends BaseContextWindow {
  type: "knowledge";
  status: "open" | "closed";
  path: string;
  /** 四类来源；缺省视为 explicit（向后兼容旧 thread.json）。 */
  source?: "explicit" | "protocol" | "activator" | "relation";
  /** 合成 window 携带正文；explicit 来源时由 render 层从 loader 取。 */
  body?: string;
  /** activator / relation 来源时区分 full（含正文）与 summary（仅 description）。 */
  presentation?: "full" | "summary";
  /** activator 来源时记录 doc.frontmatter.description，便于 summary 渲染。 */
  description?: string;
}

/**
 * Search window — 把一次 glob / grep 的结果以持久 window 形式留在 context，
 * 让 LLM 可以引用某个 match (open_match index) 而不必从裸文本里 re-parse 路径。
 *
 * - kind 区分搜索类型；同一 type 下未来可加 ast-grep / structural search 等
 * - matches 截断到 200；超过则 truncated=true，LLM 可通过 refine_query 兜底
 * - grep kind 时 match 还携带 line + snippet；glob kind 只有 path
 * - 注册 command：open_match / close
 */
export interface SearchWindow extends BaseContextWindow {
  type: "search";
  status: "open" | "closed";
  kind: "glob" | "grep";
  /** 触发本次搜索的查询：glob pattern 或 grep regex */
  query: string;
  /** 命中条目；按 (path, line) 字典序排好，截断后保留前 200 条 */
  matches: SearchMatch[];
  /** 是否被 200 上限截断 */
  truncated: boolean;
  /** 仅 grep kind：搜索的根目录（便于 LLM 理解 match.path 的相对性） */
  searchRoot?: string;
}

export interface SearchMatch {
  /** 在 matches 数组中的稳定下标，作为 open_match(index) 的引用 */
  index: number;
  /** 命中文件路径 */
  path: string;
  /** 仅 grep kind */
  line?: number;
  /** 仅 grep kind；命中所在行的内容，单行截断到 200 字符 */
  snippet?: string;
}

/** 所有 ContextWindow 类型的 discriminated union。新增 type 后必须扩这里 + WINDOW_REGISTRY。 */
export type ContextWindow =
  | RootWindow
  | CommandExecWindow
  | DoWindow
  | TodoWindow
  | TalkWindow
  | ProgramWindow
  | FileWindow
  | KnowledgeWindow
  | SearchWindow;

/** Root window 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** 生成 window id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: Exclude<WindowType, "root">): string {
  const prefix = ({
    command_exec: "f",
    do: "w_do",
    todo: "w_todo",
    talk: "w_talk",
    program: "w_prog",
    file: "w_file",
    knowledge: "w_kn",
    search: "w_search",
  } as const)[type];
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 派生稳定的 creator do_window id（spec § 初始 creator 对话 window）。 */
export function creatorWindowIdOf(threadId: string): string {
  return `w_creator_${threadId}`;
}

/** root thread 的 creator 约定值（spec § 初始 creator 对话 window，root thread 无父）。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";
