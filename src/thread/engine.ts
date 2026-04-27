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
import { getOpenFiles } from "./open-files.js";
import { emitSSE } from "../server/events.js";
import { CodeExecutor } from "../executable/executor.js";
import { MethodRegistry, type MethodContext } from "../trait/registry.js";
import { traitId } from "../knowledge/activator.js";
import { FormManager } from "./form.js";
import { collectCommandTraits, collectCommandHooks } from "./hooks.js";
import { executeCommand } from "./commands/index.js";
import { buildAvailableTools } from "./tools/index.js";
import { resolveVirtualPath, isVirtualPath } from "./virtual-path.js";
import { detectSelfKind } from "./self-kind.js";
import { runBuildHooks } from "../world/hooks.js";
import { contextToMessages, type ActiveFormView } from "./context-messages.js";
import { threadStatusToFlowStatus, type TalkResult } from "./engine-types.js";

import type { LLMClient, Message, ToolCall } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, ContextWindow } from "../types/index.js";
import type { SkillDefinition } from "../skill/types.js";
import { writeDebugLoop, computeContextStats, getExistingLoopCount } from "./debug.js";
import { loadSkillBody } from "../skill/loader.js";
import {
  estimateActionsTokens,
  buildCompactHint,
  COMPACT_THRESHOLD_TOKENS,
} from "./compact.js";
import type {
  ThreadsTreeFile,
  ThreadAction,
  ThreadStatus,
} from "./types.js";

/* ========== 类型定义 ========== */

const PROGRAM_COMMAND = "program";

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
   * 2026-04-22 新增 `forkUnderThreadId`（对应 think/talk 的 `context="fork"` + 指定 threadId 模式）——
   * 在对方的 threadId 下 fork 新子线程，而非新建根线程。
   * 同时 `continueThreadId` 对应 `context="continue"` 的模式——向对方已有线程投递消息。
   * 两者互斥：同时传入时以 forkUnderThreadId 优先，world 端会校验。
   *
   * @param targetObject - 目标对象名
   * @param message - 消息内容
   * @param fromObject - 发起方对象名
   * @param fromThreadId - 发起方线程 ID
   * @param sessionId - 当前 session ID
   * @param continueThreadId - 可选，继续对方已有线程（对应 context="continue"）
   * @param messageId - 可选，本次 message_out action 的 id（用于 target="user" 时写入 user inbox 索引）
   * @param forkUnderThreadId - 可选，在对方此线程下 fork 新子线程（对应 context="fork" + 指定 threadId）
   * @param messageKind - 可选，消息类型标签（Phase 6，如 "relation_update_request"），
   *   传递给接收侧写 inbox 时一并保留，让接收方 context 能渲染特殊徽章
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
    forkUnderThreadId?: string,
    messageKind?: string,
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

/** 基座 trait 判定：kernel:base 是协议基座，不随 command form 生命周期自动回收。 */
function isAlwaysTrait(traits: TraitDefinition[], fullId: string): boolean {
  void traits;
  return fullId === "kernel:base";
}

export type { TalkResult, TalkReturn } from "./engine-types.js";
/* ========== 辅助函数 ========== */

/** 生成 session ID */
function generateSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 提取一次 program trait/method 参数中涉及的"被写入文件路径"（用于触发 build hooks）
 *
 * 识别的方法：
 * - writeFile / editFile / deleteFile → args.path
 * - apply_edits → 读 plan 后对每个 change 的 path 触发（此处只能返回空，由 apply_edits 内部自己触发更合适——
 *   MVP 先不深入，仅接 writeFile/editFile）
 *
 * 防递归：返回的 path 必然是 LLM 主动写的文件；hook 内部如果又调 writeFile 需要自己判断不再回灌。
 */
function extractWrittenPaths(
  trait: string | undefined,
  methodName: string | undefined,
  args: unknown,
): string[] {
  if (!trait || !methodName) return [];
  const isFileOps =
    trait === "computable/file_ops" ||
    trait === "kernel:computable/file_ops" ||
    trait.endsWith(":computable/file_ops");
  if (!isFileOps) return [];
  const targetMethods = new Set(["writeFile", "editFile"]);
  if (!targetMethods.has(methodName)) return [];
  if (!args || typeof args !== "object") return [];
  const path = (args as Record<string, unknown>).path;
  if (typeof path !== "string" || path.length === 0) return [];
  return [path];
}

/**
 * 在 program trait/method 执行成功后触发 build hooks，并把结果写入 thread inject
 *
 * 调用方传入必要上下文；此函数不抛出（hook 内部失败被吞）。
 * 返回 inject 用的文本（可能为空串）。
 */
async function triggerBuildHooksAfterCall(params: {
  trait?: string;
  methodName?: string;
  args: unknown;
  rootDir: string;
  threadId: string;
}): Promise<string> {
  try {
    const paths = extractWrittenPaths(params.trait, params.methodName, params.args);
    if (paths.length === 0) return "";
    consola.info(`[build_hooks] program trait/method 触发 trait=${params.trait} method=${params.methodName} paths=${paths.join(",")}`);
    const feedback = await runBuildHooks(paths, {
      rootDir: params.rootDir,
      threadId: params.threadId,
    });
    const failing = feedback.filter((f) => !f.success);
    if (failing.length === 0) return "";
    const lines = [`[build_hooks] ${failing.length} 个检查未通过（下一轮 Context 的 <knowledge name="build_feedback"> 会展开）:`];
    for (const f of failing) {
      lines.push(`- [${f.hookName}] ${f.path}: ${(f.errors?.[0] ?? f.output).slice(0, 200)}`);
    }
    return lines.join("\n");
  } catch (e) {
    consola.warn(`[build_hooks] triggerBuildHooksAfterCall 异常: ${(e as Error).message}`);
    return "";
  }
}

