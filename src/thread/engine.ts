/**
 * 线程树执行引擎
 *
 * 封装完整的执行流程：
 * 1. 创建 ThreadsTree（Root 线程）
 * 2. 构建 Context → 调用 LLM → 解析输出
 * 3. 应用 ThinkLoop 结果（actions、状态变更、子线程创建）
 * 4. 通过 Scheduler 管理线程调度和唤醒
 *
 * 这是 World 和 thread/ 模块之间的桥梁。
 * World.talk() 通过开关路由到此引擎，替代旧的 Flow + ThinkLoop 路径。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { consola } from "consola";

import { ThreadsTree } from "./tree.js";
import { ThreadScheduler, type SchedulerCallbacks } from "./scheduler.js";
import { buildThreadContext } from "./context-builder.js";
import { emitSSE } from "../server/events.js";
import { CodeExecutor, executeShell } from "../executable/executor.js";
import { MethodRegistry, type MethodContext } from "../trait/registry.js";
import { getActiveTraits, traitId } from "../trait/activator.js";
import { FormManager } from "./form.js";
import { collectCommandTraits, collectCommandHooks } from "./hooks.js";
import { buildAvailableTools } from "./tools.js";

import type { LLMClient, Message, ToolCall } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, ContextWindow } from "../types/index.js";
import type { SkillDefinition } from "../skill/types.js";
import { writeDebugLoop, computeContextStats, getExistingLoopCount } from "./debug.js";
import { loadSkillBody } from "../skill/loader.js";
import type {
  ThreadsTreeFile,
  ThreadDataFile,
  ThreadAction,
  ThreadStatus,
} from "./types.js";

/* ========== 类型定义 ========== */

/** 引擎配置 */
export interface EngineConfig {
  /** OOC 根目录 */
  rootDir: string;
  /** Flows 目录（session 数据存放位置） */
  flowsDir: string;
  /** LLM 客户端 */
  llm: LLMClient;
  /** 通讯录 */
  directory: DirectoryEntry[];
  /** 所有已加载的 trait 定义 */
  traits: TraitDefinition[];
  /** 已加载的 Skill 定义列表 */
  skills?: SkillDefinition[];
  /** Stone 数据 */
  stone: StoneData;
  /** 额外知识窗口 */
  extraWindows?: ContextWindow[];
  /** 沙箱路径 */
  paths?: Record<string, string>;
  /** 检查对象是否暂停 */
  isPaused?: (name: string) => boolean;
  /**
   * 跨 Object talk 回调（由 World 注入）
   *
   * 当 LLM 输出 [talk] 且 target 不是当前 Object 时调用。
   * World 负责路由：启动目标 Object 的线程树，等待完成，返回结果。
   *
   * @param targetObject - 目标对象名
   * @param message - 消息内容
   * @param fromObject - 发起方对象名
   * @param fromThreadId - 发起方线程 ID
   * @param sessionId - 当前 session ID
   * @param continueThreadId - 可选，继续对方已有线程（而非新建）
   * @param messageId - 可选，本次 message_out action 的 id（用于 target="user" 时写入 user inbox 索引）
   * @returns { reply, remoteThreadId } — 对方回复 + 对方线程 ID
   */
  onTalk?: (
    targetObject: string,
    message: string,
    fromObject: string,
    fromThreadId: string,
    sessionId: string,
    continueThreadId?: string,
    messageId?: string,
  ) => Promise<{ reply: string | null; remoteThreadId: string }>;
  /** 是否开启 debug 模式（持久化每轮 ThinkLoop 的 LLM 输入/输出） */
  debugEnabled?: boolean;
  /** Scheduler 配置覆盖 */
  schedulerConfig?: {
    maxIterationsPerThread?: number;
    maxTotalIterations?: number;
    deadlockGracePeriodMs?: number;
  };
}

/** 执行结果 */
export interface TalkResult {
  /** Session ID */
  sessionId: string;
  /** Root 线程最终状态 */
  status: ThreadStatus;
  /** Root 线程摘要 */
  summary?: string;
  /** 总迭代次数 */
  totalIterations: number;
  /** 实际执行的线程 ID（用于 continue_thread） */
  threadId?: string;
}

/**
 * world.talk() / resumeFlow() / stepOnce() 的统一返回类型
 *
 * 替代直接返回 Flow 实例：线程树架构下 Flow 类不再作为返回契约，
 * 而是以一个纯数据对象暴露外部消费者需要的字段。
 *
 * 调用方只需读取 sessionId/status/messages/actions/summary，
 * 与 Flow.toJSON() 的结构保持一致，由 writeSessionArtifact 落盘到 data.json。
 */
export interface TalkReturn {
  /** 会话 ID（即 mainFlow/rootThread 的 sessionId） */
  sessionId: string;
  /** 最终状态（按 FlowStatus 枚举：running/waiting/pausing/finished/failed） */
  status: "running" | "waiting" | "pausing" | "finished" | "failed";
  /** 消息列表（与 FlowMessage 同形） */
  messages: Array<{ direction: "in" | "out"; from: string; to: string; content: string; timestamp: number; id?: string }>;
  /** 行为树动作（扁平列表，来自线程树 actions 的投影） */
  actions: Array<{ type: string; content: string; timestamp: number; id?: string; result?: string; success?: boolean }>;
  /** 对话摘要 */
  summary?: string;
  /** 关联的底层线程 ID（用于 continue_thread） */
  threadId?: string;
  /** toJSON 快照（供 HTTP 调试/前端消费，形态与 Flow.toJSON 兼容） */
  toJSON?: () => Record<string, unknown>;
}

/* ========== 辅助函数 ========== */

/** 生成 session ID */
function generateSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 生成 message_out action 的消息 id
 *
 * 格式与 tree.ts 中的 inbox message id 保持一致：`msg_<timestamp36>_<rand>`。
 * engine 在推 message_out action 前调用，把 id 同时写入 action.id 和传给 onTalk 回调。
 * 当 target="user" 时，这个 id 就是 user inbox 的 messageId 索引（前端凭此反查正文）。
 */
function genMessageOutId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 生成 talk form 的 formId
 *
 * 格式 `form_<timestamp36>_<rand>`。与 activeForms 的 formId（`f_` 前缀）区分——
 * 后者是 engine 内部的 command form 生命周期，这个是 talk 消息级结构化表单，
 * 独立生命周期。
 */
