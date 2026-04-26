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
import { CodeExecutor, executeShell } from "../executable/executor.js";
import { MethodRegistry, type MethodContext } from "../trait/registry.js";
import { traitId } from "../knowledge/activator.js";
import { FormManager } from "./form.js";
import { collectCommandTraits, collectCommandHooks } from "./hooks.js";
import { buildAvailableTools } from "./tools.js";
import { resolveVirtualPath, isVirtualPath } from "./virtual-path.js";
import { detectSelfKind } from "./self-kind.js";
import { runBuildHooks } from "../world/hooks.js";
import { serializeXml, type XmlNode } from "./xml.js";

import type { LLMClient, Message, ToolCall } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, ContextWindow } from "../types/index.js";
import type { SkillDefinition } from "../skill/types.js";
import { writeDebugLoop, computeContextStats, getExistingLoopCount } from "./debug.js";
import { loadSkillBody } from "../skill/loader.js";
import {
  estimateActionsTokens,
  applyCompact,
  buildCompactHint,
  COMPACT_THRESHOLD_TOKENS,
} from "./compact.js";
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

/** always trait 判定
 *
 * when="always" 语义上等价 pinned：不应因 command form 生命周期而显示 transient
 * 或被自动回收。trait 卸载 / deactivate / unpin 路径都应绕过 always trait。
 */
function isAlwaysTrait(traits: TraitDefinition[], fullId: string): boolean {
  const t = traits.find((tr) => traitId(tr) === fullId);
  return t?.when === "always";
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
  /** 实际执行的线程 ID（用于 talk(context="continue")） */
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
  /** 关联的底层线程 ID（用于 talk(context="continue")） */
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
 * 提取一次 call_function 参数中涉及的"被写入文件路径"（用于触发 build hooks）
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
  functionName: string | undefined,
  args: unknown,
): string[] {
  if (!trait || !functionName) return [];
  const isFileOps =
    trait === "computable/file_ops" ||
    trait === "kernel:computable/file_ops" ||
    trait.endsWith(":computable/file_ops");
  if (!isFileOps) return [];
  const targetMethods = new Set(["writeFile", "editFile"]);
  if (!targetMethods.has(functionName)) return [];
  if (!args || typeof args !== "object") return [];
  const path = (args as Record<string, unknown>).path;
  if (typeof path !== "string" || path.length === 0) return [];
  return [path];
}

/**
 * 在 call_function 执行成功后触发 build hooks，并把结果写入 thread inject
 *
 * 调用方传入必要上下文；此函数不抛出（hook 内部失败被吞）。
 * 返回 inject 用的文本（可能为空串）。
 */