async function executeProgramTraitMethod(params: {
  methodRegistry: MethodRegistry;
  trait?: string;
  method?: string;
  args: unknown;
  execCtx: MethodContext;
}): Promise<{ success: boolean; resultText: string }> {
  const { methodRegistry, trait, method, args, execCtx } = params;
  if (!trait || !method) {
    return {
      success: false,
      resultText: `[错误] program trait/method 缺少 trait 或 method 参数。\n请在 open 时传：open({ title: "调用方法", type: "command", command: "program", trait: "<完整 traitId 如 kernel:reflective/super>", method: "<方法名>", description: "..." })`,
    };
  }

  const argsObj: Record<string, unknown> =
    args !== null && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  try {
    const { callMethod } = methodRegistry.buildSandboxMethods(execCtx, execCtx.stoneName);
    const result = await callMethod(trait, method, argsObj);
    return {
      success: true,
      resultText: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    };
  } catch (e) {
    return { success: false, resultText: `[错误] ${trait}.${method} 执行失败: ${(e as Error).message}` };
  }
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
 * 解析 open(path=...) 的路径（支持虚拟路径 @trait:... / @relation:...）
 *
 * 在 engine 的 run / resume 两条路径共用。
 *
 * Phase 7：通过 detectSelfKind 自动识别 stone vs flow_obj，flow_obj 场景下
 * @trait:self/X 和 @relation:<peer> 正确落在 flows/<sid>/objects/<name>/ 下。
 *
 * @param rawPath  LLM 传入的原始 path 字符串
 * @param rootDir  项目根目录
 * @param selfName 当前对象名（用于 @trait:self/... 与 @relation:...）
 * @param stoneDir 当前对象的 stone 目录；用于嗅探 selfKind（stone vs flow_obj）
 * @param flowsDir flows/ 根目录（检测 flow_obj 需要）
 * @returns { resolved, isVirtual, kind }：resolved=绝对路径（null=无法解析），
 *          isVirtual=是否虚拟路径，kind="trait"|"relation"|"file"
 */
function resolveOpenFilePath(
  rawPath: string,
  rootDir: string,
  selfName: string,
  stoneDir?: string,
  flowsDir?: string,
): { resolved: string | null; isVirtual: boolean; kind: "trait" | "relation" | "file" } {
  const virtual = isVirtualPath(rawPath);
  const selfInfo = detectSelfKind(stoneDir ?? "", flowsDir ?? "");
  const resolved = resolveVirtualPath(rawPath, {
    rootDir,
    selfName,
    selfKind: selfInfo.selfKind,
    sessionId: selfInfo.sessionId,
  });
  let kind: "trait" | "relation" | "file" = "file";
  if (virtual) {
    if (rawPath.startsWith("@trait:")) kind = "trait";
    else if (rawPath.startsWith("@relation:")) kind = "relation";
  }
  return { resolved, isVirtual: virtual, kind };
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

export { writeThreadTreeFlowData } from "./flow-data.js";

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
 * @param continueThreadId - 可选，继续已有线程（而非新建/重置根线程）。对应 talk(context="continue")。
 * @param forkUnderThreadId - 可选，在已有线程下 fork 新子线程（而非新建/重置根线程）。对应 talk(context="fork", threadId=...)。
 * @returns 执行结果
 */
export async function runWithThreadTree(
  objectName: string,
  message: string,
  from: string,
  config: EngineConfig,
  preSessionId?: string,
  continueThreadId?: string,
  forkUnderThreadId?: string,
  messageKind?: string,
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
  } else if (forkUnderThreadId) {
    /* fork 模式：在指定线程下 fork 新子线程，将消息写入新子线程的 inbox（对应 talk(context="fork", threadId=X)） */
    const parentNode = tree.getNode(forkUnderThreadId);
    if (parentNode) {
      const subId = await tree.createSubThread(forkUnderThreadId, `${from} → ${objectName}`, {
        description: message,
        creatorObjectName: from,
        creationMode: "talk",
      });
      if (subId) {
        await tree.setNodeStatus(subId, "running");
        targetThreadId = subId;
        consola.info(`[Engine] fork under ${forkUnderThreadId} → ${subId}`);
      } else {
        consola.warn(`[Engine] fork under ${forkUnderThreadId} 失败（深度超限或父节点不存在），回退根线程`);
        const rootNode = tree.getNode(tree.rootId);
        if (rootNode && rootNode.status === "done") await tree.setNodeStatus(tree.rootId, "running");
        targetThreadId = tree.rootId;
      }
    } else {
      consola.warn(`[Engine] forkUnderThreadId ${forkUnderThreadId} 不存在，回退到根线程`);
      const rootNode = tree.getNode(tree.rootId);
      if (rootNode && rootNode.status === "done") await tree.setNodeStatus(tree.rootId, "running");
      targetThreadId = tree.rootId;
    }
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
    /* 多轮对话：根线程不在 running 时（done / waiting / failed）一律唤醒处理新消息。
     * waiting 是常见情形——上一轮 LLM 调 wait() 后等待用户下一句；
     * 没有此处的唤醒，writeInbox 之后 scheduler 会"全 waiting → 非死锁"立即退出，
     * 新消息躺在 inbox 里不被消费，表现为"发了消息没反应，必须刷新也无效"。 */
    const rootNode = tree.getNode(tree.rootId);
    if (rootNode && rootNode.status !== "running") {
      const prev = rootNode.status;
      await tree.setNodeStatus(tree.rootId, "running");
      consola.info(`[Engine] 重置根线程状态: ${prev} → running（多轮对话续写）`);
    }
    targetThreadId = tree.rootId;
  }

  /* 2. 将初始消息写入目标线程的 inbox（Phase 6：透传 kind，如 relation_update_request） */
  tree.writeInbox(targetThreadId, {
    from,
    content: message,
    source: "talk",
    kind: messageKind,
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

  /* 4.3 构建执行上下文工厂（每次 program 执行时调用）
   *
   * 返回值新增 getWrittenPaths()：program 执行期间，沙箱内 callMethod(file_ops.writeFile/editFile)
   * 与直接调 context.writeFile 都会累计写入 path 列表，供 program 结束后触发 build_hooks。
   */
  const buildExecContext = (threadId: string): { context: Record<string, unknown>; getOutputs: () => string[]; getWrittenPaths: () => string[] } => {
    const outputs: string[] = [];
    const writtenPaths: string[] = [];
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
        writtenPaths.push(path);
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

      /* compact trait 专用内部字段（下划线前缀表明非公开 API）
       * compact 的 llm_methods 通过这两个字段读取当前线程的 actions 和累积压缩标记。
       * 普通 trait 不应读写这两个字段——它们是 compact 与 engine 的私有契约。 */
      __threadId: threadId,
      __threadsTree: tree,
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

    /* Phase 3：通过 open-files 中枢统一计算当前 open 的 trait 集合
     * （替代旧 getActiveTraits 直接调用，语义等价） */
    const computeActiveTraitIds = (): string[] => {
      const td = tree.readThreadData(threadId);
      if (!td) return [];
      return getOpenFiles({
        tree: tree.toFile(),
        threadId,
        threadData: td,
        stone: config.stone,
        traits: config.traits,
      }).activeTraitIds;
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
      /* 透传 threadId —— apply_edits 等 trait 方法用它把 build_hooks feedback 归档到本线程 */
      threadId,
    };
    /* 沙箱只暴露 { callMethod }，无需动态注入/清理每个方法名 */
    const sandboxApiRaw = methodRegistry.buildSandboxMethods(methodCtx, objectName);
    /* 包装 callMethod：file_ops.writeFile / editFile 成功后记录 path，供 program 结束后触发 build_hooks */
    const sandboxApi = {
      callMethod: async (traitIdRaw: string, methodName: string, args?: object) => {
        const result = await sandboxApiRaw.callMethod(traitIdRaw, methodName, args);
        const paths = extractWrittenPaths(traitIdRaw, methodName, args);
        for (const p of paths) writtenPaths.push(p);
        return result;
      },
    };
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

    return { context, getOutputs: () => outputs, getWrittenPaths: () => [...writtenPaths] };
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
      /* 流式 thinking 是否有 chunk 到达：决定后续 emit stream:thought 的路径。
       * 声明在外层作用域，既供 else 分支 LLM 调用处设值，也供块外 thinkingContent 分支读取。 */
      let sawThinkingChunk = false;

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

        /* 转换为 LLM Messages
         *
         * Phase 3 — llm_input_viewer：活跃 form 作为 <user> 子节点由
         * contextToMessages 内部序列化，不再在外部字符串追加，保证前端 DOMParser
         * 能把它当作 <user> 的子节点。 */
        const activeFormsView: ActiveFormView[] = formManager.activeForms().map(f => ({
          formId: f.formId,
          command: f.command,
          description: f.description,
          trait: f.trait,
        }));
        messages = contextToMessages(context, threadData.hooks, activeFormsView);

        /* Compact 阈值提示：actions token 超 COMPACT_THRESHOLD_TOKENS 时往 last user message 追加引导
         *
         * 只在非 compact 模式下提示——若 LLM 已经 open(compact) 正在压缩，就别再劝它压缩了。
         * 对"已有 compact_summary"幂等：compact_summary 本身会被算入 tokens，若再次超阈值也该提示。 */
        if (!formManager.activeCommands().has("compact")) {
          const currentTokens = estimateActionsTokens(threadData.actions);
          if (currentTokens > COMPACT_THRESHOLD_TOKENS) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "user") {
              lastMsg.content += buildCompactHint(currentTokens);
            }
          }
        }

        /* 构建动态 tools 列表 */
        const availableTools = buildAvailableTools();

        /* 调用 LLM（带 tools + 流式 thinking）。
         * 客户端若实现 chatWithThinkingStream，则 thinking chunk 实时通过 SSE stream:thought 推送给前端；
         * 未实现则回退到 chat()，等 LLM 完整返回后一次性发出（语义不降级）。 */
        const llmStartTime = Date.now();
        const llmResult = typeof config.llm.chatWithThinkingStream === "function"
          ? await config.llm.chatWithThinkingStream(messages, {
              tools: availableTools,
              onThinkingChunk: (chunk) => {
                sawThinkingChunk = true;
                emitSSE({ type: "stream:thought", objectName, sessionId, chunk });
              },
            })
          : await config.llm.chat(messages, { tools: availableTools });
        llmLatencyMs = Date.now() - llmStartTime;
        llmOutput = llmResult.content;
        thinkingContent = llmResult.thinkingContent;
        llmModel = (llmResult as any).model || "unknown";
        llmUsage = (llmResult as any).usage ?? {};
        toolCalls = llmResult.toolCalls;
        /* 流式路径已逐 chunk 发过；非流式路径后面仍会整段发一次（保持前端可观测性） */
        if (sawThinkingChunk) {
          emitSSE({ type: "stream:thought:end", objectName, sessionId });
        }

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
        /* 仅非流式路径需要在此补发整段——流式路径已在 onThinkingChunk 中逐段发过并 end */
        if (!sawThinkingChunk) {
          emitSSE({ type: "stream:thought", objectName, sessionId, chunk: thinkingContent });
          emitSSE({ type: "stream:thought:end", objectName, sessionId });
        }

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
         * submit 场景特殊：think(fork) 把 title 当作子线程标题。
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
              method: args.method as string,
            });
            /* Phase 4：按 commandPaths 集合做精确匹配（match 已显式包含所有父路径） */
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
            /* 累加真正"新加载"的 trait（changed=true 表示此次激活；false 表示本就在作用域内） */
            const newlyLoadedTraits: string[] = [];
            for (const traitName of traitsToLoad) {
              const changed = await tree.activateTrait(threadId, traitName);
              if (changed) newlyLoadedTraits.push(traitName);
            }
            if (command === PROGRAM_COMMAND && args.trait) {
              const changed = await tree.activateTrait(threadId, args.trait as string);
              if (changed) newlyLoadedTraits.push(args.trait as string);
            }
            /* Phase 4：记录本 form 引入的 trait，供 submit / cancel 时回收 */
            formManager.addLoadedTraits(formId, newlyLoadedTraits);

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              /* 命令型 open 带入的 trait 是"临时生效"——submit/close 此 form 后会自动回收。
               * 若想保留某 trait 跨越 form 关闭，可以再 open(title="固定能力", type="trait", name=X, description="...") 固定它。 */
              const loadHint = newlyLoadedTraits.length > 0
                ? `本次新加载 trait（临时生效，form 关闭即回收）：${newlyLoadedTraits.join(", ")}。如需保留某 trait，可 open(title="固定能力", type="trait", name="...", description="...") 固定它`
                : `相关 trait 已在作用域内，无新增`;
              td.actions.push({
                type: "inject",
                content: `Form ${formId} 已创建（${command}）。${loadHint}。下一步：请调用 submit({"form_id":"${formId}", ...}) 提交。`,
                timestamp: Date.now(),
              });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] open command: ${command} → ${formId}`);
            /* open(args) 等价于 open + refine(args)：若用户带了 args，立即应用 refine */
            if (args.args && typeof args.args === "object") {
              const incomingPre = args.args as Record<string, unknown>;
              if (Object.keys(incomingPre).length > 0) {
                const refined = formManager.applyRefine(formId, incomingPre);
                if (refined) {
                  const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
                  for (const traitName of traitsToLoad) {
                    if (refined.loadedTraits.includes(traitName)) continue;
                    const changed = await tree.activateTrait(threadId, traitName);
                    if (changed) formManager.addLoadedTraits(formId, [traitName]);
                  }
                  const td2 = tree.readThreadData(threadId);
                  if (td2) {
                    td2.activeForms = formManager.toData();
                    td2.actions.push({
                      type: "inject",
                      content: `[refine via open] 预填参数已累积；当前路径：${refined.commandPaths.join(", ")}。`,
                      timestamp: Date.now(),
                    });
                    tree.writeThreadData(threadId, td2);
                  }
                }
              }
            }

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
              /* open(type="trait") 语义：激活 + 固定。
               * - 若 trait 未激活：activateTrait 激活；pinTrait 固定
               * - 若 trait 已激活但未固定（临时态）：pinTrait 将其"提升"为固定（submit/close 不再自动回收）
               * - 若已激活已固定：幂等 */
              const activateChanged = await tree.activateTrait(threadId, resolvedTraitName);
              const pinChanged = await tree.pinTrait(threadId, resolvedTraitName);
              const formId = formManager.begin("_trait", description, { trait: resolvedTraitName });
              const td = tree.readThreadData(threadId);
              if (td) {
                td.activeForms = formManager.toData();
                let hint: string;
                if (activateChanged && pinChanged) {
                  hint = `Trait ${resolvedTraitName} 已加载到作用域并固定（submit/close 不会自动回收）`;
                } else if (!activateChanged && pinChanged) {
                  hint = `Trait ${resolvedTraitName} 原本为临时生效，现已固定（submit/close 不再自动回收）`;
                } else if (activateChanged && !pinChanged) {
                  /* 理论上不会发生：activate 新增但 pin 已存在 */
                  hint = `Trait ${resolvedTraitName} 已加载且已固定`;
                } else {
                  hint = `Trait ${resolvedTraitName} 已在作用域内且已固定（open 成功，无状态变化）`;
                }
                td.actions.push({ type: "inject", content: `${hint}。`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open trait (pin): ${traitInput} → ${resolvedTraitName} → ${formId} (pin=${pinChanged})`);
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
            /* 文件读取：支持虚拟路径 @trait:... / @relation:... / 普通相对路径 */
            const filePath = args.path as string;
            const linesLimit = args.lines as number | undefined;
            const rootDir = config.paths?.rootDir ?? config.rootDir;
            const stoneDir = config.paths?.stoneDir;
            const flowsDir = config.paths?.flowsDir ?? config.flowsDir;

            const { resolved, isVirtual, kind } = resolveOpenFilePath(filePath, rootDir, objectName, stoneDir, flowsDir);
            if (!resolved) {
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({
                  type: "inject",
                  content: `[错误] 路径 "${filePath}" 无法解析（未知虚拟前缀或格式错误）`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, td);
              }
              consola.warn(`[Engine] open file: ${filePath} unresolved`);
            } else if (!existsSync(resolved)) {
              const td = tree.readThreadData(threadId);
              if (td) {
                const hint = isVirtual
                  ? `[错误] 虚拟路径 "${filePath}" 指向的文件不存在（${resolved}）`
                  : `[错误] 文件 "${filePath}" 不存在`;
                td.actions.push({ type: "inject", content: hint, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.warn(`[Engine] open file: ${filePath} not found (resolved=${resolved})`);
            } else {
              let content = readFileSync(resolved, "utf-8");
              if (linesLimit && linesLimit > 0) {
                const lines = content.split("\n");
                content = lines.slice(0, linesLimit).join("\n");
                if (lines.length > linesLimit) {
                  content += `\n... (共 ${lines.length} 行，已截取前 ${linesLimit} 行)`;
                }
              }

              /* window 的 key 用 LLM 原始输入（包括虚拟路径本身），便于 LLM 识别 / close 时反查 */
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
                const kindLabel = kind === "trait" ? "Trait" : kind === "relation" ? "关系文件" : "文件";
                td.actions.push({
                  type: "inject",
                  content: `${kindLabel} "${filePath}" 已加载到上下文窗口。${linesLimit ? `（前 ${linesLimit} 行）` : ""}`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open ${kind}: ${filePath}${linesLimit ? ` (${linesLimit} lines)` : ""} → ${formId}`);
            }
          }
        }

        /* --- Refine --- */
        else if (toolName === "refine") {
          const formId = (args.form_id as string) ?? "";
          const incoming = (args.args as Record<string, unknown> | undefined) ?? {};

          const updatedForm = formManager.applyRefine(formId, incoming);
          if (!updatedForm) {
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({
                type: "inject",
                content: `[错误] refine 失败：Form ${formId} 不存在。`,
                timestamp: Date.now(),
              });
              tree.writeThreadData(threadId, td);
            }
          } else {
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
            const newlyLoadedTraits: string[] = [];
            for (const traitName of traitsToLoad) {
              if (updatedForm.loadedTraits.includes(traitName)) continue;
              const changed = await tree.activateTrait(threadId, traitName);
              if (changed) newlyLoadedTraits.push(traitName);
            }
            if (newlyLoadedTraits.length > 0) {
              formManager.addLoadedTraits(formId, newlyLoadedTraits);
            }
            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              const pathHint = `当前路径：${updatedForm.commandPaths.join(", ")}`;
              const loadHint = newlyLoadedTraits.length > 0
                ? `按新路径追加 trait：${newlyLoadedTraits.join(", ")}`
                : `按新路径无新增 trait`;
              td.actions.push({
                type: "inject",
                content: `[refine] Form ${formId} 已累积参数（未执行）。${pathHint}。${loadHint}。可继续 refine，或 submit() 执行指令。`,
                timestamp: Date.now(),
              });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] refine: form=${formId} paths=${updatedForm.commandPaths.join(", ")}`);
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
            /* Phase 4：把累积 args 合并进本次调用 args，让"渐进填表"对下游指令透明 */
            if (form.accumulatedArgs && Object.keys(form.accumulatedArgs).length > 0) {
              for (const [k, v] of Object.entries(form.accumulatedArgs)) {
                if (!(k in args)) args[k] = v;
              }
            }
            const command = form.command;

            await executeCommand(command, {
              tree,
              threadId,
              objectName,
              sessionId,
              rootDir: config.rootDir,
              traits: config.traits,
              form,
              args,
              scheduler,
              executor,
              methodRegistry,
              onTalk: config.onTalk,
              buildExecContext,
              executeProgramTraitMethod,
              triggerBuildHooksAfterCall,
              runBuildHooks,
              genMessageOutId,
              extractTalkForm,
              getAutoAckMessageId,
            });

            /* trait 卸载（submit 结束时）
             * Phase 4：优先用 form.loadedTraits；向后兼容的兜底走 collectCommandTraits。
             * 仍被其他 active form 需要的 trait 不卸。固定 trait 亦豁免。 */
            if (command !== "_trait" && command !== "_skill" && command !== "defer") {
              if (!formManager.activeCommands().has(form.command)) {
                const traitsToUnload = form.loadedTraits && form.loadedTraits.length > 0
                  ? form.loadedTraits
                  : collectCommandTraits(config.traits, new Set([form.command]));
                const stillNeededSet = new Set(collectCommandTraits(config.traits, formManager.activeCommandPaths()));
                for (const traitName of traitsToUnload) {
                  if (tree.isPinnedTrait(threadId, traitName)) continue;
                  if (stillNeededSet.has(traitName)) continue;
                  /* always trait 语义 pinned：不应随 command form submit 自动回收 */
                  if (isAlwaysTrait(config.traits, traitName)) continue;
                  await tree.deactivateTrait(threadId, traitName);
                }
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
            const tdAfter = tree.readThreadData(threadId);
            if (tdAfter) { tdAfter.activeForms = formManager.toData(); tree.writeThreadData(threadId, tdAfter); }
            consola.info(`[Engine] form.submit: ${command} (${form.formId})`);
          }
        }

        /* --- Close --- */
        else if (toolName === "close") {
          const form = formManager.cancel(args.form_id as string ?? "");
          if (form) {
            /* 追踪本次关闭实际卸载的 trait 与"因固定而保留"的 trait，供 inject 文案使用 */
            const unloadedTraits: string[] = [];
            const keptPinnedTraits: string[] = [];
            if (form.command !== "_trait" && form.command !== "_skill" && form.command !== "_file") {
              // command 类型：卸载本 form 引入的 trait
              // Phase 4：优先用 form.loadedTraits（含渐进填表带入的子 trait）。
              //          回退路径：老 form 没有 loadedTraits 字段时用 collectCommandTraits 兜底。
              // 仅当该 command 已无其他 active form 时才卸载；固定 trait 豁免。
              if (!formManager.activeCommands().has(form.command)) {
                const traitsToUnload = form.loadedTraits && form.loadedTraits.length > 0
                  ? form.loadedTraits
                  : collectCommandTraits(config.traits, new Set([form.command]));
                /* 当前仍需被其他 active form 的 commandPaths 集合所需 → 不卸 */
                const stillNeededSet = new Set(collectCommandTraits(config.traits, formManager.activeCommandPaths()));
                for (const traitName of traitsToUnload) {
                  if (tree.isPinnedTrait(threadId, traitName)) {
                    keptPinnedTraits.push(traitName);
                    continue;
                  }
                  if (stillNeededSet.has(traitName)) {
                    keptPinnedTraits.push(traitName);
                    continue;
                  }
                  /* always trait 语义 pinned：不应随 command form close 自动回收 */
                  if (isAlwaysTrait(config.traits, traitName)) {
                    keptPinnedTraits.push(traitName);
                    continue;
                  }
                  const changed = await tree.deactivateTrait(threadId, traitName);
                  if (changed) unloadedTraits.push(traitName);
                }
              }
            } else if (form.command === "_trait" && form.trait) {
              // trait 类型：close 等价 unpin + 可能 deactivate。
              // 逻辑：先 unpin；若该 trait 不再被任何 active command 需要，则 deactivate；
              //       但协议基座 trait 本身豁免，只做 unpin 语义。
              await tree.unpinTrait(threadId, form.trait);
              const stillNeededByCommand = new Set(collectCommandTraits(config.traits, formManager.activeCommandPaths())).has(form.trait);
              if (!stillNeededByCommand && !isAlwaysTrait(config.traits, form.trait)) {
                const changed = await tree.deactivateTrait(threadId, form.trait);
                if (changed) unloadedTraits.push(form.trait);
              } else {
                /* 仍被命令需要 或 always trait → 降级为临时生效 / 保留 */
                keptPinnedTraits.push(form.trait);
              }
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
              let closeHint: string;
              if (form.command === "_file" && form.trait) {
                /* 文件类型：描述文件已从上下文窗口移除 */
                closeHint = `文件 "${form.trait}" 已从上下文窗口移除。`;
              } else {
                const parts: string[] = [];
                if (unloadedTraits.length > 0) parts.push(`本次卸载 trait：${unloadedTraits.join(", ")}`);
                if (keptPinnedTraits.length > 0) parts.push(`已固定 trait 保留未卸载：${keptPinnedTraits.join(", ")}`);
                if (parts.length === 0) parts.push(`无 trait 被卸载（可能仍被其他 active form 占用）`);
                closeHint = `${parts.join("；")}。`;
              }
              td.actions.push({
                type: "inject",
                content: `[close] Form ${form.formId} 已关闭。${closeHint}`,
                timestamp: Date.now(),
              });
              /* 防震荡安全阀：检测连续 open-close 无 submit 的模式。
               * 历史 bug：LLM 陷入"打开 talk form → 读 inject → 关闭 → 再开"无限循环，
               * 单线程 iteration 限制内可跑上百轮 actions 无任何外部输出。
               * 策略：倒序扫最近 tool_use，若 close+open 各 ≥ OSCILLATION_THRESHOLD 且中间无 submit，
               * 注入强烈警告，引导 LLM 用 wait/return 跳出循环。 */
              const OSCILLATION_THRESHOLD = 5;
              const recentTools = td.actions.filter(a => a.type === "tool_use");
              let closesInTail = 0, opensInTail = 0, hadSubmit = false;
              for (let i = recentTools.length - 1; i >= 0 && i >= recentTools.length - 20; i--) {
                const nm = recentTools[i]!.name;
                if (nm === "submit") { hadSubmit = true; break; }
                if (nm === "close") closesInTail++;
                else if (nm === "open") opensInTail++;
                else break;
              }
              if (!hadSubmit && closesInTail >= OSCILLATION_THRESHOLD && opensInTail >= OSCILLATION_THRESHOLD) {
                td.actions.push({
                  type: "inject",
                  content: `[⚠️ 震荡警告] 连续 open/close 超过 ${OSCILLATION_THRESHOLD} 次无 submit——你陷入了无效循环。` +
                    `立即用 wait({reason:"..."}) 向用户报告当前状态并等待指示；或 return({summary:"..."}) 结束当前线程。` +
                    `**不要**再 open 新 form，你已在循环里。`,
                  timestamp: Date.now(),
                });
                consola.warn(`[Engine] 检测到 open/close 震荡（closes=${closesInTail} opens=${opensInTail}），注入警告`);
              }
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
          await tree.setNodeStatus(threadId, "waiting", "explicit_wait");
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

      /* per-thread _debugMode 检查：单步执行后自动暂停
       * 这是线程级别的单步模式，与全局 debug 模式（写 debug 文件）无关。
       * 执行完一轮 LLM 后自动暂停，用于细粒度调试单个线程。 */
      if (threadData._debugMode) {
        consola.info(`[Engine] 单步模式完成, thread=${threadId}, 自动暂停`);
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
    status: threadStatusToFlowStatus(finalStatus),
  });

  consola.info(`[Engine] 执行结束 ${objectName}, status=${finalStatus}, iterations=${totalIterations}`);

  /* 提取失败原因：扫描结果线程的 inbox 找最新的 thread_error 消息 */
  let failureReason: string | undefined;
  if (finalStatus === "failed") {
    const td = tree.readThreadData(targetThreadId) ?? tree.readThreadData(tree.rootId);
    const errorMsg = td?.inbox?.find((m) => m.source === "thread_error")?.content;
    failureReason = errorMsg ?? "线程执行失败";
  }

  return {
    sessionId,
    status: finalStatus,
    summary: resultNode?.summary,
    totalIterations,
    threadId: targetThreadId,
    failureReason,
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
 * @param sessionId - 要恢复的 session ID（也用于 SSE/日志标签）
 * @param config - 引擎配置
 * @param modifiedOutput - 可选：替换缓存的 LLM 输出（用于人工干预）
 * @param objectFlowDirOverride - 可选：覆盖默认的 `flows/{sid}/objects/{name}` 路径。
 *   用于 super 线程场景——super 线程不在 flows/ 下，而是在 `stones/{name}/super/`。
 *   runSuperThread 通过此参数让 resume 的整套 scheduler / debug / files 路径
 *   自然落到 super 目录，无需复制 600 行 resume 代码。
 * @returns 执行结果
 */
export async function resumeWithThreadTree(
  objectName: string,
  sessionId: string,
  config: EngineConfig,
  modifiedOutput?: string,
  objectFlowDirOverride?: string,
): Promise<TalkResult> {
  const sessionDir = join(config.flowsDir, sessionId);
  const objectFlowDir = objectFlowDirOverride ?? join(sessionDir, "objects", objectName);

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

  /* 复用 buildExecContext（与 runWithThreadTree 相同逻辑）
   * 返回 getWrittenPaths()：沙箱内 file_ops.writeFile/editFile 累计 path 供 program 后触发 hooks。
   */
  const buildExecContext = (threadId: string): { context: Record<string, unknown>; getOutputs: () => string[]; getWrittenPaths: () => string[] } => {
    const outputs: string[] = [];
    const writtenPaths: string[] = [];
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
        writtenPaths.push(path);
      },
      listFiles: (path: string) => {
        const resolved = resolve(rootDir, path);
        if (!existsSync(resolved)) return [];
        return readdirSync(resolved);
      },
      fileExists: (path: string) => existsSync(resolve(rootDir, path)),
      local: tree.readThreadData(threadId)?.locals ?? {},

      /* compact trait 专用内部字段：见 runWithThreadTree 同名注释 */
      __threadId: threadId,
      __threadsTree: tree,
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

    /* Phase 3：resume 路径同 run 路径，统一用 open-files 中枢 */
    const computeActiveTraitIds = (): string[] => {
      const td = tree.readThreadData(threadId);
      if (!td) return [];
      return getOpenFiles({
        tree: tree.toFile(),
        threadId,
        threadData: td,
        stone: config.stone,
        traits: config.traits,
      }).activeTraitIds;
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
      /* 透传 threadId —— apply_edits 等 trait 方法用它把 build_hooks feedback 归档到本线程 */
      threadId,
    };
    /* 沙箱只暴露 { callMethod } 单函数（Phase 2 协议） */
    const sandboxApiRaw = methodRegistry.buildSandboxMethods(methodCtx, objectName);
    /* 包装 callMethod：file_ops.writeFile / editFile 成功后记录 path（resume 路径同 run 路径） */
    const sandboxApi = {
      callMethod: async (traitIdRaw: string, methodName: string, args?: object) => {
        const result = await sandboxApiRaw.callMethod(traitIdRaw, methodName, args);
        const paths = extractWrittenPaths(traitIdRaw, methodName, args);
        for (const p of paths) writtenPaths.push(p);
        return result;
      },
    };
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
    return { context, getOutputs: () => outputs, getWrittenPaths: () => [...writtenPaths] };
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
      /* 流式 thinking 是否有 chunk 到达：跨 else 与块外 if (thinkingContent) 共用。 */
      let sawThinkingChunk = false;

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
        /* Phase 3 — llm_input_viewer：resume 路径同样把活跃 form 作为 <user> 子节点 */
        const activeFormsViewResume: ActiveFormView[] = formManager.activeForms().map(f => ({
          formId: f.formId,
          command: f.command,
          description: f.description,
          trait: f.trait,
        }));
        messages = contextToMessages(context, threadData.hooks, activeFormsViewResume);

        /* Compact 阈值提示（resume 路径，与 runWithThreadTree 同义） */
        if (!formManager.activeCommands().has("compact")) {
          const currentTokens = estimateActionsTokens(threadData.actions);
          if (currentTokens > COMPACT_THRESHOLD_TOKENS) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.role === "user") {
              lastMsg.content += buildCompactHint(currentTokens);
            }
          }
        }

        /* 构建动态 tools 列表 */
        const availableTools = buildAvailableTools();

        const llmStartTime = Date.now();
        const llmResult = typeof config.llm.chatWithThinkingStream === "function"
          ? await config.llm.chatWithThinkingStream(messages, {
              tools: availableTools,
              onThinkingChunk: (chunk) => {
                sawThinkingChunk = true;
                emitSSE({ type: "stream:thought", objectName, sessionId, chunk });
              },
            })
          : await config.llm.chat(messages, { tools: availableTools });
        llmLatencyMs = Date.now() - llmStartTime;
        llmOutput = llmResult.content;
        thinkingContent = llmResult.thinkingContent;
        llmModel = (llmResult as any).model || "unknown";
        llmUsage = (llmResult as any).usage ?? {};
        toolCalls = llmResult.toolCalls;
        if (sawThinkingChunk) {
          emitSSE({ type: "stream:thought:end", objectName, sessionId });
        }

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
        /* 仅非流式路径需要在此补发整段——流式路径已在 onThinkingChunk 中逐段发过并 end */
        if (!sawThinkingChunk) {
          emitSSE({ type: "stream:thought", objectName, sessionId, chunk: thinkingContent });
          emitSSE({ type: "stream:thought:end", objectName, sessionId });
        }

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
         * submit 场景下 args.title 保留（think(fork) 的子线程名 fallback） */
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
              trait: args.trait as string, method: args.method as string,
            });
            /* Phase 4：按 commandPaths 集合做精确匹配（match 已显式包含所有父路径） */
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
            const newlyLoadedTraits: string[] = [];
            for (const traitName of traitsToLoad) {
              const changed = await tree.activateTrait(threadId, traitName);
              if (changed) newlyLoadedTraits.push(traitName);
            }
            if (command === PROGRAM_COMMAND && args.trait) {
              const changed = await tree.activateTrait(threadId, args.trait as string);
              if (changed) newlyLoadedTraits.push(args.trait as string);
            }
            formManager.addLoadedTraits(formId, newlyLoadedTraits);

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              const loadHint = newlyLoadedTraits.length > 0
                ? `本次新加载 trait（临时生效，form 关闭即回收）：${newlyLoadedTraits.join(", ")}。如需保留某 trait，可 open(title="固定能力", type="trait", name="...", description="...") 固定它`
                : `相关 trait 已在作用域内，无新增`;
              td.actions.push({
                type: "inject",
                content: `Form ${formId} 已创建（${command}）。${loadHint}。下一步：请调用 submit({"form_id":"${formId}", ...}) 提交。`,
                timestamp: Date.now(),
              });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] open command: ${command} → ${formId}`);
            /* open(args) 等价于 open + refine(args)：若用户带了 args，立即应用 refine */
            if (args.args && typeof args.args === "object") {
              const incomingPre = args.args as Record<string, unknown>;
              if (Object.keys(incomingPre).length > 0) {
                const refined = formManager.applyRefine(formId, incomingPre);
                if (refined) {
                  const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
                  for (const traitName of traitsToLoad) {
                    if (refined.loadedTraits.includes(traitName)) continue;
                    const changed = await tree.activateTrait(threadId, traitName);
                    if (changed) formManager.addLoadedTraits(formId, [traitName]);
                  }
                  const td2 = tree.readThreadData(threadId);
                  if (td2) {
                    td2.activeForms = formManager.toData();
                    td2.actions.push({
                      type: "inject",
                      content: `[refine via open] 预填参数已累积；当前路径：${refined.commandPaths.join(", ")}。`,
                      timestamp: Date.now(),
                    });
                    tree.writeThreadData(threadId, td2);
                  }
                }
              }
            }

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
              /* open(type="trait") 语义：激活 + 固定。
               * - 若 trait 未激活：activateTrait 激活；pinTrait 固定
               * - 若 trait 已激活但未固定（临时态）：pinTrait 将其"提升"为固定（submit/close 不再自动回收）
               * - 若已激活已固定：幂等 */
              const activateChanged = await tree.activateTrait(threadId, resolvedTraitName);
              const pinChanged = await tree.pinTrait(threadId, resolvedTraitName);
              const formId = formManager.begin("_trait", description, { trait: resolvedTraitName });
              const td = tree.readThreadData(threadId);
              if (td) {
                td.activeForms = formManager.toData();
                let hint: string;
                if (activateChanged && pinChanged) {
                  hint = `Trait ${resolvedTraitName} 已加载到作用域并固定（submit/close 不会自动回收）`;
                } else if (!activateChanged && pinChanged) {
                  hint = `Trait ${resolvedTraitName} 原本为临时生效，现已固定（submit/close 不再自动回收）`;
                } else if (activateChanged && !pinChanged) {
                  /* 理论上不会发生：activate 新增但 pin 已存在 */
                  hint = `Trait ${resolvedTraitName} 已加载且已固定`;
                } else {
                  hint = `Trait ${resolvedTraitName} 已在作用域内且已固定（open 成功，无状态变化）`;
                }
                td.actions.push({ type: "inject", content: `${hint}。`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open trait (pin): ${traitInput} → ${resolvedTraitName} → ${formId} (pin=${pinChanged})`);
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
            /* resume 路径同 run 路径：支持虚拟路径 @trait:... / @relation:... */
            const filePath = args.path as string;
            const linesLimit = args.lines as number | undefined;
            const rootDir = config.paths?.rootDir ?? config.rootDir;
            const stoneDir = config.paths?.stoneDir;
            const flowsDir = config.paths?.flowsDir ?? config.flowsDir;

            const { resolved, isVirtual, kind } = resolveOpenFilePath(filePath, rootDir, objectName, stoneDir, flowsDir);
            if (!resolved) {
              const td = tree.readThreadData(threadId);
              if (td) { td.actions.push({ type: "inject", content: `[错误] 路径 "${filePath}" 无法解析（未知虚拟前缀或格式错误）`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              consola.warn(`[Engine] open file: ${filePath} unresolved (resume)`);
            } else if (!existsSync(resolved)) {
              const td = tree.readThreadData(threadId);
              const hint = isVirtual ? `[错误] 虚拟路径 "${filePath}" 指向的文件不存在（${resolved}）` : `[错误] 文件 "${filePath}" 不存在`;
              if (td) { td.actions.push({ type: "inject", content: hint, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              consola.warn(`[Engine] open file: ${filePath} not found (resume, resolved=${resolved})`);
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
                const kindLabel = kind === "trait" ? "Trait" : kind === "relation" ? "关系文件" : "文件";
                td.actions.push({ type: "inject", content: `${kindLabel} "${filePath}" 已加载到上下文窗口。${linesLimit ? `（前 ${linesLimit} 行）` : ""}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              consola.info(`[Engine] open ${kind}: ${filePath}${linesLimit ? ` (${linesLimit} lines)` : ""} → ${formId} (resume)`);
            }
          }

        /* --- Refine (resume) --- */
        } else if (toolName === "refine") {
          const formId = (args.form_id as string) ?? "";
          const incoming = (args.args as Record<string, unknown> | undefined) ?? {};
          const updatedForm = formManager.applyRefine(formId, incoming);
          if (!updatedForm) {
            const td = tree.readThreadData(threadId);
            if (td) { td.actions.push({ type: "inject", content: `[错误] refine 失败：Form ${formId} 不存在。`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
          } else {
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
            const newlyLoadedTraits: string[] = [];
            for (const traitName of traitsToLoad) {
              if (updatedForm.loadedTraits.includes(traitName)) continue;
              const changed = await tree.activateTrait(threadId, traitName);
              if (changed) newlyLoadedTraits.push(traitName);
            }
            if (newlyLoadedTraits.length > 0) formManager.addLoadedTraits(formId, newlyLoadedTraits);
            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              const pathHint = `当前路径：${updatedForm.commandPaths.join(", ")}`;
              const loadHint = newlyLoadedTraits.length > 0 ? `按新路径追加 trait：${newlyLoadedTraits.join(", ")}` : `按新路径无新增 trait`;
              td.actions.push({ type: "inject", content: `[refine] Form ${formId} 已累积参数（未执行）。${pathHint}。${loadHint}。可继续 refine，或 submit() 执行指令。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] refine(resume): form=${formId} paths=${updatedForm.commandPaths.join(", ")}`);
          }

        /* --- Submit (resume) --- */
        } else if (toolName === "submit") {
          const form = formManager.submit(args.form_id as string ?? "");
          if (!form) {
            const td = tree.readThreadData(threadId);
            if (td) { td.actions.push({ type: "inject", content: `[错误] Form ${args.form_id} 不存在。`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
          } else {
            /* Phase 4：合并累积 args */
            if (form.accumulatedArgs && Object.keys(form.accumulatedArgs).length > 0) {
              for (const [k, v] of Object.entries(form.accumulatedArgs)) {
                if (!(k in args)) args[k] = v;
              }
            }
            const command = form.command;
            await executeCommand(command, {
              tree,
              threadId,
              objectName,
              sessionId,
              rootDir: config.rootDir,
              traits: config.traits,
              form,
              args,
              scheduler,
              executor,
              methodRegistry,
              onTalk: config.onTalk,
              buildExecContext,
              executeProgramTraitMethod,
              triggerBuildHooksAfterCall,
              runBuildHooks,
              genMessageOutId,
              extractTalkForm,
              getAutoAckMessageId,
            });

            if (command !== "_trait" && command !== "_skill" && command !== "defer") {
              /* Phase 4 同 run 路径：优先用 form.loadedTraits 卸载本 form 引入的 trait */
              if (!formManager.activeCommands().has(form.command)) {
                const traitsToUnload = form.loadedTraits && form.loadedTraits.length > 0
                  ? form.loadedTraits
                  : collectCommandTraits(config.traits, new Set([form.command]));
                const stillNeededSet = new Set(collectCommandTraits(config.traits, formManager.activeCommandPaths()));
                for (const traitName of traitsToUnload) {
                  if (tree.isPinnedTrait(threadId, traitName)) continue;
                  if (stillNeededSet.has(traitName)) continue;
                  /* always trait 语义 pinned：不应随 command form submit 自动回收 */
                  if (isAlwaysTrait(config.traits, traitName)) continue;
                  await tree.deactivateTrait(threadId, traitName);
                }
              }

              const tdForHook = tree.readThreadData(threadId);
              if (tdForHook?.hooks) {
                const hookText = collectCommandHooks(command, tdForHook.hooks);
                if (hookText) {
                  tdForHook.actions.push({ type: "inject", content: hookText, timestamp: Date.now() });
                  tree.writeThreadData(threadId, tdForHook);
                }
              }
            }
            const tdAfter = tree.readThreadData(threadId); if (tdAfter) { tdAfter.activeForms = formManager.toData(); tree.writeThreadData(threadId, tdAfter); }
            consola.info(`[Engine] form.submit: ${command} (${form.formId})`);
          }

        /* --- Close (resume) --- */
        } else if (toolName === "close") {
          const form = formManager.cancel(args.form_id as string ?? "");
          if (form) {
            /* 追踪实际卸载的 trait 与因固定而保留的 trait（见 run 路径同名逻辑） */
            const unloadedTraits: string[] = [];
            const keptPinnedTraits: string[] = [];
            if (form.command !== "_trait" && form.command !== "_skill" && form.command !== "_file") {
              if (!formManager.activeCommands().has(form.command)) {
                /* Phase 4 同 run 路径：优先 form.loadedTraits */
                const traitsToUnload = form.loadedTraits && form.loadedTraits.length > 0
                  ? form.loadedTraits
                  : collectCommandTraits(config.traits, new Set([form.command]));
                const stillNeededSet = new Set(collectCommandTraits(config.traits, formManager.activeCommandPaths()));
                for (const traitName of traitsToUnload) {
                  if (tree.isPinnedTrait(threadId, traitName)) {
                    keptPinnedTraits.push(traitName);
                    continue;
                  }
                  if (stillNeededSet.has(traitName)) {
                    keptPinnedTraits.push(traitName);
                    continue;
                  }
                  /* always trait 语义 pinned：不应随 command form close 自动回收 */
                  if (isAlwaysTrait(config.traits, traitName)) {
                    keptPinnedTraits.push(traitName);
                    continue;
                  }
                  const changed = await tree.deactivateTrait(threadId, traitName);
                  if (changed) unloadedTraits.push(traitName);
                }
              }
            } else if (form.command === "_trait" && form.trait) {
              /* close _trait 型 form：unpin + 若无命令再需要则 deactivate；
               * 协议基座 trait 豁免 deactivate。 */
              await tree.unpinTrait(threadId, form.trait);
              const stillNeededByCommand = new Set(collectCommandTraits(config.traits, formManager.activeCommandPaths())).has(form.trait);
              if (!stillNeededByCommand && !isAlwaysTrait(config.traits, form.trait)) {
                const changed = await tree.deactivateTrait(threadId, form.trait);
                if (changed) unloadedTraits.push(form.trait);
              } else {
                keptPinnedTraits.push(form.trait);
              }
            } else if (form.command === "_file" && form.trait) {
              const td = tree.readThreadData(threadId);
              if (td?.windows?.[form.trait]) { delete td.windows[form.trait]; tree.writeThreadData(threadId, td); }
            }
            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              let closeHint: string;
              if (form.command === "_file" && form.trait) {
                /* 文件类型：描述文件已从上下文窗口移除 */
                closeHint = `文件 "${form.trait}" 已从上下文窗口移除。`;
              } else {
                const parts: string[] = [];
                if (unloadedTraits.length > 0) parts.push(`本次卸载 trait：${unloadedTraits.join(", ")}`);
                if (keptPinnedTraits.length > 0) parts.push(`已固定 trait 保留未卸载：${keptPinnedTraits.join(", ")}`);
                if (parts.length === 0) parts.push(`无 trait 被卸载（可能仍被其他 active form 占用）`);
                closeHint = `${parts.join("；")}。`;
              }
              td.actions.push({
                type: "inject",
                content: `[close] Form ${form.formId} 已关闭。${closeHint}`,
                timestamp: Date.now(),
              });
              /* 防震荡安全阀（见 runWithThreadTree 同名逻辑）：连续 open/close 无 submit → 强警告 */
              const OSCILLATION_THRESHOLD = 5;
              const recentTools = td.actions.filter(a => a.type === "tool_use");
              let closesInTail = 0, opensInTail = 0, hadSubmit = false;
              for (let i = recentTools.length - 1; i >= 0 && i >= recentTools.length - 20; i--) {
                const nm = recentTools[i]!.name;
                if (nm === "submit") { hadSubmit = true; break; }
                if (nm === "close") closesInTail++;
                else if (nm === "open") opensInTail++;
                else break;
              }
              if (!hadSubmit && closesInTail >= OSCILLATION_THRESHOLD && opensInTail >= OSCILLATION_THRESHOLD) {
                td.actions.push({
                  type: "inject",
                  content: `[⚠️ 震荡警告] 连续 open/close 超过 ${OSCILLATION_THRESHOLD} 次无 submit——你陷入了无效循环。` +
                    `立即用 wait({reason:"..."}) 向用户报告当前状态并等待指示；或 return({summary:"..."}) 结束当前线程。` +
                    `**不要**再 open 新 form，你已在循环里。`,
                  timestamp: Date.now(),
                });
                consola.warn(`[Engine] 检测到 open/close 震荡（closes=${closesInTail} opens=${opensInTail}），注入警告`);
              }
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] close: ${form.command} (${form.formId})`);
          } else {
            const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `[提示] Form ${args.form_id} 不存在（可能已被 submit 消费）。请直接执行下一步操作。`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            consola.warn(`[Engine] close: form ${args.form_id} not found`);
          }

        /* --- Wait (resume) --- */
        } else if (toolName === "wait") {
          const reason = args.reason as string ?? "";
          await tree.setNodeStatus(threadId, "waiting", "explicit_wait");
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
        consola.info(`[Engine] 单步模式完成, thread=${threadId}, 自动暂停`);
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
    status: threadStatusToFlowStatus(finalStatus),
  });

  consola.info(`[Engine] 恢复执行结束 ${objectName}, status=${finalStatus}, iterations=${totalIterations}`);

  /* 提取失败原因：扫描根线程 inbox 找最新的 thread_error 消息 */
  let failureReason: string | undefined;
  if (finalStatus === "failed") {
    const td = tree.readThreadData(tree.rootId);
    const errorMsg = td?.inbox?.find((m) => m.source === "thread_error")?.content;
    failureReason = errorMsg ?? "线程执行失败";
  }

  return { sessionId, status: finalStatus, summary: rootNode?.summary, totalIterations, threadId: tree.rootId, failureReason };
}

/**
 * 单步执行线程树（per-thread 单步模式）
 *
 * 为所有 running 线程设置 _debugMode 标志，执行一轮后自动暂停。
 * 这是线程级细粒度调试机制，独立于全局 debug 模式（写 debug 文件）。
 * 可选替换缓存的 LLM 输出（人工干预调试）。
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