function genTalkFormId(): string {
  return `form_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 从 submit args 中提取并标准化 talk form payload
 *
 * LLM 可能给出部分字段缺失的 form（如漏 allow_free_text），此处兜底默认值。
 * 返回 null 表示 form 字段缺失/无效，engine 应当退回为普通 talk。
 *
 * @param raw - submit args 中 form 字段的原值
 * @returns 带生成 formId 的标准化 TalkFormPayload，或 null
 */
function extractTalkForm(raw: unknown): import("./types.js").TalkFormPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  if (type !== "single_choice" && type !== "multi_choice") return null;
  const rawOptions = r.options;
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return null;
  const options: import("./types.js").TalkFormOption[] = [];
  for (const opt of rawOptions) {
    if (!opt || typeof opt !== "object") continue;
    const o = opt as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.label !== "string") continue;
    options.push({
      id: o.id,
      label: o.label,
      detail: typeof o.detail === "string" ? o.detail : undefined,
    });
  }
  if (options.length === 0) return null;
  /* allow_free_text 业务上恒 true，LLM 传什么都不影响 */
  const allowFreeText = typeof r.allow_free_text === "boolean" ? r.allow_free_text : true;
  return {
    formId: genTalkFormId(),
    type,
    options,
    allow_free_text: allowFreeText,
  };
}

/**
 * 把 TalkResult（线程树执行产物）落盘为 data.json + 封装为 TalkReturn
 *
 * 线程树路径下 world.talk()/resumeFlow()/stepOnce() 统一通过此函数构造返回值。
 * 不再依赖 Flow 类——直接用 writeFileSync 写入 data.json（HTTP 层通过 readFlow 消费）。
 *
 * @param result - 线程树执行结果
 * @param objectName - 目标对象名
 * @param flowsDir - flows/ 根目录
 * @param incomingMessage - 本次入站消息（可选，追加到 messages[]）
 * @param fromName - 入站消息发送者（默认 "user"）
 * @param incomingTimestamp - 入站消息时间戳（可选）
 */
export function writeThreadTreeFlowData(
  result: TalkResult,
  objectName: string,
  flowsDir: string,
  incomingMessage?: string,
  fromName: string = "user",
  incomingTimestamp?: number,
): TalkReturn {
  const sessionDir = join(flowsDir, result.sessionId);
  const flowDir = join(sessionDir, "objects", objectName);
  const now = Date.now();

  /* 状态映射：ThreadStatus → FlowStatus */
  const status: TalkReturn["status"] =
    result.status === "done" ? "finished"
    : result.status === "failed" ? "failed"
    : result.status === "paused" ? "pausing"
    : "waiting";

  /* 构造 messages[] */
  const messages: TalkReturn["messages"] = [];
  if (incomingMessage) {
    messages.push({
      direction: "in",
      from: fromName,
      to: objectName,
      content: incomingMessage,
      timestamp: incomingTimestamp ?? now,
    });
  }
  if (result.summary) {
    messages.push({
      direction: "out",
      from: objectName,
      to: fromName,
      content: result.summary,
      timestamp: now,
    });
  }

  /* 落盘 data.json（供 /api/flows/:sessionId 的 readFlow 消费） */
  const flowJson = {
    sessionId: result.sessionId,
    stoneName: objectName,
    status,
    messages,
    process: { root: { id: "root", title: "task", status: "done", children: [] }, focusId: "root" },
    data: {},
    summary: result.summary ?? null,
    _remoteThreadId: result.threadId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, "data.json"), JSON.stringify(flowJson, null, 2), "utf-8");
  writeFileSync(join(flowDir, ".flow"), "", "utf-8");

  return {
    sessionId: result.sessionId,
    status,
    messages,
    actions: [],
    summary: result.summary,
    threadId: result.threadId,
    toJSON: () => ({ ...flowJson }),
  };
}

/* ========== Context → LLM Messages 转换 ========== */

/**
 * 将 ThreadContext 转换为 LLM Messages
 *
 * 构建 system + user 两条消息：
 * - system: whoAmI + instructions + knowledge
 * - user: parentExpectation + process + inbox + todos + childrenSummary + directory
 */
function contextToMessages(ctx: ReturnType<typeof buildThreadContext>, deferHooks?: import("./types.js").ThreadFrameHook[]): Message[] {
  const systemParts: string[] = [];

  /* 身份 */
  systemParts.push(`<!-- 对象身份：readme.md 的完整内容 -->`);
  systemParts.push(`<identity name="${ctx.name}">`);
  systemParts.push(ctx.whoAmI);
  systemParts.push(`</identity>`);

  /* 系统指令窗口 */
  if (ctx.instructions.length > 0) {
    systemParts.push(`<!-- 系统指令：激活的 kernel trait 注入的行为规则 -->`);
    for (const w of ctx.instructions) {
      systemParts.push(`<instruction name="${w.name}">\n${w.content}\n</instruction>`);
    }
  }

  /* 知识窗口 */
  if (ctx.knowledge.length > 0) {
    systemParts.push(`<!-- 知识窗口：激活的 library/user trait 和 skill 注入的知识 -->`);
    for (const w of ctx.knowledge) {
      systemParts.push(`<knowledge name="${w.name}">\n${w.content}\n</knowledge>`);
    }
  }

  const userParts: string[] = [];

  /* 父线程期望 */
  if (ctx.parentExpectation) {
    userParts.push(`<!-- 任务：用户消息或父线程对当前线程的期望 -->`);
    userParts.push(`<task>\n  ${ctx.parentExpectation}\n</task>`);
  }

  /* 创建者信息 */
  if (ctx.creationMode === "root") {
    userParts.push(`<creator mode="root">\n  你是根线程，由用户(user)发起。完成任务后必须用 [return] 返回最终结果。[talk] 只用于向其他对象发消息，不会结束线程。\n</creator>`);
  } else {
    userParts.push(`<creator mode="${ctx.creationMode}" from="${ctx.creator}">\n  你是子线程，由 ${ctx.creator} 创建（${ctx.creationMode}）。你的职责是完成 <task> 中描述的具体工作，然后用 [return] 返回结果给创建者。不要重复创建者的工作，专注于你被分配的任务。\n</creator>`);
  }

  /* 当前计划 */
  if (ctx.plan) {
    userParts.push(`<plan>\n  ${ctx.plan}\n</plan>`);
  }

  /* 执行历史 */
  userParts.push(`<!-- 执行历史：当前线程的所有 actions 时间线 -->`);
  if (ctx.process) {
    userParts.push(`<process>\n${ctx.process}\n</process>`);
  } else {
    userParts.push(`<process />`);
  }

  /* 局部变量 */
  if (Object.keys(ctx.locals).length > 0) {
    userParts.push(`<locals>\n  ${JSON.stringify(ctx.locals, null, 2)}\n</locals>`);
  }

  /* inbox */
  if (ctx.inbox.length > 0) {
    const unread = ctx.inbox.filter(m => m.status === "unread");
    const marked = ctx.inbox.filter(m => m.status === "marked");
    userParts.push(`<!-- 收件箱：来自其他对象或系统的消息 -->`);
    userParts.push(`<inbox>`);
    if (unread.length > 0) {
      userParts.push(`  <!-- 未读消息：请在下次工具调用时通过 mark 参数标记 -->`);
      for (const m of unread) {
        userParts.push(`  <message id="${m.id}" from="${m.from}" status="unread">\n    ${m.content}\n  </message>`);
      }
    }
    if (marked.length > 0) {
      userParts.push(`  <!-- 已标记消息 -->`);
      for (const m of marked) {
        const markAttr = m.mark ? ` mark="${m.mark.type}" tip="${m.mark.tip}"` : "";
        userParts.push(`  <message id="${m.id}" from="${m.from}" status="marked"${markAttr}>\n    ${m.content}\n  </message>`);
      }
    }
    userParts.push(`</inbox>`);
  }

  /* todos */
  if (ctx.todos.length > 0) {
    userParts.push(`<todos>`);
    for (const t of ctx.todos) {
      userParts.push(`  <todo>${t.content}</todo>`);
    }
    userParts.push(`</todos>`);
  }

  /* defer hooks：展示已注册的 command hooks，让 LLM 在决策前看到 */
  if (deferHooks && deferHooks.length > 0) {
    const onHooks = deferHooks.filter(h => h.event.startsWith("on:"));
    if (onHooks.length > 0) {
      userParts.push(`<!-- defer 提醒：你之前注册的 command hook，对应 command 执行时请注意 -->`);
      userParts.push(`<defers>`);
      for (const h of onHooks) {
        const cmd = h.event.slice(3); /* 去掉 "on:" 前缀 */
        userParts.push(`  <defer command="${cmd}"${h.once === false ? ' once="false"' : ""}>${h.content}</defer>`);
      }
      userParts.push(`</defers>`);
    }
  }

  /* 子节点摘要 */
  if (ctx.childrenSummary) {
    const allDone = ctx.childrenSummary.includes("[done]") && !ctx.childrenSummary.includes("[running]") && !ctx.childrenSummary.includes("[pending]") && !ctx.childrenSummary.includes("[waiting]");
    const hint = allDone ? `\n  <!-- 所有子线程已完成。请汇总子线程的结果，然后用 [return] 返回最终结果。 -->` : "";
    userParts.push(`<!-- 子线程：当前线程创建的子线程状态摘要 -->`);
    userParts.push(`<children>${hint}\n  ${ctx.childrenSummary}\n</children>`);
  }

  /* 祖先摘要 */
  if (ctx.ancestorSummary) {
    userParts.push(`<ancestors>\n  ${ctx.ancestorSummary}\n</ancestors>`);
  }

  /* 兄弟摘要 */
  if (ctx.siblingSummary) {
    userParts.push(`<siblings>\n  ${ctx.siblingSummary}\n</siblings>`);
  }

  /* 通讯录 */
  if (ctx.directory.length > 0) {
    userParts.push(`<!-- 通讯录：可通过 talk 联系的对象 -->`);
    userParts.push(`<directory>`);
    for (const d of ctx.directory) {
      userParts.push(`  <object name="${d.name}">${d.whoAmI}</object>`);
    }
    userParts.push(`</directory>`);
  }

  /* 沙箱路径 */
  if (ctx.paths && Object.keys(ctx.paths).length > 0) {
    userParts.push(`<paths>${JSON.stringify(ctx.paths)}</paths>`);
  }

  /* 状态 */
  userParts.push(`<status>${ctx.status}</status>`);

  return [
    { role: "system", content: systemParts.join("\n") },
    { role: "user", content: userParts.join("\n") },
  ];
}

/* ========== 核心引擎 ========== */

/**
 * 使用线程树执行一次对话
 *
 * 完整流程：
 * 1. 创建 session 目录和 ThreadsTree
 * 2. 将初始消息写入 Root 线程的 inbox
 * 3. 创建 Scheduler + callbacks
 * 4. 运行调度循环直到所有线程完成
 * 5. 返回执行结果
 *
 * @param objectName - 对象名称
 * @param message - 用户消息
 * @param from - 消息来源
 * @param config - 引擎配置
 * @param preSessionId - 可选，预创建的 session ID
 * @param continueThreadId - 可选，继续已有线程（而非新建/重置根线程）
 * @returns 执行结果
 */
export async function runWithThreadTree(
  objectName: string,
  message: string,
  from: string,
  config: EngineConfig,
  preSessionId?: string,
  continueThreadId?: string,
): Promise<TalkResult> {
  const sessionId = preSessionId ?? generateSessionId();
  const sessionDir = join(config.flowsDir, sessionId);
  const objectFlowDir = join(sessionDir, "objects", objectName);
  mkdirSync(objectFlowDir, { recursive: true });

  /* 创建 .session.json 标志文件（如果不存在），或补充空 title */
  const sessionFile = join(sessionDir, ".session.json");
  if (!existsSync(sessionFile)) {
    const title = message.slice(0, 20).replace(/\n/g, " ");
    writeFileSync(sessionFile, JSON.stringify({
      sessionId,
      title,
      createdAt: Date.now(),
    }, null, 2), "utf-8");
  } else {
    /* 预创建的 session 可能 title 为空，用第一条消息补充 */
    try {
      const meta = JSON.parse(readFileSync(sessionFile, "utf-8"));
      if (!meta.title) {
        meta.title = message.slice(0, 20).replace(/\n/g, " ");
        if (!meta.sessionId) meta.sessionId = sessionId;
        writeFileSync(sessionFile, JSON.stringify(meta, null, 2), "utf-8");
      }
    } catch { /* 解析失败忽略 */ }
  }

  consola.info(`[Engine] 开始执行 ${objectName}, session=${sessionId}`);

  /* 1. 加载或创建 ThreadsTree + Root 线程 */
  let tree = ThreadsTree.load(objectFlowDir);
  /* 实际接收消息的线程 ID（默认根线程，continue 模式下为指定线程） */
  let targetThreadId: string;

  if (!tree) {
    consola.info(`[Engine] 创建新的线程树: ${objectName}`);
    tree = await ThreadsTree.create(objectFlowDir, `${objectName} 主线程`, message);
    targetThreadId = tree.rootId;
  } else if (continueThreadId) {
    /* continue 模式：向指定线程写入消息并唤醒 */
    const targetNode = tree.getNode(continueThreadId);
    if (targetNode) {
      if (targetNode.status === "done" || targetNode.status === "failed") {
        await tree.setNodeStatus(continueThreadId, "running");
        consola.info(`[Engine] continue 线程 ${continueThreadId}: ${targetNode.status} → running`);
      }
      targetThreadId = continueThreadId;
    } else {
      /* 指定的线程不存在，回退到根线程 */
      consola.warn(`[Engine] continue 线程 ${continueThreadId} 不存在，回退到根线程`);
      const rootNode = tree.getNode(tree.rootId);
      if (rootNode && rootNode.status === "done") {
        await tree.setNodeStatus(tree.rootId, "running");
      }
      targetThreadId = tree.rootId;
    }
  } else {
    consola.info(`[Engine] 加载已存在的线程树: ${objectName}, rootId=${tree.rootId}`);
    /* 多轮对话：如果根线程已完成，重置为 running 以处理新消息 */
    const rootNode = tree.getNode(tree.rootId);
    if (rootNode && rootNode.status === "done") {
      await tree.setNodeStatus(tree.rootId, "running");
      consola.info(`[Engine] 重置根线程状态: done → running（多轮对话续写）`);
    }
    targetThreadId = tree.rootId;
  }

  /* 2. 将初始消息写入目标线程的 inbox */
  tree.writeInbox(targetThreadId, {
    from,
    content: message,
    source: "talk",
  });

  /* 3. 发射 SSE 开始事件 */
  emitSSE({ type: "flow:start", objectName, sessionId });

  /* 4. 记录总迭代次数 */
  let totalIterations = 0;

  /* 4.1 创建代码执行器 */
  const executor = new CodeExecutor();

  /* 4.2 注册 Trait 方法 */
  const methodRegistry = new MethodRegistry();
  methodRegistry.registerAll(config.traits);

  /* 4.3 构建执行上下文工厂（每次 program 执行时调用） */
  const buildExecContext = (threadId: string): { context: Record<string, unknown>; getOutputs: () => string[] } => {
    const outputs: string[] = [];
    const isThenable = (v: unknown): v is PromiseLike<unknown> =>
      v != null && (typeof v === "object" || typeof v === "function") && "then" in (v as any);
    const printFn = (...args: unknown[]) => {
      const hasPromise = args.some(isThenable);
      const text = args
        .map(a => (isThenable(a) ? "[Promise]" : String(a)))
        .join(" ");
      outputs.push(hasPromise
        ? `${text}\n(提示：检测到 Promise，请使用 \"await\" 获取值后再 print)`
        : text);
    };

    const stoneDir = config.paths?.stoneDir ?? "";
    const rootDir = config.paths?.rootDir ?? config.rootDir;

    const context: Record<string, unknown> = {
      /* 基础路径（沙箱变量名） */
      self_dir: stoneDir,
      self_files_dir: join(stoneDir, "files"),
      world_dir: rootDir,
      filesDir: join(objectFlowDir, "files"),

      /* MethodContext 兼容字段（trait 方法通过这些字段访问） */
      rootDir: rootDir,
      sessionId: sessionId,
      selfDir: stoneDir,
      stoneName: objectName,
      data: config.stone.data,

      /* 基础 API */
      print: printFn,
      getData: (key: string) => config.stone.data[key],
      getAllData: () => ({ ...config.stone.data }),
      setData: (key: string, value: unknown) => { config.stone.data[key] = value; },

      /* 文件 API（沙箱内） */
      readFile: (path: string) => {
        const resolved = resolve(rootDir, path);
        if (!existsSync(resolved)) return null;
        return readFileSync(resolved, "utf-8");
      },
      writeFile: (path: string, content: string) => {
        const resolved = resolve(rootDir, path);
        mkdirSync(resolve(resolved, ".."), { recursive: true });
        writeFileSync(resolved, content, "utf-8");
      },
      listFiles: (path: string) => {
        const resolved = resolve(rootDir, path);
        if (!existsSync(resolved)) return [];
        return readdirSync(resolved);
      },
      fileExists: (path: string) => {
        return existsSync(resolve(rootDir, path));
      },

      /* local 变量 */
      local: tree.readThreadData(threadId)?.locals ?? {},
    };

    const normalizeTraitId = (input: string): string | null => {
      const trimmed = input.trim();
      if (!trimmed) return null;
      const all = new Set(config.traits.map(t => traitId(t)));
      /* 完整 traitId 直接命中 */
      if (all.has(trimmed)) return trimmed;
      /* 省略 namespace：按 self → kernel → library 顺序查找 */
      if (!trimmed.includes(":")) {
        for (const ns of ["self", "kernel", "library"] as const) {
          const candidate = `${ns}:${trimmed}`;
          if (all.has(candidate)) return candidate;
        }
      }
      return null;
    };

    const readTraitFile = (id: string): { path: string; content: string } | null => {
      let base: string | null = null;
      if (id.startsWith("library:")) {
        base = join(rootDir, "library", "traits", id.slice("library:".length));
      } else if (id.startsWith("kernel:")) {
        base = join(rootDir, "kernel", "traits", id.slice("kernel:".length));
      } else if (id.startsWith("self:")) {
        base = join(rootDir, "stones", objectName, "traits", id.slice("self:".length));
      }
      if (!base) return null;
      const p = join(base, "TRAIT.md");
      if (!existsSync(p)) return null;
      return { path: p, content: readFileSync(p, "utf-8") };
    };

    const computeActiveTraitIds = (): string[] => {
      const scopeChain = tree.computeScopeChain(threadId);
      return getActiveTraits(config.traits, scopeChain).map(t => traitId(t));
    };

    /* 注入 Trait 方法（Phase 2 协议：只暴露 callMethod 单函数） */
    let activeTraitNames = computeActiveTraitIds();
    const methodCtx: MethodContext = {
      setData: (key: string, value: unknown) => { config.stone.data[key] = value; },
      getData: (key: string) => config.stone.data[key],
      print: printFn,
      sessionId,
      filesDir: join(objectFlowDir, "files"),
      rootDir,
      selfDir: stoneDir,
      stoneName: objectName,
      data: { ...config.stone.data },
    };
    /* 沙箱只暴露 { callMethod }，无需动态注入/清理每个方法名 */
    const sandboxApi = methodRegistry.buildSandboxMethods(methodCtx, objectName);
    Object.assign(context, sandboxApi);
    /* 保留接口兼容：某些内部 API 仍调 injectTraitMethods 以感知 trait 切换 */
    const injectTraitMethods = (_traitIds: string[]) => {
      /* no-op：callMethod 内部每次调用时实时查 registry，trait 切换自动生效 */
    };

    // 首次注入（no-op，保留调用以便以后扩展）
    injectTraitMethods(activeTraitNames);

    // 管理/自省 API（避免 agent “猜 API”）
    Object.assign(context, {
      listLibraryTraits: () => config.traits.map(t => traitId(t)).sort(),
      listTraits: () => config.traits.map(t => traitId(t)).sort(),
      listActiveTraits: () => computeActiveTraitIds().sort(),
      readTrait: (name: string) => {
        const id = normalizeTraitId(name) ?? name;
        return readTraitFile(id);
      },
      activateTrait: async (name: string) => {
        const id = normalizeTraitId(name);
        if (!id) {
          return { ok: false, error: `未知 trait: ${name}` };
        }
        const changed = await tree.activateTrait(threadId, id);
        activeTraitNames = computeActiveTraitIds();
        injectTraitMethods(activeTraitNames);
        return { ok: true, changed, traitId: id, activeTraits: activeTraitNames.sort() };
      },
      deactivateTrait: async (name: string) => {
        const id = normalizeTraitId(name) ?? name;
        const changed = await tree.deactivateTrait(threadId, id);
        activeTraitNames = computeActiveTraitIds();
        injectTraitMethods(activeTraitNames);
        return { ok: true, changed, traitId: id, activeTraits: activeTraitNames.sort() };
      },
      methods: (trait?: string) => {
        const act = new Set(computeActiveTraitIds());
        const all = methodRegistry.all().filter(m => act.has(m.traitName));
        const filtered = trait
          ? all.filter(m => m.traitName === (normalizeTraitId(trait) ?? trait))
          : all;
        return filtered
          .map(m => ({
            name: m.name,
            trait: m.traitName,
            description: m.description,
            params: m.params,
          }))
          .sort((a, b) => (a.trait + a.name).localeCompare(b.trait + b.name));
      },
      help: () => [
        "可用沙箱自省/管理 API：",
        "- listTraits() / listLibraryTraits()",
        "- listActiveTraits()",
        "- readTrait(name) -> { path, content }",
        "- activateTrait(name) / deactivateTrait(name)",
        "- methods(trait?) -> [{name, trait, description, params}]",
        "提示：如 print 出现 [Promise]，请用 await 获取结果",
      ].join("\n"),
    });

    return { context, getOutputs: () => outputs };
  };

  /* 5. 创建 Scheduler */
  const scheduler = new ThreadScheduler({
    maxIterationsPerThread: config.schedulerConfig?.maxIterationsPerThread ?? 100,
    maxTotalIterations: config.schedulerConfig?.maxTotalIterations ?? 500,
    deadlockGracePeriodMs: config.schedulerConfig?.deadlockGracePeriodMs ?? 30_000,
  });

  /* 5b. 注入线程复活回调（done 线程收到 inbox 消息时自动唤醒） */
  tree.setRevivalCallback((nodeId) => {
    scheduler.onThreadCreated(nodeId, objectName);
  });

  /* 6. 检查暂停 */
  if (config.isPaused?.(objectName)) {
    scheduler.pauseObject(objectName);
  }

  /* 7. debug 计数器 */
  let debugLoopCounter = 0;

  /* 7b. 每线程独立的 FormManager（从 threadData.activeForms 恢复） */

  /* 8. 创建 SchedulerCallbacks */
  const callbacks: SchedulerCallbacks = {
    runOneIteration: async (threadId: string, _objectName: string) => {
      totalIterations++;

      /* 读取线程数据 */
      const threadData = tree.readThreadData(threadId);
      if (!threadData) {
        throw new Error(`线程数据不存在: ${threadId}`);
      }

      /* 每次迭代从 threadData 恢复 FormManager（线程隔离） */
      const formManager = FormManager.fromData(threadData.activeForms ?? []);

      /* 读取树的内部结构用于 Context 构建 */
      const treeFile = buildTreeFileSnapshot(tree);

      let llmOutput: string;
      let thinkingContent: string | undefined;
      let toolCalls: ToolCall[] | undefined;
      let llmLatencyMs = 0;
      let llmModel = "unknown";
      let llmUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
      let context: ReturnType<typeof buildThreadContext> | undefined;
      let messages: Message[] | undefined;

      /* 检查是否有缓存的 LLM 输出（resume 模式） */
      if (threadData._pendingOutput) {
        /* 优先从文件读取（用户可能已修改） */
        const debugDir = join(objectFlowDir, "threads", threadId);
        const outputFile = join(debugDir, "llm.output.txt");
        if (existsSync(outputFile)) {
          llmOutput = readFileSync(outputFile, "utf-8");
          unlinkSync(outputFile);
          const thinkingFile = join(debugDir, "llm.thinking.txt");
          if (existsSync(thinkingFile)) {
            thinkingContent = readFileSync(thinkingFile, "utf-8");
            unlinkSync(thinkingFile);
          }
          const inputFile = join(debugDir, "llm.input.txt");
          if (existsSync(inputFile)) unlinkSync(inputFile);
        } else {
          /* fallback 到内存缓存 */
          llmOutput = threadData._pendingOutput;
          thinkingContent = threadData._pendingThinkingOutput;
        }

        /* 清除缓存 */
        delete threadData._pendingOutput;
        delete threadData._pendingThinkingOutput;
        tree.writeThreadData(threadId, threadData);

        consola.info(`[Engine] 使用缓存输出 (resume), thread=${threadId}`);
      } else {
        /* 构建 Context */
        context = buildThreadContext({
          tree: treeFile,
          threadId,
          threadData,
          stone: config.stone,
          directory: config.directory,
          traits: config.traits,
          extraWindows: config.extraWindows,
          paths: config.paths,
          skills: config.skills,
        });

        /* 转换为 LLM Messages */
        messages = contextToMessages(context, threadData.hooks);

        /* 追加活跃 form 信息到 context（让 LLM 知道当前有哪些未完成的 form） */
        const activeForms = formManager.activeForms();
        if (activeForms.length > 0) {
          const formXml = activeForms.map(f =>
            `<form id="${f.formId}" command="${f.command}"${f.trait ? ` trait="${f.trait}"` : ""}>${f.description}</form>`,
          );
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === "user") {
            lastMsg.content += `\n<!-- 活跃 Form：已 open 等待 submit 或 close -->\n<active-forms>\n${formXml.join("\n")}\n</active-forms>`;
          }
        }

        /* 构建动态 tools 列表 */
        const availableTools = buildAvailableTools(formManager.activeCommands());

        /* 调用 LLM（带 tools） */
        const llmStartTime = Date.now();
        const llmResult = await config.llm.chat(messages, { tools: availableTools });
        llmLatencyMs = Date.now() - llmStartTime;
        llmOutput = llmResult.content;
        thinkingContent = llmResult.thinkingContent;
        llmModel = (llmResult as any).model || "unknown";
        llmUsage = (llmResult as any).usage ?? {};
        toolCalls = llmResult.toolCalls;

        /* LLM 返回后检查暂停信号 */
        if (config.isPaused?.(objectName)) {
          /* 缓存 LLM 输出到线程数据 */
          threadData._pendingOutput = llmOutput;
          if (thinkingContent) {
            threadData._pendingThinkingOutput = thinkingContent;
          }
          tree.writeThreadData(threadId, threadData);

          /* 写入调试文件（与旧系统兼容） */
          const debugDir = join(objectFlowDir, "threads", threadId);
          mkdirSync(debugDir, { recursive: true });
          writeFileSync(join(debugDir, "llm.output.txt"), llmOutput, "utf-8");
          if (thinkingContent) {
            writeFileSync(join(debugDir, "llm.thinking.txt"), thinkingContent, "utf-8");
          }
          /* 写入 Context 供人工查看 */
          const inputContent = messages.map(m => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n");
          writeFileSync(join(debugDir, "llm.input.txt"), inputContent, "utf-8");

          consola.info(`[Engine] 暂停 thread=${threadId}, 输出已缓存`);

          /* 将线程状态改为 paused */
          await tree.setNodeStatus(threadId, "paused");

          /* 通知 scheduler 暂停此对象 */
          scheduler.pauseObject(objectName);
          return;
        }
      }

      /* 发射 SSE 思考事件 + 记录 thinking action（从 thinking mode 获取） */
      if (thinkingContent) {
        emitSSE({
          type: "stream:thought",
          objectName,
          sessionId,
          chunk: thinkingContent,
        });

        /* 将 thinking 输出记录为 thinking action */
        const td = tree.readThreadData(threadId);
        if (td) {
          td.actions.push({
            type: "thinking",
            content: thinkingContent,
            timestamp: Date.now(),
          });
          tree.writeThreadData(threadId, td);
        }
      }

      /* ========== Tool Calling 路径 ========== */
      if (toolCalls && toolCalls.length > 0) {
        /* 非 tool 文本输出记录为 text（跳过已被 thinking mode 记录的内容） */
        if (llmOutput?.trim() && llmOutput !== thinkingContent) {
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({ type: "text", content: llmOutput, timestamp: Date.now() });
            tree.writeThreadData(threadId, td);
          }
        }

        /* 处理第一个 tool call（每轮只处理一个） */
        const tc = toolCalls[0]!;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}
        const toolName = tc.function.name;

        /**
         * 剥离顶层 title（自叙式行动标题）
         *
         * submit 场景特殊：create_sub_thread 的老用法把 title 当作子线程标题。
         * engine 在 submit 分支处理时需要能读到 title（作为子线程名 fallback），
         * 所以这里**不删除** args.title，让 submit 分支按 command 类型自行决定。
         * 其他 tool（open/close/wait）下，title 仅作为 action 标题，args 中是否保留不影响业务逻辑。
         */
        const rawTitle = typeof args.title === "string" ? args.title : undefined;
        const actionTitle = rawTitle;

        consola.info(`[Engine] tool_call: ${toolName}${actionTitle ? ` "${actionTitle}"` : ""}(${JSON.stringify(args).slice(0, 200)})`);

        /* 记录 tool_use action（含 title） */
        {
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({
              type: "tool_use",
              content: `${toolName}(${JSON.stringify(args).slice(0, 200)})`,
              name: toolName,
              args,
              title: actionTitle,
              timestamp: Date.now(),
            });
            tree.writeThreadData(threadId, td);
          }
        }

        /* SSE 事件：把本次 tool call 的 title 立即广播给前端 */
        if (actionTitle) {
          emitSSE({
            type: "flow:action",
            objectName,
            sessionId,
            action: {
              type: "tool_use",
              name: toolName,
              title: actionTitle,
              content: `${toolName}`,
              timestamp: Date.now(),
            },
          });
        }

        /* 处理 mark 参数（三个 tool 通用） */
        if (Array.isArray(args.mark)) {
          for (const m of args.mark as { messageId: string; type: "ack" | "ignore" | "todo"; tip: string }[]) {
            tree.markInbox(threadId, m.messageId, m.type, m.tip);
            /* 记录 mark_inbox action */
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({ type: "mark_inbox", content: `标记消息 #${m.messageId}: ${m.type} — ${m.tip}`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
          }
        }

        /* --- Open --- */
        if (toolName === "open") {
          const openType = args.type as string;
          const command = args.command as string;
          const description = args.description as string ?? "";

          if (openType === "command" && command) {
            // 指令类 open：和旧的 begin 逻辑一样
            const formId = formManager.begin(command, description, {
              trait: args.trait as string,
              functionName: args.function_name as string,
            });
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommands());
            for (const traitName of traitsToLoad) await tree.activateTrait(threadId, traitName);
            if (command === "call_function" && args.trait) await tree.activateTrait(threadId, args.trait as string);

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              td.actions.push({ type: "inject", content: `Form ${formId} 已创建（${command}）。相关知识已加载。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] open command: ${command} → ${formId}`);

          } else if (openType === "trait" && args.name) {
            /* trait 加载：支持模糊匹配（精确 → 前缀补全 → 尾部匹配） */
            const traitInput = args.name as string;
            const allTraitIds = config.traits.map(t => traitId(t));
            let resolvedTraitName = allTraitIds.find(id => id === traitInput) ?? null;
            if (!resolvedTraitName && !traitInput.includes("/")) {
              // 前缀补全
              resolvedTraitName = allTraitIds.find(id => id === `library/${traitInput}` || id === `kernel/${traitInput}`) ?? null;
              // 尾部匹配
              if (!resolvedTraitName) {
                resolvedTraitName = allTraitIds.find(id => id.endsWith(`/${traitInput}`)) ?? null;
              }
            }

            if (resolvedTraitName) {
              await tree.activateTrait(threadId, resolvedTraitName);
              const formId = formManager.begin("_trait", description, { trait: resolvedTraitName });
              const td = tree.readThreadData(threadId);
              if (td) {
                td.activeForms = formManager.toData();
                td.actions.push({ type: "inject", content: `Trait ${resolvedTraitName} 已加载。`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open trait: ${traitInput} → ${resolvedTraitName} → ${formId}`);
            } else {
              const available = allTraitIds.filter(id => !id.startsWith("kernel:") || id.includes("kernel:plannable/") || id.includes("kernel:computable/")).slice(0, 30).join(", ");
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "inject", content: `[错误] Trait "${traitInput}" 不存在。可用 trait: ${available || "(无)"}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.warn(`[Engine] open trait: ${traitInput} not found`);
            }

          } else if (openType === "skill" && args.name) {
            // skill 加载
            const skillName = args.name as string;
            const skillDef = config.skills?.find(s => s.name === skillName);
            let injectContent: string;
            if (skillDef) {
              const body = loadSkillBody(skillDef.dir);
              injectContent = body ?? `[错误] Skill "${skillName}" 内容为空`;
            } else {
              injectContent = `[错误] 未找到 Skill "${skillName}"`;
            }
            const formId = formManager.begin("_skill", description, { trait: skillName });
            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              td.actions.push({ type: "inject", content: injectContent, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] open skill: ${skillName} → ${formId}`);

          } else if (openType === "file" && args.path) {
            // 文件读取：读取文件内容到 context window
            const filePath = args.path as string;
            const linesLimit = args.lines as number | undefined;
            const rootDir = config.paths?.rootDir ?? config.rootDir;
            const resolved = resolve(rootDir, filePath);

            if (!existsSync(resolved)) {
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "inject", content: `[错误] 文件 "${filePath}" 不存在`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.warn(`[Engine] open file: ${filePath} not found`);
            } else {
              let content = readFileSync(resolved, "utf-8");
              if (linesLimit && linesLimit > 0) {
                const lines = content.split("\n");
                content = lines.slice(0, linesLimit).join("\n");
                if (lines.length > linesLimit) {
                  content += `\n... (共 ${lines.length} 行，已截取前 ${linesLimit} 行)`;
                }
              }

              const formId = formManager.begin("_file", description, { trait: filePath });
              const td = tree.readThreadData(threadId);
              if (td) {
                if (!td.windows) td.windows = {};
                td.windows[filePath] = {
                  name: filePath,
                  content,
                  formId,
                  updatedAt: Date.now(),
                };
                td.activeForms = formManager.toData();
                td.actions.push({ type: "inject", content: `文件 "${filePath}" 已加载到上下文窗口。${linesLimit ? `（前 ${linesLimit} 行）` : ""}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open file: ${filePath}${linesLimit ? ` (${linesLimit} lines)` : ""} → ${formId}`);
            }
          }
        }

        /* --- Submit --- */
        else if (toolName === "submit") {
          const form = formManager.submit(args.form_id as string ?? "");

          if (!form) {
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({ type: "inject", content: `[错误] Form ${args.form_id} 不存在。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
          } else {
            const command = form.command;

            /* program */
            if (command === "program" && args.code) {
              const { context: execCtx, getOutputs } = buildExecContext(threadId);
              const lang = (args.lang as string) ?? "javascript";
              const execResult = lang === "shell"
                ? await executeShell(args.code as string, config.rootDir)
                : await executor.execute(args.code as string, execCtx);
              const allOutputs = [...getOutputs()];
              if (execResult.stdout) allOutputs.push(execResult.stdout);
              if (execResult.returnValue != null) {
                allOutputs.push(typeof execResult.returnValue === "string"
                  ? execResult.returnValue : JSON.stringify(execResult.returnValue, null, 2));
              }
              const outputText = allOutputs.join("\n").trim();
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({
                  type: "program", content: args.code as string, success: execResult.success,
                  result: execResult.success
                    ? (outputText ? `>>> output:\n${outputText}` : ">>> output: (无输出)")
                    : `>>> error: ${execResult.error}`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] program ${execResult.success ? "成功" : "失败"}`);
            }

            /* talk / talk_sync */
            else if ((command === "talk" || command === "talk_sync") && config.onTalk) {
              const target = (args.target as string)?.toLowerCase();
              if (target && target !== objectName.toLowerCase()) {
                const continueThreadId = args.continue_thread as string | undefined;
                /* 先生成 messageId（供 action.id 和 onTalk 参数共用，前端凭此反查正文） */
                const messageId = genMessageOutId();
                /* 解析可选的结构化表单（talk form）——供前端渲染 option picker */
                const formPayload = extractTalkForm(args.form);
                const td = tree.readThreadData(threadId);
                if (td) {
                  const continueLabel = continueThreadId ? ` (continue: ${continueThreadId})` : "";
                  const formLabel = formPayload ? ` [form: ${formPayload.formId}]` : "";
                  td.actions.push({
                    id: messageId,
                    type: "message_out",
                    content: `[talk] → ${args.target}: ${args.message}${continueLabel}${formLabel}`,
                    timestamp: Date.now(),
                    ...(formPayload ? { form: formPayload } : {}),
                  });
                  tree.writeThreadData(threadId, td);
                }
                /* talk_sync 到 user 是死锁：user 永远不会唤醒。记日志、不 setNodeStatus("waiting")、直接继续。 */
                const isTalkSyncToUser = command === "talk_sync" && target === "user";
                if (isTalkSyncToUser) {
                  consola.warn(`[Engine] ${objectName} 尝试 talk_sync(target="user")——user 不参与 ThinkLoop，不会回复。已降级为 talk（不阻塞）。`);
                }
                /* 若未通过 mark 参数显式标记，且 target 只有一条未读最新消息，自动 ack */
                const explicitlyMarked = Array.isArray(args.mark) && args.mark.length > 0;
                try {
                  const { reply, remoteThreadId } = await config.onTalk(args.target as string, args.message as string, objectName, threadId, sessionId, continueThreadId, messageId);
                  if (!explicitlyMarked) {
                    const tdAck = tree.readThreadData(threadId);
                    const autoAckId = getAutoAckMessageId(tdAck, args.target as string);
                    if (autoAckId) {
                      tree.markInbox(threadId, autoAckId, "ack", "已回复");
                    }
                  }
                  if (reply) {
                    tree.writeInbox(threadId, { from: args.target as string, content: `${reply}\n[remote_thread_id: ${remoteThreadId}]`, source: "talk" });
                  }
                  /* 将 remote_thread_id 记录到 actions（无论是否有 reply，LLM 都能看到） */
                  const td2 = tree.readThreadData(threadId);
                  if (td2) {
                    td2.actions.push({ type: "inject", content: `[talk → ${args.target}] remote_thread_id = ${remoteThreadId}`, timestamp: Date.now() });
                    tree.writeThreadData(threadId, td2);
                  }
                } catch (e) {
                  tree.writeInbox(threadId, { from: "system", content: `[talk 失败] ${(e as Error).message}`, source: "system" });
                }
                /* target=user 时不 setNodeStatus("waiting")，避免死锁；其他 target 维持原逻辑 */
                if (command === "talk_sync" && !isTalkSyncToUser) tree.setNodeStatus(threadId, "waiting");
              }
            }

            /* return */
            else if (command === "return") {
              await tree.returnThread(threadId, args.summary as string ?? "");
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "thread_return", content: args.summary as string ?? "", timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] return: ${(args.summary as string)?.slice(0, 100)}`);
            }

            /* create_sub_thread */
            else if (command === "create_sub_thread") {
              /* 子线程标题 = tool call 的 title（天然同一语义） */
              const subThreadName = (args.title as string | undefined) ?? "";
              const child = await tree.createSubThread(threadId, subThreadName, {
                description: args.description as string,
                traits: args.traits as string[],
              });
              if (child) {
                // 设置子线程为 running
                await tree.setNodeStatus(child, "running");

                const td = tree.readThreadData(threadId);
                if (td) {
                  const childId = child ?? "?";
                  td.actions.push({
                    type: "create_thread",
                    content: `[create_sub_thread] ${subThreadName} → ${childId}`,
                    timestamp: Date.now()
                  });
                  // 立即注入 thread_id，让 LLM 在当前轮就能看到
                  td.actions.push({
                    type: "inject",
                    content: `[form.submit] create_sub_thread 成功，thread_id = ${childId}`,
                    timestamp: Date.now(),
                  });
                  tree.writeThreadData(threadId, td);
                }

                // 通知 Scheduler 启动新线程
                scheduler.onThreadCreated(child, objectName);
              }
              consola.info(`[Engine] create_sub_thread: ${subThreadName}`);
            }

            /* continue_sub_thread */
            else if (command === "continue_sub_thread") {
              tree.writeInbox(args.thread_id as string, { from: objectName, content: args.message as string, source: "continue" });
              await tree.setNodeStatus(threadId, "waiting");
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "message_out", content: `[continue_sub_thread] → ${args.thread_id}: ${args.message}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
            }

            /* call_function */
            else if (command === "call_function" && form.trait && form.functionName) {
              const method = methodRegistry.all().find(m => m.name === form.functionName && m.traitName === form.trait);
              let resultText: string;
              if (!method) {
                resultText = `[错误] 方法 ${form.trait}.${form.functionName} 不存在`;
              } else {
                try {
                  const { context: execCtx } = buildExecContext(threadId);
                  const argsObj = (args.args && typeof args.args === "object" ? args.args : {}) as Record<string, unknown>;
                  const argValues = method.params.map(p => argsObj[p.name]);
                  const result = method.needsCtx !== false
                    ? await method.fn(execCtx, ...argValues) : await method.fn(...argValues);
                  resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
                } catch (e) {
                  resultText = `[错误] ${form.trait}.${form.functionName} 执行失败: ${(e as Error).message}`;
                }
              }
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "inject", content: `>>> ${form.trait}.${form.functionName} 结果:\n${resultText}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] call_function: ${form.trait}.${form.functionName}`);
            }

            /* set_plan */
            else if (command === "set_plan") {
              const td = tree.readThreadData(threadId);
              if (td) {
                td.plan = args.text as string;
                td.actions.push({ type: "set_plan", content: args.text as string, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
            }

            /* await / await_all */
            else if (command === "await" || command === "await_all") {
              const threadIds = command === "await" ? [args.thread_id as string] : (args.thread_ids as string[]) ?? [];
              await tree.awaitThreads(threadId, threadIds);
              const ids = threadIds.join(", ");
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "inject", content: `[${command}] ${ids}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
            }

            /* trait 卸载 */
            if (command !== "_trait" && command !== "_skill" && command !== "defer") {
              if (!formManager.activeCommands().has(form.command)) {
                const traitsToUnload = collectCommandTraits(config.traits, new Set([form.command]));
                for (const traitName of traitsToUnload) await tree.deactivateTrait(threadId, traitName);
              }

              /* defer hook 注入：command 被 submit 时，收集匹配的 on:{command} hooks */
              const tdForHook = tree.readThreadData(threadId);
              if (tdForHook?.hooks) {
                const hookText = collectCommandHooks(command, tdForHook.hooks);
                if (hookText) {
                  tdForHook.actions.push({ type: "inject", content: hookText, timestamp: Date.now() });
                  tree.writeThreadData(threadId, tdForHook);
                }
              }
            }

            /* defer command：注册 on:{command} hook */
            if (command === "defer") {
              const onCommand = args.on_command as string;
              const content = args.content as string;
              if (onCommand && content) {
                const td = tree.readThreadData(threadId);
                if (td) {
                  if (!td.hooks) td.hooks = [];
                  td.hooks.push({
                    event: `on:${onCommand}`,
                    traitName: "",
                    content,
                    once: (args.once as boolean) ?? true,
                  });
                  td.actions.push({ type: "inject", content: `[defer] 已注册 on:${onCommand} 提醒`, timestamp: Date.now() });
                  tree.writeThreadData(threadId, td);
                }
                consola.info(`[Engine] defer: on:${onCommand}`);
              } else {
                const td = tree.readThreadData(threadId);
                if (td) {
                  td.actions.push({ type: "inject", content: `[错误] defer 需要 on_command 和 content 参数`, timestamp: Date.now() });
                  tree.writeThreadData(threadId, td);
                }
              }
            }

            const tdAfter = tree.readThreadData(threadId);
            if (tdAfter) { tdAfter.activeForms = formManager.toData(); tree.writeThreadData(threadId, tdAfter); }
            consola.info(`[Engine] form.submit: ${command} (${form.formId})`);
          }
        }

        /* --- Close --- */
        else if (toolName === "close") {
          const form = formManager.cancel(args.form_id as string ?? "");
          if (form) {
            if (form.command !== "_trait" && form.command !== "_skill" && form.command !== "_file") {
              // command 类型：卸载 command 关联 trait
              if (!formManager.activeCommands().has(form.command)) {
                const traitsToUnload = collectCommandTraits(config.traits, new Set([form.command]));
                for (const traitName of traitsToUnload) await tree.deactivateTrait(threadId, traitName);
              }
            } else if (form.command === "_trait" && form.trait) {
              // trait 类型：卸载 trait
              await tree.deactivateTrait(threadId, form.trait);
            } else if (form.command === "_file" && form.trait) {
              // file 类型：从 windows 中移除（form.trait 存储的是文件路径）
              const td = tree.readThreadData(threadId);
              if (td?.windows?.[form.trait]) {
                delete td.windows[form.trait];
                tree.writeThreadData(threadId, td);
              }
            }
            // skill 类型：无需卸载

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              td.actions.push({ type: "inject", content: `Form ${form.formId} 已关闭。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] close: ${form.command} (${form.formId})`);
          } else {
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({ type: "inject", content: `[提示] Form ${args.form_id} 不存在（可能已被 submit 消费）。请直接执行下一步操作。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.warn(`[Engine] close: form ${args.form_id} not found`);
          }
        }

        /* --- Wait --- */
        else if (toolName === "wait") {
          const reason = args.reason as string ?? "";
          await tree.setNodeStatus(threadId, "waiting");
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({ type: "inject", content: `[wait] 线程进入等待状态: ${reason}`, timestamp: Date.now() });
            tree.writeThreadData(threadId, td);
          }
          consola.info(`[Engine] wait: ${reason}`);
        }

        /* debug 记录 */
        if (config.debugEnabled && context && messages) {
          debugLoopCounter++;
          const debugDir = join(objectFlowDir, "threads", threadId, "debug");
          const ctxStats = computeContextStats(context);
          const totalMessageChars = messages.reduce((sum, m) => sum + m.content.length, 0);
          writeDebugLoop({
            debugDir, loopIndex: debugLoopCounter, messages, llmOutput, thinkingContent, source: "llm",
            llmMeta: { model: llmModel, latencyMs: llmLatencyMs, promptTokens: llmUsage.promptTokens ?? 0, completionTokens: llmUsage.completionTokens ?? 0, totalTokens: llmUsage.totalTokens ?? 0 },
            contextStats: { ...ctxStats, totalMessageChars },
            activeTraits: context.scopeChain, activeSkills: (config.skills ?? []).map(s => s.name),
            parsedDirectives: [toolName], threadId, objectName, toolCalls,
          });
        }

      }

      /* debugMode 检查：单步执行后自动暂停 */
      if (threadData._debugMode) {
        consola.info(`[Engine] debugMode 单步完成, thread=${threadId}, 自动暂停`);
        scheduler.pauseObject(objectName);
      }

      /* 发射进度事件 */
      emitSSE({
        type: "flow:progress",
        objectName,
        sessionId,
        iterations: totalIterations,
        maxIterations: config.schedulerConfig?.maxIterationsPerThread ?? 100,
        totalIterations,
        maxTotalIterations: config.schedulerConfig?.maxTotalIterations ?? 500,
      });
    },

    onThreadFinished: (threadId: string, _objectName: string) => {
      consola.info(`[Engine] 线程结束 ${threadId}`);
    },

    onThreadError: (threadId: string, _objectName: string, error: string) => {
      /* 向目标线程的 inbox 投递错误消息 */
      tree.writeInbox(threadId, {
        from: "system",
        content: `[错误] ${error}`,
        source: "thread_error",
      });
    },
  };

  /* 8. 运行 Scheduler */
  await scheduler.run(objectName, tree, callbacks);

  /* 9. 读取最终状态（continue 模式读目标线程，否则读根线程） */
  const resultNode = tree.getNode(targetThreadId) ?? tree.getNode(tree.rootId);
  const finalStatus = resultNode?.status ?? "failed";

  /* 10. 发射 SSE 结束事件 */
  emitSSE({
    type: "flow:end",
    objectName,
    sessionId,
    status: finalStatus === "done" ? "idle" : "error",
  });

  consola.info(`[Engine] 执行结束 ${objectName}, status=${finalStatus}, iterations=${totalIterations}`);

  return {
    sessionId,
    status: finalStatus,
    summary: resultNode?.summary,
    totalIterations,
    threadId: targetThreadId,
  };
}

/* ========== 内部辅助 ========== */

/**
 * 从 ThreadsTree 实例构建 ThreadsTreeFile 快照
 *
 * buildThreadContext 需要 ThreadsTreeFile（纯数据），
 * 而 ThreadsTree 是带方法的类实例。
 * 此函数遍历所有节点，构建一个只读快照。
 */
function buildTreeFileSnapshot(tree: ThreadsTree): ThreadsTreeFile {
  const nodes: Record<string, import("./types.js").ThreadsTreeNodeMeta> = {};
  for (const nodeId of tree.nodeIds) {
    const node = tree.getNode(nodeId);
    if (node) nodes[nodeId] = node;
  }
  return {
    rootId: tree.rootId,
    nodes,
  };
}

/**
 * 计算 talk 的自动 ack 目标（严格条件：只在明确“单条未读且为该对象最新消息”时生效）
 */
function getAutoAckMessageId(
  td: { inbox?: Array<{ id: string; from: string; timestamp: number; status: string }> } | null,
  talkTarget: string,
): string | null {
  if (!td?.inbox || td.inbox.length === 0) return null;
  const target = (talkTarget ?? "").toLowerCase();
  if (!target) return null;

  const fromTarget = td.inbox.filter(m => (m.from ?? "").toLowerCase() === target);
  if (fromTarget.length === 0) return null;

  const unreadFromTarget = fromTarget.filter(m => m.status === "unread");
  if (unreadFromTarget.length !== 1) return null;

  const latestFromTarget = fromTarget.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
  if (latestFromTarget.id !== unreadFromTarget[0]!.id) return null;

  return unreadFromTarget[0]!.id;
}

/* ========== Resume / StepOnce ========== */

/**
 * 恢复暂停的线程树执行
 *
 * 从 session 目录加载 ThreadsTree，清除暂停状态，重新运行 Scheduler。
 * 线程中缓存的 _pendingOutput 会被 runOneIteration 检测到并跳过 LLM 调用。
 *
 * @param objectName - 对象名称
 * @param sessionId - 要恢复的 session ID
 * @param config - 引擎配置
 * @param modifiedOutput - 可选：替换缓存的 LLM 输出（用于人工干预）
 * @returns 执行结果
 */
export async function resumeWithThreadTree(
  objectName: string,
  sessionId: string,
  config: EngineConfig,
  modifiedOutput?: string,
): Promise<TalkResult> {
  const sessionDir = join(config.flowsDir, sessionId);
  const objectFlowDir = join(sessionDir, "objects", objectName);

  /* 加载 ThreadsTree */
  const tree = ThreadsTree.load(objectFlowDir);
  if (!tree) {
    throw new Error(`无法加载线程树: ${objectFlowDir}`);
  }

  consola.info(`[Engine] 恢复执行 ${objectName}, session=${sessionId}`);

  /* 将所有 paused 状态的线程恢复为 running */
  for (const nodeId of tree.nodeIds) {
    const node = tree.getNode(nodeId);
    if (node && node.status === "paused") {
      await tree.setNodeStatus(nodeId, "running");
      consola.info(`[Engine] 恢复线程 ${nodeId}: paused -> running`);
    }
  }

  /* 如果提供了修改后的输出，替换缓存 */
  if (modifiedOutput !== undefined) {
    /* 找到有 _pendingOutput 的线程 */
    for (const nodeId of tree.nodeIds) {
      const td = tree.readThreadData(nodeId);
      if (td?._pendingOutput) {
        td._pendingOutput = modifiedOutput;
        tree.writeThreadData(nodeId, td);
        consola.info(`[Engine] 替换缓存输出, thread=${nodeId}`);
        break;
      }
    }
  }

  /* 将所有 running 状态的线程恢复（scheduler 需要它们） */
  emitSSE({ type: "flow:start", objectName, sessionId });

  let totalIterations = 0;
  const executor = new CodeExecutor();
  const methodRegistry = new MethodRegistry();
  methodRegistry.registerAll(config.traits);

  /* 复用 buildExecContext（与 runWithThreadTree 相同逻辑） */
  const buildExecContext = (threadId: string): { context: Record<string, unknown>; getOutputs: () => string[] } => {
    const outputs: string[] = [];
    const isThenable = (v: unknown): v is PromiseLike<unknown> =>
      v != null && (typeof v === "object" || typeof v === "function") && "then" in (v as any);
    const printFn = (...args: unknown[]) => {
      const hasPromise = args.some(isThenable);
      const text = args
        .map(a => (isThenable(a) ? "[Promise]" : String(a)))
        .join(" ");
      outputs.push(hasPromise
        ? `${text}\n(提示：检测到 Promise，请使用 \"await\" 获取值后再 print)`
        : text);
    };
    const stoneDir = config.paths?.stoneDir ?? "";
    const rootDir = config.paths?.rootDir ?? config.rootDir;

    const context: Record<string, unknown> = {
      self_dir: stoneDir,
      self_files_dir: join(stoneDir, "files"),
      world_dir: rootDir,
      filesDir: join(objectFlowDir, "files"),

      /* MethodContext 兼容字段 */
      rootDir: rootDir,
      sessionId: sessionId,
      selfDir: stoneDir,
      stoneName: objectName,
      data: config.stone.data,

      print: printFn,
      getData: (key: string) => config.stone.data[key],
      getAllData: () => ({ ...config.stone.data }),
      setData: (key: string, value: unknown) => { config.stone.data[key] = value; },
      readFile: (path: string) => {
        const resolved = resolve(rootDir, path);
        if (!existsSync(resolved)) return null;
        return readFileSync(resolved, "utf-8");
      },
      writeFile: (path: string, content: string) => {
        const resolved = resolve(rootDir, path);
        mkdirSync(resolve(resolved, ".."), { recursive: true });
        writeFileSync(resolved, content, "utf-8");
      },
      listFiles: (path: string) => {
        const resolved = resolve(rootDir, path);
        if (!existsSync(resolved)) return [];
        return readdirSync(resolved);
      },
      fileExists: (path: string) => existsSync(resolve(rootDir, path)),
      local: tree.readThreadData(threadId)?.locals ?? {},
    };

    const normalizeTraitId = (input: string): string | null => {
      const trimmed = input.trim();
      if (!trimmed) return null;
      const all = new Set(config.traits.map(t => traitId(t)));
      /* 完整 traitId 直接命中 */
      if (all.has(trimmed)) return trimmed;
      /* 省略 namespace：按 self → kernel → library 顺序查找 */
      if (!trimmed.includes(":")) {
        for (const ns of ["self", "kernel", "library"] as const) {
          const candidate = `${ns}:${trimmed}`;
          if (all.has(candidate)) return candidate;
        }
      }
      return null;
    };

    const readTraitFile = (id: string): { path: string; content: string } | null => {
      let base: string | null = null;
      if (id.startsWith("library:")) {
        base = join(rootDir, "library", "traits", id.slice("library:".length));
      } else if (id.startsWith("kernel:")) {
        base = join(rootDir, "kernel", "traits", id.slice("kernel:".length));
      } else if (id.startsWith("self:")) {
        base = join(rootDir, "stones", objectName, "traits", id.slice("self:".length));
      }
      if (!base) return null;
      const p = join(base, "TRAIT.md");
      if (!existsSync(p)) return null;
      return { path: p, content: readFileSync(p, "utf-8") };
    };

    const computeActiveTraitIds = (): string[] => {
      const scopeChain = tree.computeScopeChain(threadId);
      return getActiveTraits(config.traits, scopeChain).map(t => traitId(t));
    };

    let activeTraitNames = computeActiveTraitIds();
    const methodCtx: MethodContext = {
      setData: (key: string, value: unknown) => { config.stone.data[key] = value; },
      getData: (key: string) => config.stone.data[key],
      print: printFn,
      sessionId,
      filesDir: join(objectFlowDir, "files"),
      rootDir,
      selfDir: stoneDir,
      stoneName: objectName,
      data: { ...config.stone.data },
    };
    /* 沙箱只暴露 { callMethod } 单函数（Phase 2 协议） */
    const sandboxApi = methodRegistry.buildSandboxMethods(methodCtx, objectName);
    Object.assign(context, sandboxApi);
    const injectTraitMethods = (_traitIds: string[]) => {
      /* no-op：callMethod 实时查 registry，无需每次切换时重新注入 */
    };

    injectTraitMethods(activeTraitNames);

    Object.assign(context, {
      listLibraryTraits: () => config.traits.map(t => traitId(t)).sort(),
      listTraits: () => config.traits.map(t => traitId(t)).sort(),
      listActiveTraits: () => computeActiveTraitIds().sort(),
      readTrait: (name: string) => {
        const id = normalizeTraitId(name) ?? name;
        return readTraitFile(id);
      },
      activateTrait: async (name: string) => {
        const id = normalizeTraitId(name);
        if (!id) return { ok: false, error: `未知 trait: ${name}` };
        const changed = await tree.activateTrait(threadId, id);
        activeTraitNames = computeActiveTraitIds();
        injectTraitMethods(activeTraitNames);
        return { ok: true, changed, traitId: id, activeTraits: activeTraitNames.sort() };
      },
      deactivateTrait: async (name: string) => {
        const id = normalizeTraitId(name) ?? name;
        const changed = await tree.deactivateTrait(threadId, id);
        activeTraitNames = computeActiveTraitIds();
        injectTraitMethods(activeTraitNames);
        return { ok: true, changed, traitId: id, activeTraits: activeTraitNames.sort() };
      },
      methods: (trait?: string) => {
        const act = new Set(computeActiveTraitIds());
        const all = methodRegistry.all().filter(m => act.has(m.traitName));
        const filtered = trait
          ? all.filter(m => m.traitName === (normalizeTraitId(trait) ?? trait))
          : all;
        return filtered
          .map(m => ({ name: m.name, trait: m.traitName, description: m.description, params: m.params }))
          .sort((a, b) => (a.trait + a.name).localeCompare(b.trait + b.name));
      },
      help: () => [
        "可用沙箱自省/管理 API：",
        "- listTraits() / listLibraryTraits()",
        "- listActiveTraits()",
        "- readTrait(name) -> { path, content }",
        "- activateTrait(name) / deactivateTrait(name)",
        "- methods(trait?) -> [{name, trait, description, params}]",
        "提示：如 print 出现 [Promise]，请用 await 获取结果",
      ].join("\n"),
    });
    return { context, getOutputs: () => outputs };
  };

  const scheduler = new ThreadScheduler({
    maxIterationsPerThread: config.schedulerConfig?.maxIterationsPerThread ?? 100,
    maxTotalIterations: config.schedulerConfig?.maxTotalIterations ?? 500,
    deadlockGracePeriodMs: config.schedulerConfig?.deadlockGracePeriodMs ?? 30_000,
  });

  /* 注入线程复活回调（done 线程收到 inbox 消息时自动唤醒） */
  tree.setRevivalCallback((nodeId) => {
    scheduler.onThreadCreated(nodeId, objectName);
  });

  /* debug 计数器（resume 场景需要从已有文件数初始化） */
  let debugLoopCounter = 0;
  let debugLoopCounterInitialized = false;

  /* FormManager（resume 时从 threadData 恢复） */
  let formManager: FormManager | null = null;

  const callbacks: SchedulerCallbacks = {
    runOneIteration: async (threadId: string, _objectName: string) => {
      totalIterations++;
      const threadData = tree.readThreadData(threadId);
      if (!threadData) throw new Error(`线程数据不存在: ${threadId}`);

      /* 初始化 FormManager（resume 时从 threadData 恢复） */
      if (!formManager) {
        formManager = FormManager.fromData(threadData.activeForms ?? []);
      }

      /* 初始化 debug 计数器（仅首次） */
      if (config.debugEnabled && !debugLoopCounterInitialized) {
        const debugDir = join(objectFlowDir, "threads", threadId, "debug");
        debugLoopCounter = getExistingLoopCount(debugDir);
        debugLoopCounterInitialized = true;
      }

      const treeFile = buildTreeFileSnapshot(tree);
      let llmOutput: string;
      let thinkingContent: string | undefined;
      let toolCalls: ToolCall[] | undefined;
      let llmLatencyMs = 0;
      let llmModel = "unknown";
      let llmUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
      let context: ReturnType<typeof buildThreadContext> | undefined;
      let messages: Message[] | undefined;

      if (threadData._pendingOutput) {
        /* 优先从文件读取（用户可能已修改） */
        const debugDir = join(objectFlowDir, "threads", threadId);
        const outputFile = join(debugDir, "llm.output.txt");
        if (existsSync(outputFile)) {
          llmOutput = readFileSync(outputFile, "utf-8");
          unlinkSync(outputFile);
          const thinkingFile = join(debugDir, "llm.thinking.txt");
          if (existsSync(thinkingFile)) {
            thinkingContent = readFileSync(thinkingFile, "utf-8");
            unlinkSync(thinkingFile);
          }
          const inputFile = join(debugDir, "llm.input.txt");
          if (existsSync(inputFile)) unlinkSync(inputFile);
        } else {
          llmOutput = threadData._pendingOutput;
          thinkingContent = threadData._pendingThinkingOutput;
        }
        delete threadData._pendingOutput;
        delete threadData._pendingThinkingOutput;
        tree.writeThreadData(threadId, threadData);
        consola.info(`[Engine] 使用缓存输出 (resume), thread=${threadId}`);
      } else {
        context = buildThreadContext({
          tree: treeFile, threadId, threadData,
          stone: config.stone, directory: config.directory,
          traits: config.traits, extraWindows: config.extraWindows, paths: config.paths,
          skills: config.skills,
        });
        messages = contextToMessages(context, threadData.hooks);
        /* 追加活跃 form 信息（resume 路径） */
        const activeForms = formManager.activeForms();
        if (activeForms.length > 0) {
          const formXml = activeForms.map(f =>
            `<form id="${f.formId}" command="${f.command}"${f.trait ? ` trait="${f.trait}"` : ""}>${f.description}</form>`,
          );
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === "user") {
            lastMsg.content += `\n<!-- 活跃 Form：已 open 等待 submit 或 close -->\n<active-forms>\n${formXml.join("\n")}\n</active-forms>`;
          }
        }

        /* 构建动态 tools 列表 */
        const availableTools = buildAvailableTools(formManager.activeCommands());

        const llmStartTime = Date.now();
        const llmResult = await config.llm.chat(messages, { tools: availableTools });
        llmLatencyMs = Date.now() - llmStartTime;
        llmOutput = llmResult.content;
        thinkingContent = llmResult.thinkingContent;
        llmModel = (llmResult as any).model || "unknown";
        llmUsage = (llmResult as any).usage ?? {};
        toolCalls = llmResult.toolCalls;

        if (config.isPaused?.(objectName)) {
          threadData._pendingOutput = llmOutput;
          if (thinkingContent) threadData._pendingThinkingOutput = thinkingContent;
          tree.writeThreadData(threadId, threadData);

          /* 写入调试文件供人工查看/修改 */
          const debugDir = join(objectFlowDir, "threads", threadId);
          mkdirSync(debugDir, { recursive: true });
          writeFileSync(join(debugDir, "llm.output.txt"), llmOutput, "utf-8");
          if (thinkingContent) {
            writeFileSync(join(debugDir, "llm.thinking.txt"), thinkingContent, "utf-8");
          }
          const inputContent = messages.map(m => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n");
          writeFileSync(join(debugDir, "llm.input.txt"), inputContent, "utf-8");

          /* 将线程状态改为 paused */
          await tree.setNodeStatus(threadId, "paused");

          consola.info(`[Engine] 暂停 thread=${threadId}, 输出已缓存, 状态改为 paused`);
          scheduler.pauseObject(objectName);
          return;
        }
      }

      if (thinkingContent) {
        emitSSE({ type: "stream:thought", objectName, sessionId, chunk: thinkingContent });

        /* 将 thinking 输出记录为 thinking action */
        const td = tree.readThreadData(threadId);
        if (td) {
          td.actions.push({
            type: "thinking",
            content: thinkingContent,
            timestamp: Date.now(),
          });
          tree.writeThreadData(threadId, td);
        }
      }

      /* ========== Tool Calling 路径（resume） ========== */
      if (toolCalls && toolCalls.length > 0) {
        if (llmOutput?.trim() && llmOutput !== thinkingContent) {
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({ type: "text", content: llmOutput, timestamp: Date.now() });
            tree.writeThreadData(threadId, td);
          }
        }

        const tc = toolCalls[0]!;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}
        const toolName = tc.function.name;

        /* 剥离顶层 title（参见 runWithThreadTree 同段落的说明）
         * submit 场景下 args.title 保留（create_sub_thread 的子线程名兼容 fallback） */
        const rawTitle = typeof args.title === "string" ? args.title : undefined;
        const actionTitle = rawTitle;

        consola.info(`[Engine] tool_call: ${toolName}${actionTitle ? ` "${actionTitle}"` : ""}(${JSON.stringify(args).slice(0, 200)})`);

        /* 记录 tool_use action（含 title） */
        {
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({
              type: "tool_use",
              content: `${toolName}(${JSON.stringify(args).slice(0, 200)})`,
              name: toolName,
              args,
              title: actionTitle,
              timestamp: Date.now(),
            });
            tree.writeThreadData(threadId, td);
          }
        }

        /* SSE 事件：广播 title */
        if (actionTitle) {
          emitSSE({
            type: "flow:action",
            objectName,
            sessionId,
            action: {
              type: "tool_use",
              name: toolName,
              title: actionTitle,
              content: `${toolName}`,
              timestamp: Date.now(),
            },
          });
        }

        /* 处理 mark 参数（resume 路径） */
        if (Array.isArray(args.mark)) {
          for (const m of args.mark as { messageId: string; type: "ack" | "ignore" | "todo"; tip: string }[]) {
            tree.markInbox(threadId, m.messageId, m.type, m.tip);
            /* 记录 mark_inbox action */
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({ type: "mark_inbox", content: `标记消息 #${m.messageId}: ${m.type} — ${m.tip}`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
          }
        }

        /* --- Open (resume) --- */
        if (toolName === "open") {
          const openType = args.type as string;
          const command = args.command as string;
          const description = args.description as string ?? "";

          if (openType === "command" && command) {
            const formId = formManager.begin(command, description, {
              trait: args.trait as string, functionName: args.function_name as string,
            });
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommands());
            for (const traitName of traitsToLoad) await tree.activateTrait(threadId, traitName);
            if (command === "call_function" && args.trait) await tree.activateTrait(threadId, args.trait as string);

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              td.actions.push({ type: "inject", content: `Form ${formId} 已创建（${command}）。相关知识已加载。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] open command: ${command} → ${formId}`);

          } else if (openType === "trait" && args.name) {
            const traitInput = args.name as string;
            const allTraitIds = config.traits.map(t => traitId(t));
            let resolvedTraitName = allTraitIds.find(id => id === traitInput) ?? null;
            if (!resolvedTraitName && !traitInput.includes("/")) {
              resolvedTraitName = allTraitIds.find(id => id === `library/${traitInput}` || id === `kernel/${traitInput}`) ?? null;
              if (!resolvedTraitName) {
                resolvedTraitName = allTraitIds.find(id => id.endsWith(`/${traitInput}`)) ?? null;
              }
            }

            if (resolvedTraitName) {
              await tree.activateTrait(threadId, resolvedTraitName);
              const formId = formManager.begin("_trait", description, { trait: resolvedTraitName });
              const td = tree.readThreadData(threadId);
              if (td) {
                td.activeForms = formManager.toData();
                td.actions.push({ type: "inject", content: `Trait ${resolvedTraitName} 已加载。`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open trait: ${traitInput} → ${resolvedTraitName} → ${formId}`);
            } else {
              const available = allTraitIds.filter(id => !id.startsWith("kernel:") || id.includes("kernel:plannable/") || id.includes("kernel:computable/")).slice(0, 30).join(", ");
              const td = tree.readThreadData(threadId);
              if (td) { td.actions.push({ type: "inject", content: `[错误] Trait "${traitInput}" 不存在。可用 trait: ${available || "(无)"}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              consola.warn(`[Engine] open trait: ${traitInput} not found`);
            }

          } else if (openType === "skill" && args.name) {
            const skillName = args.name as string;
            const skillDef = config.skills?.find(s => s.name === skillName);
            let injectContent: string;
            if (skillDef) {
              const body = loadSkillBody(skillDef.dir);
              injectContent = body ?? `[错误] Skill "${skillName}" 内容为空`;
            } else {
              injectContent = `[错误] 未找到 Skill "${skillName}"`;
            }
            const formId = formManager.begin("_skill", description, { trait: skillName });
            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              td.actions.push({ type: "inject", content: injectContent, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] open skill: ${skillName} → ${formId}`);

          } else if (openType === "file" && args.path) {
            const filePath = args.path as string;
            const linesLimit = args.lines as number | undefined;
            const rootDir = config.paths?.rootDir ?? config.rootDir;
            const resolved = resolve(rootDir, filePath);

            if (!existsSync(resolved)) {
              const td = tree.readThreadData(threadId);
              if (td) { td.actions.push({ type: "inject", content: `[错误] 文件 "${filePath}" 不存在`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              consola.warn(`[Engine] open file: ${filePath} not found`);
            } else {
              let content = readFileSync(resolved, "utf-8");
              if (linesLimit && linesLimit > 0) {
                const lines = content.split("\n");
                content = lines.slice(0, linesLimit).join("\n");
                if (lines.length > linesLimit) content += `\n... (共 ${lines.length} 行，已截取前 ${linesLimit} 行)`;
              }
              const formId = formManager.begin("_file", description, { trait: filePath });
              const td = tree.readThreadData(threadId);
              if (td) {
                if (!td.windows) td.windows = {};
                td.windows[filePath] = { name: filePath, content, formId, updatedAt: Date.now() };
                td.activeForms = formManager.toData();
                td.actions.push({ type: "inject", content: `文件 "${filePath}" 已加载到上下文窗口。${linesLimit ? `（前 ${linesLimit} 行）` : ""}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open file: ${filePath}${linesLimit ? ` (${linesLimit} lines)` : ""} → ${formId}`);
            }
          }

        /* --- Submit (resume) --- */
        } else if (toolName === "submit") {
          const form = formManager.submit(args.form_id as string ?? "");
          if (!form) {
            const td = tree.readThreadData(threadId);
            if (td) { td.actions.push({ type: "inject", content: `[错误] Form ${args.form_id} 不存在。`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
          } else {
            const command = form.command;
            if (command === "program" && args.code) {
              const { context: execCtx, getOutputs } = buildExecContext(threadId);
              const lang = (args.lang as string) ?? "javascript";
              const execResult = lang === "shell" ? await executeShell(args.code as string, config.rootDir) : await executor.execute(args.code as string, execCtx);
              const allOutputs = [...getOutputs()]; if (execResult.stdout) allOutputs.push(execResult.stdout);
              if (execResult.returnValue != null) allOutputs.push(typeof execResult.returnValue === "string" ? execResult.returnValue : JSON.stringify(execResult.returnValue, null, 2));
              const outputText = allOutputs.join("\n").trim();
              const td = tree.readThreadData(threadId);
              if (td) { td.actions.push({ type: "program", content: args.code as string, success: execResult.success, result: execResult.success ? (outputText ? `>>> output:\n${outputText}` : ">>> output: (无输出)") : `>>> error: ${execResult.error}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            } else if ((command === "talk" || command === "talk_sync") && config.onTalk) {
              const target = (args.target as string)?.toLowerCase();
              if (target && target !== objectName.toLowerCase()) {
                const continueThreadId = args.continue_thread as string | undefined;
                /* 先生成 messageId（供 action.id 和 onTalk 参数共用，前端凭此反查正文） */
                const messageId = genMessageOutId();
                /* 解析可选的结构化表单（talk form）——供前端渲染 option picker */
                const formPayload = extractTalkForm(args.form);
                const td = tree.readThreadData(threadId);
                if (td) {
                  const continueLabel = continueThreadId ? ` (continue: ${continueThreadId})` : "";
                  const formLabel = formPayload ? ` [form: ${formPayload.formId}]` : "";
                  td.actions.push({
                    id: messageId,
                    type: "message_out",
                    content: `[talk] → ${args.target}: ${args.message}${continueLabel}${formLabel}`,
                    timestamp: Date.now(),
                    ...(formPayload ? { form: formPayload } : {}),
                  });
                  tree.writeThreadData(threadId, td);
                }
                /* talk_sync 到 user 是死锁：user 永远不会唤醒。记日志、不 setNodeStatus("waiting")、直接继续。 */
                const isTalkSyncToUser = command === "talk_sync" && target === "user";
                if (isTalkSyncToUser) {
                  consola.warn(`[Engine] ${objectName} 尝试 talk_sync(target="user")——user 不参与 ThinkLoop，不会回复。已降级为 talk（不阻塞）。`);
                }
                const explicitlyMarked = Array.isArray(args.mark) && args.mark.length > 0;
                try {
                  const { reply, remoteThreadId } = await config.onTalk(args.target as string, args.message as string, objectName, threadId, sessionId, continueThreadId, messageId);
                  if (!explicitlyMarked) {
                    const tdAck = tree.readThreadData(threadId);
                    const autoAckId = getAutoAckMessageId(tdAck, args.target as string);
                    if (autoAckId) tree.markInbox(threadId, autoAckId, "ack", "已回复");
                  }
                  if (reply) {
                    tree.writeInbox(threadId, { from: args.target as string, content: `${reply}\n[remote_thread_id: ${remoteThreadId}]`, source: "talk" });
                  }
                  /* 将 remote_thread_id 记录到 actions（无论是否有 reply，LLM 都能看到） */
                  const td2 = tree.readThreadData(threadId);
                  if (td2) {
                    td2.actions.push({ type: "inject", content: `[talk → ${args.target}] remote_thread_id = ${remoteThreadId}`, timestamp: Date.now() });
                    tree.writeThreadData(threadId, td2);
                  }
                } catch (e) { tree.writeInbox(threadId, { from: "system", content: `[talk 失败] ${(e as Error).message}`, source: "system" }); }
                /* target=user 时不 setNodeStatus("waiting")，避免死锁 */
                if (command === "talk_sync" && !isTalkSyncToUser) tree.setNodeStatus(threadId, "waiting");
              }
            } else if (command === "return") {
              await tree.setNodeStatus(threadId, "done");
              await tree.updateNodeMeta(threadId, { summary: args.summary as string ?? "" });
              const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "thread_return", content: args.summary as string ?? "", timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              scheduler.markDone(threadId);
            } else if (command === "create_sub_thread") {
              /* 子线程标题 = tool call 的 title（天然同一语义） */
              const subThreadName = (args.title as string | undefined) ?? "";
              const child = await tree.createSubThread(threadId, subThreadName, {
                description: args.description as string,
                traits: args.traits as string[],
              });
              if (child) {
                // 设置子线程为 running
                await tree.setNodeStatus(child, "running");

                const td = tree.readThreadData(threadId);
                if (td) {
                  td.actions.push({ type: "create_thread", content: `[create_sub_thread] ${subThreadName} → ${child}`, timestamp: Date.now() });
                  // 立即注入 thread_id
                  td.actions.push({ type: "inject", content: `[form.submit] create_sub_thread 成功，thread_id = ${child}`, timestamp: Date.now() });
                  tree.writeThreadData(threadId, td);
                }

                // 通知 Scheduler 启动新线程
                scheduler.onThreadCreated(child, objectName);
              }
            } else if (command === "continue_sub_thread") {
              tree.writeInbox(args.thread_id as string, { from: objectName, content: args.message as string, source: "continue" }); tree.setNodeStatus(threadId, "waiting");
              const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "message_out", content: `[continue_sub_thread] → ${args.thread_id}: ${args.message}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            } else if (command === "call_function" && form.trait && form.functionName) {
              const method = methodRegistry.all().find(m => m.name === form.functionName && m.traitName === form.trait);
              let resultText: string;
              if (!method) { resultText = `[错误] 方法 ${form.trait}.${form.functionName} 不存在`; }
              else { try { const { context: execCtx } = buildExecContext(threadId); const argsObj = (args.args && typeof args.args === "object" ? args.args : {}) as Record<string, unknown>; const argValues = method.params.map(p => argsObj[p.name]); const result = method.needsCtx !== false ? await method.fn(execCtx, ...argValues) : await method.fn(...argValues); resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2); } catch (e) { resultText = `[错误] ${(e as Error).message}`; } }
              const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `>>> ${form.trait}.${form.functionName} 结果:\n${resultText}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            } else if (command === "set_plan") {
              const td = tree.readThreadData(threadId); if (td) { td.plan = args.text as string; td.actions.push({ type: "set_plan", content: args.text as string, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            } else if (command === "await" || command === "await_all") {
              const threadIds = command === "await" ? [args.thread_id as string] : (args.thread_ids as string[]) ?? [];
              await tree.awaitThreads(threadId, threadIds);
              const ids = threadIds.join(", ");
              const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `[${command}] ${ids}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            }
            if (command !== "_trait" && command !== "_skill") {
              if (!formManager.activeCommands().has(form.command)) { const traitsToUnload = collectCommandTraits(config.traits, new Set([form.command])); for (const traitName of traitsToUnload) await tree.deactivateTrait(threadId, traitName); }
            }
            const tdAfter = tree.readThreadData(threadId); if (tdAfter) { tdAfter.activeForms = formManager.toData(); tree.writeThreadData(threadId, tdAfter); }
            consola.info(`[Engine] form.submit: ${command} (${form.formId})`);
          }

        /* --- Close (resume) --- */
        } else if (toolName === "close") {
          const form = formManager.cancel(args.form_id as string ?? "");
          if (form) {
            if (form.command !== "_trait" && form.command !== "_skill" && form.command !== "_file") {
              if (!formManager.activeCommands().has(form.command)) { const traitsToUnload = collectCommandTraits(config.traits, new Set([form.command])); for (const traitName of traitsToUnload) await tree.deactivateTrait(threadId, traitName); }
            } else if (form.command === "_trait" && form.trait) {
              await tree.deactivateTrait(threadId, form.trait);
            } else if (form.command === "_file" && form.trait) {
              const td = tree.readThreadData(threadId);
              if (td?.windows?.[form.trait]) { delete td.windows[form.trait]; tree.writeThreadData(threadId, td); }
            }
            const td = tree.readThreadData(threadId); if (td) { td.activeForms = formManager.toData(); td.actions.push({ type: "inject", content: `Form ${form.formId} 已关闭。`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            consola.info(`[Engine] close: ${form.command} (${form.formId})`);
          } else {
            const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `[提示] Form ${args.form_id} 不存在（可能已被 submit 消费）。请直接执行下一步操作。`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            consola.warn(`[Engine] close: form ${args.form_id} not found`);
          }

        /* --- Wait (resume) --- */
        } else if (toolName === "wait") {
          const reason = args.reason as string ?? "";
          await tree.setNodeStatus(threadId, "waiting");
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({ type: "inject", content: `[wait] 线程进入等待状态: ${reason}`, timestamp: Date.now() });
            tree.writeThreadData(threadId, td);
          }
          consola.info(`[Engine] wait: ${reason}`);
        }

        if (config.debugEnabled && context && messages) {
          debugLoopCounter++;
          const debugDir = join(objectFlowDir, "threads", threadId, "debug");
          const ctxStats = computeContextStats(context);
          const totalMessageChars = messages.reduce((sum, m) => sum + m.content.length, 0);
          writeDebugLoop({ debugDir, loopIndex: debugLoopCounter, messages, llmOutput, thinkingContent, source: "llm", llmMeta: { model: llmModel, latencyMs: llmLatencyMs, promptTokens: llmUsage.promptTokens ?? 0, completionTokens: llmUsage.completionTokens ?? 0, totalTokens: llmUsage.totalTokens ?? 0 }, contextStats: { ...ctxStats, totalMessageChars }, activeTraits: context.scopeChain, activeSkills: (config.skills ?? []).map(s => s.name), parsedDirectives: [toolName], threadId, objectName, toolCalls });
        }

      }

      if (threadData._debugMode) {
        consola.info(`[Engine] debugMode 单步完成, thread=${threadId}`);
        scheduler.pauseObject(objectName);
      }
    },
    onThreadFinished: (threadId) => consola.info(`[Engine] 线程结束 ${threadId}`),
    onThreadError: (threadId, _objectName, error) => {
      tree.writeInbox(threadId, { from: "system", content: `[错误] ${error}`, source: "thread_error" });
    },
  };

  await scheduler.run(objectName, tree, callbacks);

  const rootNode = tree.getNode(tree.rootId);
  const finalStatus = rootNode?.status ?? "failed";

  emitSSE({
    type: "flow:end", objectName, sessionId,
    status: finalStatus === "done" ? "idle" : "error",
  });

  consola.info(`[Engine] 恢复执行结束 ${objectName}, status=${finalStatus}, iterations=${totalIterations}`);
  return { sessionId, status: finalStatus, summary: rootNode?.summary, totalIterations, threadId: tree.rootId };
}

/**
 * 单步执行线程树
 *
 * 设置 debugMode，执行一轮后自动暂停。
 * 可选替换缓存的 LLM 输出（人工干预）。
 */
export async function stepOnceWithThreadTree(
  objectName: string,
  sessionId: string,
  config: EngineConfig,
  modifiedOutput?: string,
): Promise<TalkResult> {
  const sessionDir = join(config.flowsDir, sessionId);
  const objectFlowDir = join(sessionDir, "objects", objectName);

  const tree = ThreadsTree.load(objectFlowDir);
  if (!tree) throw new Error(`无法加载线程树: ${objectFlowDir}`);

  /* 为所有 running 线程设置 debugMode */
  for (const nodeId of tree.nodeIds) {
    const node = tree.getNode(nodeId);
    if (node?.status === "running") {
      const td = tree.readThreadData(nodeId);
      if (td) {
        td._debugMode = true;
        tree.writeThreadData(nodeId, td);
      }
    }
  }

  return resumeWithThreadTree(objectName, sessionId, config, modifiedOutput);
}