async function triggerBuildHooksAfterCall(params: {
  trait?: string;
  functionName?: string;
  args: unknown;
  rootDir: string;
  threadId: string;
}): Promise<string> {
  try {
    const paths = extractWrittenPaths(params.trait, params.functionName, params.args);
    if (paths.length === 0) return "";
    consola.info(`[build_hooks] call_function 触发 trait=${params.trait} fn=${params.functionName} paths=${paths.join(",")}`);
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

/* XML 结构化输出辅助已抽到独立模块 src/thread/xml.ts（便于单元测试） */

/**
 * 将 ThreadContext 转换为 LLM Messages
 *
 * 构建 system + user 两条消息，XML 结构按嵌套层级缩进：
 * - system：<system> 容器包裹 <identity> / <instructions> / <knowledge>
 * - user：<user> 容器包裹 <task> / <creator> / <plan> / <process> / <inbox> / <todos> /
 *   <defers> / <children> / <ancestors> / <siblings> / <directory> / <paths> / <status>
 *
 * 只有标签行被缩进；叶子节点的 content 原样输出（不破坏 Markdown / 代码块 / 长文本）。
 */
/**
 * 活跃 Form 的简化视图（contextToMessages 侧不关心 FormManager 内部细节）
 *
 * Phase 3 —— llm_input_viewer：把 <active-forms> 从 engine 外部追加改为
 * contextToMessages 内部以 <user> 子节点形式生成，保证前端 DOMParser
 * 把它当作 <user> 的子节点解析。
 */
export interface ActiveFormView {
  formId: string;
  command: string;
  description: string;
  trait?: string;
}

export function contextToMessages(
  ctx: ReturnType<typeof buildThreadContext>,
  deferHooks?: import("./types.js").ThreadFrameHook[],
  activeForms?: ActiveFormView[],
): Message[] {
  /* ========== system 侧：<system> 容器 ========== */
  const systemChildren: XmlNode[] = [];

  /* 身份 */
  systemChildren.push({
    tag: "identity",
    attrs: { name: ctx.name },
    content: ctx.whoAmI,
    comment: "对象身份：readme.md 的完整内容",
  });

  /* 系统指令窗口 */
  if (ctx.instructions.length > 0) {
    systemChildren.push({
      tag: "instructions",
      comment: "系统指令：激活的 kernel trait 注入的行为规则",
      children: ctx.instructions.map(w => {
        const attrs: Record<string, string | number> = { name: w.name };
        /* Phase 3 — llm_input_viewer：source 属性用于前端 hover 溯源 */
        if (w.source) attrs.source = w.source;
        return { tag: "instruction", attrs, content: w.content };
      }),
    });
  }

  /* 知识窗口 */
  if (ctx.knowledge.length > 0) {
    systemChildren.push({
      tag: "knowledge",
      comment: `知识窗口：激活的 library/user trait 和 skill 注入的知识。lifespan="transient" 表示该 trait 由 open(type=command) 带入，form 关闭即回收；lifespan="pinned" 表示用户已显式固定，或该 trait 的 when="always"（语义等价 pinned）。source 属性标明窗口的注入来源（stone_default / thread_pinned / command_binding / always_on / skill_index / memory / coverage / build_feedback / file_window / extra / scope_chain）。若需保留 transient trait，请 open(type="trait", name="X") 固定之。`,
      children: ctx.knowledge.map(w => {
        const attrs: Record<string, string | number> = { name: w.name };
        if (w.lifespan) attrs.lifespan = w.lifespan;
        /* Phase 3 — llm_input_viewer：source 属性用于前端 hover 溯源 */
        if (w.source) attrs.source = w.source;
        return {
          tag: "window",
          attrs,
          content: w.content,
        };
      }),
    });
  }

  const systemRoot: XmlNode = { tag: "system", children: systemChildren };

  /* ========== user 侧：<user> 容器 ========== */
  const userChildren: XmlNode[] = [];

  /* 父线程期望 */
  if (ctx.parentExpectation) {
    userChildren.push({
      tag: "task",
      content: ctx.parentExpectation,
      comment: "任务：用户消息或父线程对当前线程的期望",
    });
  }

  /* 创建者信息 */
  if (ctx.creationMode === "root") {
    userChildren.push({
      tag: "creator",
      attrs: { mode: "root" },
      content: "你是根线程，由用户(user)发起。完成任务后必须用 [return] 返回最终结果。[talk] 只用于向其他对象发消息，不会结束线程。",
    });
  } else {
    userChildren.push({
      tag: "creator",
      attrs: { mode: ctx.creationMode, from: ctx.creator },
      content: `你是子线程，由 ${ctx.creator} 创建（${ctx.creationMode}）。你的职责是完成 <task> 中描述的具体工作，然后用 [return] 返回结果给创建者。不要重复创建者的工作，专注于你被分配的任务。`,
    });
  }

  /* 当前计划 */
  if (ctx.plan) {
    userChildren.push({ tag: "plan", content: ctx.plan });
  }

  /* 执行历史 */
  if (ctx.process) {
    userChildren.push({
      tag: "process",
      content: ctx.process,
      comment: "执行历史：当前线程的所有 actions 时间线",
    });
  } else {
    userChildren.push({
      tag: "process",
      selfClosing: true,
      comment: "执行历史：当前线程的所有 actions 时间线",
    });
  }

  /* 局部变量 */
  if (Object.keys(ctx.locals).length > 0) {
    userChildren.push({ tag: "locals", content: JSON.stringify(ctx.locals, null, 2) });
  }

  /* inbox */
  if (ctx.inbox.length > 0) {
    const unread = ctx.inbox.filter(m => m.status === "unread");
    const marked = ctx.inbox.filter(m => m.status === "marked");
    const inboxChildren: XmlNode[] = [];

    if (unread.length > 0) {
      /* 用一个“空 tag”承载分组注释不合适；改为给每条未读消息注入自己的 comment */
      /* 首条 unread 附带分组注释，以减少噪音 */
      for (let i = 0; i < unread.length; i++) {
        const m = unread[i]!;
        /* Phase 6：relation_update_request 徽章渲染——用 <relation_update_request> 标签替代 <message>，
         * 让 LLM 一眼识别出"这是请求我修改关系文件的提议"。正文内容不变，接收方自主决定。 */
        if (m.kind === "relation_update_request") {
          inboxChildren.push({
            tag: "relation_update_request",
            attrs: { id: m.id, from: m.from, ts: m.timestamp },
            content: m.content,
            comment: i === 0
              ? "关系更新请求（Phase 6）：对方希望你在自己的 relations/{他}.md 里记录某内容。请自主决定接受/部分接受/拒绝；engine 不会自动写入，写入需你自己 call file_ops.writeFile 或 editFile"
              : undefined,
          });
          continue;
        }
        inboxChildren.push({
          tag: "message",
          attrs: { id: m.id, from: m.from, status: "unread" },
          content: m.content,
          comment: i === 0 ? "未读消息：请在下次工具调用时通过 mark 参数标记" : undefined,
        });
      }
    }
    if (marked.length > 0) {
      for (let i = 0; i < marked.length; i++) {
        const m = marked[i]!;
        const attrs: Record<string, string | number> = {
          id: m.id, from: m.from, status: "marked",
        };
        if (m.mark) {
          attrs.mark = m.mark.type;
          attrs.tip = m.mark.tip;
        }
        /* Phase 6：即使已 marked，relation_update_request 仍保留其专用标签形态（便于 LLM 回查） */
        const tag = m.kind === "relation_update_request" ? "relation_update_request" : "message";
        inboxChildren.push({
          tag,
          attrs,
          content: m.content,
          comment: i === 0 ? "已标记消息" : undefined,
        });
      }
    }

    userChildren.push({
      tag: "inbox",
      attrs: {
        unread: unread.length,
        marked: marked.length,
      },
      comment: "收件箱：来自其他对象或系统的消息",
      children: inboxChildren,
    });
  }

  /* todos */
  if (ctx.todos.length > 0) {
    userChildren.push({
      tag: "todos",
      children: ctx.todos.map(t => ({ tag: "todo", content: t.content })),
    });
  }

  /* defer hooks：展示已注册的 command hooks，让 LLM 在决策前看到 */
  if (deferHooks && deferHooks.length > 0) {
    const onHooks = deferHooks.filter(h => h.event.startsWith("on:"));
    if (onHooks.length > 0) {
      userChildren.push({
        tag: "defers",
        comment: "defer 提醒：你之前注册的 command hook，对应 command 执行时请注意",
        children: onHooks.map(h => {
          const cmd = h.event.slice(3); /* 去掉 "on:" 前缀 */
          const attrs: Record<string, string | number> = { command: cmd };
          if (h.once === false) attrs.once = "false";
          return { tag: "defer", attrs, content: h.content };
        }),
      });
    }
  }

  /* 子节点摘要 */
  if (ctx.childrenSummary) {
    const allDone = ctx.childrenSummary.includes("[done]")
      && !ctx.childrenSummary.includes("[running]")
      && !ctx.childrenSummary.includes("[pending]")
      && !ctx.childrenSummary.includes("[waiting]");
    const comments: string[] = ["子线程：当前线程创建的子线程状态摘要"];
    if (allDone) comments.push("所有子线程已完成。请汇总子线程的结果，然后用 [return] 返回最终结果。");
    userChildren.push({
      tag: "children",
      content: ctx.childrenSummary,
      comment: comments.join(" / "),
    });
  }

  /* 祖先摘要 */
  if (ctx.ancestorSummary) {
    userChildren.push({ tag: "ancestors", content: ctx.ancestorSummary });
  }

  /* 兄弟摘要 */
  if (ctx.siblingSummary) {
    userChildren.push({ tag: "siblings", content: ctx.siblingSummary });
  }

  /* 通讯录 */
  if (ctx.directory.length > 0) {
    userChildren.push({
      tag: "directory",
      comment: "通讯录：可通过 talk 联系的对象",
      children: ctx.directory.map(d => ({
        tag: "object",
        attrs: { name: d.name },
        content: d.whoAmI,
      })),
    });
  }

  /* <relations> 索引（Phase 5 target 阶段）
   *
   * 仅列出本线程涉及的 peer 对象的一行式关系摘要。LLM 若需全文再
   * open(path="@relation:<peer>") 主动读。缺失 relation 文件的 peer 也会
   * 显示 "(无关系记录)"，让 LLM 感知"存在但未登记"的缺口。 */
  if (ctx.relations && ctx.relations.length > 0) {
    userChildren.push({
      tag: "relations",
      comment: "关系索引：本线程已涉及的对象的关系摘要（一行）；需全文用 open(path=\"@relation:<peer>\")",
      children: ctx.relations.map(r => ({
        tag: "peer",
        attrs: { name: r.name },
        content: r.summary,
      })),
    });
  }

  /* 沙箱路径 */
  if (ctx.paths && Object.keys(ctx.paths).length > 0) {
    userChildren.push({ tag: "paths", content: JSON.stringify(ctx.paths) });
  }

  /* 活跃 Form（Phase 3 — llm_input_viewer）
   *
   * 以前这里由 engine 在 contextToMessages 之后追加到 user message 末尾，
   * 从前端 DOMParser 的角度看它是 <user> 的兄弟节点；现在作为 <user> 的子节点
   * 序列化，语义更清晰、对 LLM 的可见性不变。 */
  if (activeForms && activeForms.length > 0) {
    userChildren.push({
      tag: "active-forms",
      comment: "活跃 Form：已 open 等待 submit 或 close",
      children: activeForms.map(f => {
        const attrs: Record<string, string | number> = {
          id: f.formId,
          command: f.command,
        };
        if (f.trait) attrs.trait = f.trait;
        return { tag: "form", attrs, content: f.description };
      }),
    });
  }

  /* 状态 */
  userChildren.push({ tag: "status", content: ctx.status });

  const userRoot: XmlNode = { tag: "user", children: userChildren };

  return [
    { role: "system", content: serializeXml([systemRoot], 0) },
    { role: "user", content: serializeXml([userRoot], 0) },
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
        const availableTools = buildAvailableTools(formManager.activeCommands());

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
              functionName: args.function_name as string,
            });
            /* Phase 4：按 commandPath 集合做冒泡前缀匹配（父 binding 命中子路径） */
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
            /* 累加真正"新加载"的 trait（changed=true 表示此次激活；false 表示本就在作用域内） */
            const newlyLoadedTraits: string[] = [];
            for (const traitName of traitsToLoad) {
              const changed = await tree.activateTrait(threadId, traitName);
              if (changed) newlyLoadedTraits.push(traitName);
            }
            if (command === "call_function" && args.trait) {
              const changed = await tree.activateTrait(threadId, args.trait as string);
              if (changed) newlyLoadedTraits.push(args.trait as string);
            }
            /* Phase 4：记录本 form 引入的 trait，供 submit(partial=false) / cancel 时回收 */
            formManager.addLoadedTraits(formId, newlyLoadedTraits);

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              /* 命令型 open 带入的 trait 是"临时生效"——submit/close 此 form 后会自动回收。
               * 若想保留某 trait 跨越 form 关闭，可以再 open(type="trait", name=X) 固定它。 */
              const loadHint = newlyLoadedTraits.length > 0
                ? `本次新加载 trait（临时生效，form 关闭即回收）：${newlyLoadedTraits.join(", ")}。如需保留某 trait，可 open(type="trait", name="...") 固定它`
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
                      content: `[refine via open] 预填参数已累积；当前路径：${refined.commandPath}。`,
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
              const pathHint = `当前路径：${updatedForm.commandPath}`;
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
            consola.info(`[Engine] refine: form=${formId} path=${updatedForm.commandPath}`);
          }
        }

        /* --- Submit --- */
        else if (toolName === "submit") {
          /* partial 已退役 → 引导改用 refine */
          if (args.partial === true) {
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({
                type: "inject",
                content: "[错误] submit(partial=true) 已退役。请改用 refine(form_id, args) 累积参数，最后 submit(form_id) 执行。",
                timestamp: Date.now(),
              });
              tree.writeThreadData(threadId, td);
            }
          } else {
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

            /* program */
            if (command === "program" && args.code) {
              const { context: execCtx, getOutputs, getWrittenPaths } = buildExecContext(threadId);
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
              /* build hook：program 内若 callMethod(file_ops.writeFile/editFile) 或 context.writeFile 触发过写入，
               * 在此扫描累计的 paths 跑 hooks，把失败结果注入下一轮 context。 */
              if (execResult.success) {
                const paths = getWrittenPaths();
                if (paths.length > 0) {
                  consola.info(`[build_hooks] program 结束，扫描写入路径 count=${paths.length} paths=${paths.join(",")}`);
                  try {
                    const feedback = await runBuildHooks(paths, { rootDir: config.rootDir, threadId });
                    const failing = feedback.filter((f) => !f.success);
                    if (failing.length > 0) {
                      const lines = [`[build_hooks] ${failing.length} 个检查未通过（下一轮 Context 的 <knowledge name="build_feedback"> 会展开）:`];
                      for (const f of failing) {
                        lines.push(`- [${f.hookName}] ${f.path}: ${(f.errors?.[0] ?? f.output).slice(0, 200)}`);
                      }
                      const td2 = tree.readThreadData(threadId);
                      if (td2) {
                        td2.actions.push({ type: "inject", content: lines.join("\n"), timestamp: Date.now() });
                        tree.writeThreadData(threadId, td2);
                      }
                    }
                  } catch (e) {
                    consola.warn(`[build_hooks] 执行异常: ${(e as Error).message}`);
                  }
                }
              }
              consola.info(`[Engine] program ${execResult.success ? "成功" : "失败"}`);
            }

            /* talk / talk_sync
             *
             * 统一协议：talk 指令通过 context=fork|continue + 可选 threadId 表达四种模式。
             * - fork + 无 threadId：对方新根线程（默认）
             * - fork + threadId：对方 threadId 下 fork 新子线程（新能力）
             * - continue + threadId：向对方 threadId 投递消息，唤醒对方（新能力）
             * - continue + 无 threadId：schema/engine 校验报错
             */
            else if ((command === "talk" || command === "talk_sync") && config.onTalk) {
              const target = (args.target as string)?.toLowerCase();
              if (target && target !== objectName.toLowerCase()) {
                /* 解析 context + threadId + msg（兼容 msg 与旧 message 参数） */
                const ctxMode = (args.context as string | undefined) === "continue" ? "continue" : "fork";
                const remoteThreadIdArg = args.threadId as string | undefined;
                const msgContent = (args.msg as string | undefined) ?? (args.message as string | undefined) ?? "";
                /* continue 必须指定 threadId */
                if (ctxMode === "continue" && !remoteThreadIdArg) {
                  const td = tree.readThreadData(threadId);
                  if (td) {
                    td.actions.push({ type: "inject", content: `[错误] talk(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() });
                    tree.writeThreadData(threadId, td);
                  }
                } else {
                  /* fork 模式下 threadId 作为 forkUnderThreadId（对方线程下 fork）；
                   * continue 模式下 threadId 作为 continueThreadId（向对方线程投递） */
                  const forkUnderThreadId = ctxMode === "fork" ? remoteThreadIdArg : undefined;
                  const continueThreadId = ctxMode === "continue" ? remoteThreadIdArg : undefined;
                  /* 先生成 messageId（供 action.id 和 onTalk 参数共用，前端凭此反查正文） */
                  const messageId = genMessageOutId();
                  /* 解析可选的结构化表单（talk form）——供前端渲染 option picker */
                  const formPayload = extractTalkForm(args.form);
                  const td = tree.readThreadData(threadId);
                  if (td) {
                    const modeLabel = ` [${ctxMode}${remoteThreadIdArg ? `:${remoteThreadIdArg}` : ""}]`;
                    const formLabel = formPayload ? ` [form: ${formPayload.formId}]` : "";
                    td.actions.push({
                      id: messageId,
                      type: "message_out",
                      content: `[talk] → ${args.target}: ${msgContent}${modeLabel}${formLabel}`,
                      timestamp: Date.now(),
                      context: ctxMode,
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
                  /* Phase 6：识别 talk.continue.relation_update —— 给接收方注入 kind 标签 */
                  const talkType = typeof args.type === "string" ? args.type : undefined;
                  const messageKind = ctxMode === "continue" && talkType === "relation_update"
                    ? "relation_update_request"
                    : undefined;
                  try {
                    const { reply, remoteThreadId } = await config.onTalk(args.target as string, msgContent, objectName, threadId, sessionId, continueThreadId, messageId, forkUnderThreadId, messageKind);
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

            /* think — 对自己的线程操作（fork / continue 四模式的自身半边） */
            else if (command === "think") {
              const ctxMode = (args.context as string | undefined) === "continue" ? "continue" : "fork";
              const targetThreadId = args.threadId as string | undefined;
              const msgContent = (args.msg as string | undefined) ?? "";

              if (ctxMode === "fork") {
                /* fork 模式：以 targetThreadId（或当前线程）为父，创建子线程
                 * 子线程标题 = tool call 的 title（天然同一语义；msg 作为描述/首条消息） */
                const subThreadName = (args.title as string | undefined) ?? (msgContent.slice(0, 40) || "thread");
                const parentId = targetThreadId ?? threadId;
                const parentNode = tree.getNode(parentId);
                if (!parentNode) {
                  const td = tree.readThreadData(threadId);
                  if (td) {
                    td.actions.push({ type: "inject", content: `[错误] think(fork): 指定的 threadId=${parentId} 不存在`, timestamp: Date.now() });
                    tree.writeThreadData(threadId, td);
                  }
                } else {
                  const child = await tree.createSubThread(parentId, subThreadName, {
                    description: msgContent || (args.description as string | undefined),
                    traits: args.traits as string[],
                  });
                  if (child) {
                    await tree.setNodeStatus(child, "running");
                    /* 把 msg 作为首条 inbox 注入，子线程首轮 Context 可见 */
                    if (msgContent) {
                      tree.writeInbox(child, { from: objectName, content: msgContent, source: "system" });
                    }
                    const td = tree.readThreadData(threadId);
                    if (td) {
                      td.actions.push({
                        type: "create_thread",
                        content: `[think.fork] ${subThreadName} → ${child}${targetThreadId ? ` (under ${targetThreadId})` : ""}`,
                        timestamp: Date.now(),
                        context: "fork",
                      });
                      td.actions.push({
                        type: "inject",
                        content: `[form.submit] think(fork) 成功，thread_id = ${child}`,
                        timestamp: Date.now(),
                      });
                      tree.writeThreadData(threadId, td);
                    }
                    scheduler.onThreadCreated(child, objectName);
                  }
                  consola.info(`[Engine] think.fork: ${subThreadName} → ${child}`);
                }
              } else {
                /* continue 模式：必须指定 threadId，向它的 inbox 投递消息 */
                if (!targetThreadId) {
                  const td = tree.readThreadData(threadId);
                  if (td) {
                    td.actions.push({ type: "inject", content: `[错误] think(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() });
                    tree.writeThreadData(threadId, td);
                  }
                } else {
                  tree.writeInbox(targetThreadId, { from: objectName, content: msgContent, source: "continue" });
                  const td = tree.readThreadData(threadId);
                  if (td) {
                    td.actions.push({
                      type: "message_out",
                      content: `[think.continue] → ${targetThreadId}: ${msgContent}`,
                      timestamp: Date.now(),
                      context: "continue",
                    });
                    tree.writeThreadData(threadId, td);
                  }
                  consola.info(`[Engine] think.continue: → ${targetThreadId}`);
                }
              }
            }

            /* call_function
             *
             * 统一协议：llm_methods 签名为 `(ctx, argsObj)` 对象解构，与沙箱 callMethod
             * 完全一致。engine 把 LLM 传来的 args.args 作为整体对象传给 fn，**不再按
             * params 列表展开为位置参数**（旧做法与新 trait 不匹配）。
             *
             * 兼容：若 LLM 传入数组 args（极少见）→ 走位置参数展开，保留向后兼容空间。
             */
            else if (command === "call_function") {
              /* call_function 协议：trait + function_name 应当在 open 时传入；
               * 兜底 1：从 submit 的 args.trait / args.function_name 补填
               * 兜底 2：缺失时 inject 明确错误（避免静默跳过让 LLM 误以为成功）。
               * 与 resume 路径保持双路径行为一致。 */
              const trait = form.trait ?? (args.trait as string | undefined);
              const functionName = form.functionName ?? (args.function_name as string | undefined);
              if (!trait || !functionName) {
                const td = tree.readThreadData(threadId);
                if (td) {
                  td.actions.push({
                    type: "inject",
                    content: `[错误] call_function 缺少 trait 或 function_name 参数。\n请在 open 时传：open({ type: "command", command: "call_function", trait: "<完整 traitId 如 kernel:reflective/super>", function_name: "<方法名>" })`,
                    timestamp: Date.now(),
                  });
                  tree.writeThreadData(threadId, td);
                }
                consola.warn(`[Engine] call_function 缺参数 (run): trait=${trait} fn=${functionName}`);
              } else {
                const method = methodRegistry.all().find(m => m.name === functionName && m.traitName === trait);
                let resultText: string;
                if (!method) {
                  resultText = `[错误] 方法 ${trait}.${functionName} 不存在`;
                } else {
                  try {
                    const { context: execCtx } = buildExecContext(threadId);
                    const rawArgs = args.args;
                    const isPositionalArray = Array.isArray(rawArgs);
                    const isObjectArgs = rawArgs !== null && typeof rawArgs === "object" && !isPositionalArray;
                    const argsObj: Record<string, unknown> = isObjectArgs
                      ? (rawArgs as Record<string, unknown>)
                      : {};
                    let result: unknown;
                    if (isPositionalArray) {
                      /* 旧位置参数兜底：args 是数组时按顺序展开 */
                      const argValues = rawArgs as unknown[];
                      result = method.needsCtx !== false
                        ? await method.fn(execCtx, ...argValues)
                        : await method.fn(...argValues);
                    } else {
                      /* 新协议：整个对象作为单一参数 */
                      result = method.needsCtx !== false
                        ? await method.fn(execCtx, argsObj)
                        : await method.fn(argsObj);
                    }
                    resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
                  } catch (e) {
                    resultText = `[错误] ${trait}.${functionName} 执行失败: ${(e as Error).message}`;
                  }
                }
                const td = tree.readThreadData(threadId);
                if (td) {
                  td.actions.push({ type: "inject", content: `>>> ${trait}.${functionName} 结果:\n${resultText}`, timestamp: Date.now() });
                  tree.writeThreadData(threadId, td);
                }
                /* build hook：file_ops 写文件动作完成后自动触发（tsc/lint/json-syntax 等） */
                const hookInject = await triggerBuildHooksAfterCall({
                  trait,
                  functionName,
                  args: args.args,
                  rootDir: config.rootDir,
                  threadId,
                });
                if (hookInject) {
                  const td2 = tree.readThreadData(threadId);
                  if (td2) {
                    td2.actions.push({ type: "inject", content: hookInject, timestamp: Date.now() });
                    tree.writeThreadData(threadId, td2);
                  }
                }
                consola.info(`[Engine] call_function: ${trait}.${functionName}`);
              }
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

            /* compact —— 一次性应用所有累积的 truncate/drop 标记 + 插入 compact_summary
             *
             * args.summary 必填——LLM 给出的"此前工作浓缩摘要"。
             * engine 读 threadData.compactMarks 应用到 actions，插入 compact_summary 作为首条，
             * 清空 compactMarks。trait 的激活状态由本分支底下的"trait 卸载"块统一处理。 */
            else if (command === "compact") {
              const summary = typeof args.summary === "string" ? args.summary.trim() : "";
              const td = tree.readThreadData(threadId);
              if (!td) {
                consola.warn(`[Engine] compact: 读取 thread.json 失败 thread=${threadId}`);
              } else if (summary.length === 0) {
                td.actions.push({
                  type: "inject",
                  content: `[错误] submit compact 必须带 summary 参数（LLM 生成的浓缩摘要纯文本）。本次压缩未执行。`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, td);
              } else {
                const marks = td.compactMarks ?? {};
                const before = estimateActionsTokens(td.actions);
                const newActions = applyCompact(td.actions, marks, summary);
                const after = estimateActionsTokens(newActions);
                const dropCount = marks.drops?.length ?? 0;
                const truncateCount = marks.truncates?.length ?? 0;
                const summaryAction = newActions[0]!;

                /* 原子应用：替换 actions + 清空 compactMarks */
                const nextTd: ThreadDataFile = {
                  ...td,
                  actions: newActions,
                  compactMarks: undefined,
                };
                /* 在 compact_summary 之后 append 一条 inject 告诉 LLM 压缩结果
                 * （这条 inject 是新一轮的起点，不会被当前压缩影响） */
                nextTd.actions.push({
                  type: "inject",
                  content:
                    `>>> [compact 完成] drop=${dropCount} truncate=${truncateCount}; ` +
                    `tokens ${before} → ${after}（节省 ${before - after}）。\n` +
                    `compact_summary 已作为首条历史背景注入，后续工作继续。`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, nextTd);
                consola.info(`[Engine] compact: tokens ${before} → ${after} drop=${dropCount} truncate=${truncateCount} kept=${summaryAction.kept}`);
              }
            }

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
          } /* end of non-partial branch */
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
                /* 当前仍需被其他 active form 的 commandPath 集合所需 → 不卸 */
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
              //       但 always trait 本身豁免，只做 unpin 语义（实际 when=always 不会被 unpin 影响）。
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
              const parts: string[] = [];
              if (unloadedTraits.length > 0) parts.push(`本次卸载 trait：${unloadedTraits.join(", ")}`);
              if (keptPinnedTraits.length > 0) parts.push(`已固定 trait 保留未卸载：${keptPinnedTraits.join(", ")}`);
              if (parts.length === 0) parts.push(`无 trait 被卸载（可能仍被其他 active form 占用）`);
              td.actions.push({
                type: "inject",
                content: `Form ${form.formId} 已关闭。${parts.join("；")}。`,
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
        const availableTools = buildAvailableTools(formManager.activeCommands());

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
              trait: args.trait as string, functionName: args.function_name as string,
            });
            /* Phase 4：按 commandPath 冒泡前缀匹配 */
            const traitsToLoad = collectCommandTraits(config.traits, formManager.activeCommandPaths());
            const newlyLoadedTraits: string[] = [];
            for (const traitName of traitsToLoad) {
              const changed = await tree.activateTrait(threadId, traitName);
              if (changed) newlyLoadedTraits.push(traitName);
            }
            if (command === "call_function" && args.trait) {
              const changed = await tree.activateTrait(threadId, args.trait as string);
              if (changed) newlyLoadedTraits.push(args.trait as string);
            }
            formManager.addLoadedTraits(formId, newlyLoadedTraits);

            const td = tree.readThreadData(threadId);
            if (td) {
              td.activeForms = formManager.toData();
              const loadHint = newlyLoadedTraits.length > 0
                ? `本次新加载 trait（临时生效，form 关闭即回收）：${newlyLoadedTraits.join(", ")}。如需保留某 trait，可 open(type="trait", name="...") 固定它`
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
                      content: `[refine via open] 预填参数已累积；当前路径：${refined.commandPath}。`,
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
              const pathHint = `当前路径：${updatedForm.commandPath}`;
              const loadHint = newlyLoadedTraits.length > 0 ? `按新路径追加 trait：${newlyLoadedTraits.join(", ")}` : `按新路径无新增 trait`;
              td.actions.push({ type: "inject", content: `[refine] Form ${formId} 已累积参数（未执行）。${pathHint}。${loadHint}。可继续 refine，或 submit() 执行指令。`, timestamp: Date.now() });
              tree.writeThreadData(threadId, td);
            }
            consola.info(`[Engine] refine(resume): form=${formId} path=${updatedForm.commandPath}`);
          }

        /* --- Submit (resume) --- */
        } else if (toolName === "submit") {
          /* partial 已退役 → 引导改用 refine */
          if (args.partial === true) {
            const td = tree.readThreadData(threadId);
            if (td) {
              td.actions.push({
                type: "inject",
                content: "[错误] submit(partial=true) 已退役。请改用 refine(form_id, args) 累积参数，最后 submit(form_id) 执行。",
                timestamp: Date.now(),
              });
              tree.writeThreadData(threadId, td);
            }
          } else {
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
            if (command === "program" && args.code) {
              const { context: execCtx, getOutputs, getWrittenPaths } = buildExecContext(threadId);
              const lang = (args.lang as string) ?? "javascript";
              const execResult = lang === "shell" ? await executeShell(args.code as string, config.rootDir) : await executor.execute(args.code as string, execCtx);
              const allOutputs = [...getOutputs()]; if (execResult.stdout) allOutputs.push(execResult.stdout);
              if (execResult.returnValue != null) allOutputs.push(typeof execResult.returnValue === "string" ? execResult.returnValue : JSON.stringify(execResult.returnValue, null, 2));
              const outputText = allOutputs.join("\n").trim();
              const td = tree.readThreadData(threadId);
              if (td) { td.actions.push({ type: "program", content: args.code as string, success: execResult.success, result: execResult.success ? (outputText ? `>>> output:\n${outputText}` : ">>> output: (无输出)") : `>>> error: ${execResult.error}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              /* build hook：resume 路径同 run 路径，program 写入路径累计后触发 hooks */
              if (execResult.success) {
                const paths = getWrittenPaths();
                if (paths.length > 0) {
                  consola.info(`[build_hooks] program(resume) 结束，扫描写入路径 count=${paths.length} paths=${paths.join(",")}`);
                  try {
                    const feedback = await runBuildHooks(paths, { rootDir: config.rootDir, threadId });
                    const failing = feedback.filter((f) => !f.success);
                    if (failing.length > 0) {
                      const lines = [`[build_hooks] ${failing.length} 个检查未通过（下一轮 Context 的 <knowledge name="build_feedback"> 会展开）:`];
                      for (const f of failing) {
                        lines.push(`- [${f.hookName}] ${f.path}: ${(f.errors?.[0] ?? f.output).slice(0, 200)}`);
                      }
                      const td2 = tree.readThreadData(threadId);
                      if (td2) {
                        td2.actions.push({ type: "inject", content: lines.join("\n"), timestamp: Date.now() });
                        tree.writeThreadData(threadId, td2);
                      }
                    }
                  } catch (e) {
                    consola.warn(`[build_hooks] 执行异常: ${(e as Error).message}`);
                  }
                }
              }
            } else if ((command === "talk" || command === "talk_sync") && config.onTalk) {
              /* resume 路径的 talk：与 run 路径保持同一 schema 协议（think/talk 统一 context）。 */
              const target = (args.target as string)?.toLowerCase();
              if (target && target !== objectName.toLowerCase()) {
                const ctxMode = (args.context as string | undefined) === "continue" ? "continue" : "fork";
                const remoteThreadIdArg = args.threadId as string | undefined;
                const msgContent = (args.msg as string | undefined) ?? (args.message as string | undefined) ?? "";
                if (ctxMode === "continue" && !remoteThreadIdArg) {
                  const td = tree.readThreadData(threadId);
                  if (td) { td.actions.push({ type: "inject", content: `[错误] talk(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
                } else {
                  const forkUnderThreadId = ctxMode === "fork" ? remoteThreadIdArg : undefined;
                  const continueThreadId = ctxMode === "continue" ? remoteThreadIdArg : undefined;
                  const messageId = genMessageOutId();
                  const formPayload = extractTalkForm(args.form);
                  const td = tree.readThreadData(threadId);
                  if (td) {
                    const modeLabel = ` [${ctxMode}${remoteThreadIdArg ? `:${remoteThreadIdArg}` : ""}]`;
                    const formLabel = formPayload ? ` [form: ${formPayload.formId}]` : "";
                    td.actions.push({
                      id: messageId,
                      type: "message_out",
                      content: `[talk] → ${args.target}: ${msgContent}${modeLabel}${formLabel}`,
                      timestamp: Date.now(),
                      context: ctxMode,
                      ...(formPayload ? { form: formPayload } : {}),
                    });
                    tree.writeThreadData(threadId, td);
                  }
                  const isTalkSyncToUser = command === "talk_sync" && target === "user";
                  if (isTalkSyncToUser) {
                    consola.warn(`[Engine] ${objectName} 尝试 talk_sync(target="user")——user 不参与 ThinkLoop，不会回复。已降级为 talk（不阻塞）。`);
                  }
                  const explicitlyMarked = Array.isArray(args.mark) && args.mark.length > 0;
                  /* Phase 6：识别 talk.continue.relation_update */
                  const talkType = typeof args.type === "string" ? args.type : undefined;
                  const messageKind = ctxMode === "continue" && talkType === "relation_update"
                    ? "relation_update_request"
                    : undefined;
                  try {
                    const { reply, remoteThreadId } = await config.onTalk(args.target as string, msgContent, objectName, threadId, sessionId, continueThreadId, messageId, forkUnderThreadId, messageKind);
                    if (!explicitlyMarked) {
                      const tdAck = tree.readThreadData(threadId);
                      const autoAckId = getAutoAckMessageId(tdAck, args.target as string);
                      if (autoAckId) tree.markInbox(threadId, autoAckId, "ack", "已回复");
                    }
                    if (reply) {
                      tree.writeInbox(threadId, { from: args.target as string, content: `${reply}\n[remote_thread_id: ${remoteThreadId}]`, source: "talk" });
                    }
                    const td2 = tree.readThreadData(threadId);
                    if (td2) {
                      td2.actions.push({ type: "inject", content: `[talk → ${args.target}] remote_thread_id = ${remoteThreadId}`, timestamp: Date.now() });
                      tree.writeThreadData(threadId, td2);
                    }
                  } catch (e) { tree.writeInbox(threadId, { from: "system", content: `[talk 失败] ${(e as Error).message}`, source: "system" }); }
                  if (command === "talk_sync" && !isTalkSyncToUser) tree.setNodeStatus(threadId, "waiting");
                }
              }
            } else if (command === "return") {
              /* 与 run 路径对齐：用 tree.returnThread（自动设 done + 写 summary + 唤醒等待的父线程）。
               * 历史 bug：旧 resume 这里调了不存在的 scheduler.markDone() 导致抛错——已修复。 */
              await tree.returnThread(threadId, args.summary as string ?? "");
              const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "thread_return", content: args.summary as string ?? "", timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
              consola.info(`[Engine] return (resume): ${(args.summary as string)?.slice(0, 100)}`);
            } else if (command === "think") {
              /* resume 路径的 think：与 run 路径语义完全对齐 */
              const ctxMode = (args.context as string | undefined) === "continue" ? "continue" : "fork";
              const targetThreadId = args.threadId as string | undefined;
              const msgContent = (args.msg as string | undefined) ?? "";
              if (ctxMode === "fork") {
                const subThreadName = (args.title as string | undefined) ?? (msgContent.slice(0, 40) || "thread");
                const parentId = targetThreadId ?? threadId;
                const parentNode = tree.getNode(parentId);
                if (!parentNode) {
                  const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `[错误] think(fork): 指定的 threadId=${parentId} 不存在`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
                } else {
                  const child = await tree.createSubThread(parentId, subThreadName, {
                    description: msgContent || (args.description as string | undefined),
                    traits: args.traits as string[],
                  });
                  if (child) {
                    await tree.setNodeStatus(child, "running");
                    if (msgContent) tree.writeInbox(child, { from: objectName, content: msgContent, source: "system" });
                    const td = tree.readThreadData(threadId);
                    if (td) {
                      td.actions.push({ type: "create_thread", content: `[think.fork] ${subThreadName} → ${child}${targetThreadId ? ` (under ${targetThreadId})` : ""}`, timestamp: Date.now(), context: "fork" });
                      td.actions.push({ type: "inject", content: `[form.submit] think(fork) 成功，thread_id = ${child}`, timestamp: Date.now() });
                      tree.writeThreadData(threadId, td);
                    }
                    scheduler.onThreadCreated(child, objectName);
                  }
                }
              } else {
                if (!targetThreadId) {
                  const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `[错误] think(context="continue") 必须同时指定 threadId 参数`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
                } else {
                  tree.writeInbox(targetThreadId, { from: objectName, content: msgContent, source: "continue" });
                  const td = tree.readThreadData(threadId);
                  if (td) { td.actions.push({ type: "message_out", content: `[think.continue] → ${targetThreadId}: ${msgContent}`, timestamp: Date.now(), context: "continue" }); tree.writeThreadData(threadId, td); }
                }
              }
            } else if (command === "call_function") {
              /* call_function 协议：trait + function_name 应当在 open 时传入；
               * 兜底 1：从 submit 的 args.trait / args.function_name 补填
               * 兜底 2：缺失时 inject 明确错误（之前是静默跳过，会让 LLM 误以为成功）
               * 与 run 路径对齐——保持双路径行为一致。 */
              const trait = form.trait ?? (args.trait as string | undefined);
              const functionName = form.functionName ?? (args.function_name as string | undefined);
              if (!trait || !functionName) {
                const td = tree.readThreadData(threadId);
                if (td) {
                  td.actions.push({
                    type: "inject",
                    content: `[错误] call_function 缺少 trait 或 function_name 参数。\n请在 open 时传：open({ type: "command", command: "call_function", trait: "<完整 traitId 如 kernel:reflective/super>", function_name: "<方法名>" })`,
                    timestamp: Date.now(),
                  });
                  tree.writeThreadData(threadId, td);
                }
                consola.warn(`[Engine] call_function 缺参数 (resume): trait=${trait} fn=${functionName}`);
              } else {
              /* resume 路径：与第一次执行保持同一协议——argsObj 整体作为第二参数传入 */
              const method = methodRegistry.all().find(m => m.name === functionName && m.traitName === trait);
              let resultText: string;
              if (!method) {
                resultText = `[错误] 方法 ${trait}.${functionName} 不存在`;
              } else {
                try {
                  const { context: execCtx } = buildExecContext(threadId);
                  const rawArgs = args.args;
                  const isPositionalArray = Array.isArray(rawArgs);
                  const isObjectArgs = rawArgs !== null && typeof rawArgs === "object" && !isPositionalArray;
                  const argsObj: Record<string, unknown> = isObjectArgs
                    ? (rawArgs as Record<string, unknown>)
                    : {};
                  let result: unknown;
                  if (isPositionalArray) {
                    const argValues = rawArgs as unknown[];
                    result = method.needsCtx !== false
                      ? await method.fn(execCtx, ...argValues)
                      : await method.fn(...argValues);
                  } else {
                    result = method.needsCtx !== false
                      ? await method.fn(execCtx, argsObj)
                      : await method.fn(argsObj);
                  }
                  resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
                } catch (e) {
                  resultText = `[错误] ${(e as Error).message}`;
                }
              }
              const td = tree.readThreadData(threadId);
              if (td) {
                td.actions.push({ type: "inject", content: `>>> ${trait}.${functionName} 结果:\n${resultText}`, timestamp: Date.now() });
                tree.writeThreadData(threadId, td);
              }
              /* build hook（resume 路径）：file_ops 写文件动作完成后自动触发 */
              const hookInjectResume = await triggerBuildHooksAfterCall({
                trait,
                functionName,
                args: args.args,
                rootDir: config.rootDir,
                threadId,
              });
              if (hookInjectResume) {
                const td2 = tree.readThreadData(threadId);
                if (td2) {
                  td2.actions.push({ type: "inject", content: hookInjectResume, timestamp: Date.now() });
                  tree.writeThreadData(threadId, td2);
                }
              }
              }  /* end of "if (trait && functionName)" else-branch */
            } else if (command === "set_plan") {
              const td = tree.readThreadData(threadId); if (td) { td.plan = args.text as string; td.actions.push({ type: "set_plan", content: args.text as string, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            } else if (command === "await" || command === "await_all") {
              const threadIds = command === "await" ? [args.thread_id as string] : (args.thread_ids as string[]) ?? [];
              await tree.awaitThreads(threadId, threadIds);
              const ids = threadIds.join(", ");
              const td = tree.readThreadData(threadId); if (td) { td.actions.push({ type: "inject", content: `[${command}] ${ids}`, timestamp: Date.now() }); tree.writeThreadData(threadId, td); }
            }
            /* compact (resume 路径，与 run 路径同义) */
            else if (command === "compact") {
              const summary = typeof args.summary === "string" ? args.summary.trim() : "";
              const td = tree.readThreadData(threadId);
              if (!td) {
                consola.warn(`[Engine] compact (resume): 读取 thread.json 失败 thread=${threadId}`);
              } else if (summary.length === 0) {
                td.actions.push({
                  type: "inject",
                  content: `[错误] submit compact 必须带 summary 参数。本次压缩未执行。`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, td);
              } else {
                const marks = td.compactMarks ?? {};
                const before = estimateActionsTokens(td.actions);
                const newActions = applyCompact(td.actions, marks, summary);
                const after = estimateActionsTokens(newActions);
                const dropCount = marks.drops?.length ?? 0;
                const truncateCount = marks.truncates?.length ?? 0;
                const nextTd: ThreadDataFile = { ...td, actions: newActions, compactMarks: undefined };
                nextTd.actions.push({
                  type: "inject",
                  content:
                    `>>> [compact 完成] drop=${dropCount} truncate=${truncateCount}; ` +
                    `tokens ${before} → ${after}（节省 ${before - after}）。`,
                  timestamp: Date.now(),
                });
                tree.writeThreadData(threadId, nextTd);
                consola.info(`[Engine] compact (resume): tokens ${before} → ${after}`);
              }
            }
            if (command !== "_trait" && command !== "_skill") {
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
            }
            const tdAfter = tree.readThreadData(threadId); if (tdAfter) { tdAfter.activeForms = formManager.toData(); tree.writeThreadData(threadId, tdAfter); }
            consola.info(`[Engine] form.submit: ${command} (${form.formId})`);
          }
          } /* end of non-partial branch (resume) */

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
               * always trait 豁免 deactivate（when=always 本就不应被回收）。 */
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
              const parts: string[] = [];
              if (unloadedTraits.length > 0) parts.push(`本次卸载 trait：${unloadedTraits.join(", ")}`);
              if (keptPinnedTraits.length > 0) parts.push(`已固定 trait 保留未卸载：${keptPinnedTraits.join(", ")}`);
              if (parts.length === 0) parts.push(`无 trait 被卸载（可能仍被其他 active form 占用）`);
              td.actions.push({
                type: "inject",
                content: `Form ${form.formId} 已关闭。${parts.join("；")}。`,
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
 * 运行一轮 super 线程 ThinkLoop（跨 session 常驻线程的执行入口）
 *
 * super 线程落盘在 `stones/{name}/super/`（非 `flows/{sid}/objects/{name}`），
 * 跨 session 常驻。本函数复用 `resumeWithThreadTree` 的整套 scheduler 管线——
 * 通过 `objectFlowDirOverride` 把 super 目录作为 engine 的工作目录。
 *
 * 为什么复用 resume 而非 run：
 * - super 线程在首次 `handleOnTalkToSuper` 时已经创建 root 线程并写了 inbox
 * - runWithThreadTree 假设"一次 talk 触发一次 run"——会额外写入 incoming message
 * - resumeWithThreadTree 的模型是"拿已有 tree 跑 scheduler"，正符合 super 场景
 *
 * sessionId 传 `super:{stoneName}`——虚拟标签，不对应物理 flows 目录。
 * 仅用于 SSE 事件 / 日志 / onTalk 回调透传。engine 内部不会因此创建新文件。
 *
 * 执行语义：
 * 1. 加载 super 目录的 ThreadsTree
 * 2. 所有 status=running 的线程由 scheduler 并发拉起（复活回调已在 resume 里注入）
 * 3. LLM 消费 inbox、调用 `persist_to_memory` / `create_trait`、mark 掉 unread
 * 4. root 线程完成后返回 done/waiting（scheduler 根据 inbox/子线程状态决定）
 * 5. 下次 tick 时 super-scheduler 检测是否还有 unread，有就再跑一轮
 *
 * 错误处理：engine 内部的异常由 scheduler 捕获并写入 inbox（with from=system）。
 * 本函数只传播"无法加载 tree"这一启动级错误。
 *
 * @param stoneName super 所属的 stone 名
 * @param superDir super 目录绝对路径（由 `getSuperThreadDir` 计算）
 * @param config engine 配置（由 World 层构建，traits 含 `reflective/super` 等）
 */
export async function runSuperThread(
  stoneName: string,
  superDir: string,
  config: EngineConfig,
): Promise<TalkResult> {
  /* 虚拟 sessionId：仅用于日志 / SSE / onTalk 透传，不对应物理 flows/ 目录 */
  const virtualSessionId = `super:${stoneName}`;

  consola.info(`[Engine] 启动 super 线程 ${stoneName} (dir=${superDir})`);

  /* 关键：super 线程必须激活 `kernel:reflective/super` trait，否则：
   * 1. LLM 不知道自己处于"反思角色"——会按普通对象的 readme 思考（错位）
   * 2. `persist_to_memory` / `create_trait` 方法 trait 的 `when: never`，
   *    不激活就不会出现在沙箱 callMethod 列表里——LLM 无法调用沉淀工具
   *
   * 做法：load tree → 在 root 线程的 activatedTraits 注入 `kernel:reflective/super`
   * （tree.activateTrait 内部幂等，已激活则 noop）。 */
  const tree = ThreadsTree.load(superDir);
  if (!tree) {
    throw new Error(`无法加载 super 线程树: ${superDir}`);
  }
  await tree.activateTrait(tree.rootId, "kernel:reflective/super");

  /* 注入 super 角色 prompt 到 extraWindows——LLM 在 Context 看到「我是 X 的 super 镜像分身」
   *
   * 含完整 open + submit 的工具调用示例——call_function 的 open 必须传 trait
   * 和 function_name 两个参数，缺失会导致 submit 时 engine 报错（这是常见陷阱）。 */
  const superPromptWindow: ContextWindow = {
    name: "super_role",
    content: [
      `你现在处于 **${stoneName}:super 线程**——你是 ${stoneName} 的反思镜像分身（super-ego）。`,
      "",
      "你的职责：消化 inbox 中的经验候选条目，决定哪些值得**沉淀**到长期记忆。",
      "",
      "## 可用沉淀工具（已自动加载 `kernel:reflective/super` trait）",
      "",
      "- `persist_to_memory({ key, content })` — 追加经验到 `stones/{name}/memory.md`（长期记忆）",
      "- `create_trait({ relativePath, content })` — 固化「做法」为新 trait（可选，更重的沉淀）",
      "",
      "## 典型工作流程（每条 unread inbox 消息）",
      "",
      "1. 读 inbox 消息（来自主线程的「经验候选」）",
      "2. 判断是否值得沉淀（重复/琐碎的就 mark 为 ignore）",
      "3. 值得沉淀 → open + submit call_function 调 `persist_to_memory`",
      "4. 用 mark 把消息状态从 unread 改为 ack（type: ack, tip: 已沉淀/已忽略）",
      "5. 没有更多消息要处理时 → open + submit `return` 结束本轮",
      "   （线程进入 done，下次有新消息会自动复活）",
      "",
      "## 完整工具调用示例（最关键！）",
      "",
      "**第一步：open 必须传 `trait` + `function_name` 两个参数**：",
      "```json",
      "open({",
      '  "type": "command",',
      '  "command": "call_function",',
      '  "trait": "kernel:reflective/super",   // <-- 必传，完整 traitId',
      '  "function_name": "persist_to_memory", // <-- 必传',
      '  "description": "沉淀经验到 memory.md"',
      "})",
      "```",
      "",
      "**第二步：submit 时在 `args` 字段下传方法参数**：",
      "```json",
      "submit({",
      '  "form_id": "f_xxx",                   // 从 open 返回',
      '  "args": {                              // <-- 方法参数整体放这里',
      '    "key": "线程树的认知透明度价值",',
      '    "content": "完整经验描述..."',
      '  },',
      '  "mark": [{ "messageId": "msg_xxx", "type": "ack", "tip": "已沉淀" }]',
      "})",
      "```",
      "",
      "**常见错误**：open 只传 `description` 但漏了 `trait` / `function_name`——",
      "engine 会报错 \"call_function 缺少 trait 或 function_name 参数\"。",
      "",
      `## 边界提醒：你不是普通的 ${stoneName}`,
      "",
      "- 不要去执行任务、不要去查文档资料、不要去回答用户",
      "- 你只做一件事：消化 inbox + 选择性沉淀",
      "- 所有外部工作由主线程完成——super 是内省分身",
    ].join("\n"),
  };

  const augmentedConfig: EngineConfig = {
    ...config,
    extraWindows: [
      ...(config.extraWindows ?? []),
      superPromptWindow,
    ],
  };

  /* 复用 resume 路径——关键是把 objectFlowDir 指向 super 目录而非 flows/ */
  return resumeWithThreadTree(
    stoneName,
    virtualSessionId,
    augmentedConfig,
    /* modifiedOutput */ undefined,
    /* objectFlowDirOverride */ superDir,
  );
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
