/**
 * ThinkLoop —— 思考-执行循环 (G4/G13)
 *
 * 核心循环：思考 → 输出程序 → 执行 → 反馈 → 再思考。
 * 这是 OOC 中 Flow 「做事情」的引擎。
 * G13: 认知栈 — create_plan_node/finish_plan_node 管理计划节点，
 *      作用域链驱动 trait 激活，before/after hooks。
 *
 * @ref docs/哲学文档/gene.md#G4 — implements — ThinkLoop 思考-执行循环（提取程序、沙箱执行、反馈）
 * @ref docs/哲学文档/gene.md#G5 — implements — 每轮构建 Context 作为 LLM 输入
 * @ref docs/哲学文档/gene.md#G8 — implements — 协作 API 注入（talk, talkToSelf）
 * @ref docs/哲学文档/gene.md#G9 — implements — 行为树 API 注入（createPlan, create_plan_node, finish_plan_node, moveFocus）
 * @ref docs/哲学文档/gene.md#G10 — implements — recordAction 记录 thought/program 事件
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 元编程 API（readTrait, listTraits, activateTrait, reloadTrait）
 * @ref docs/哲学文档/gene.md#G13 — implements — 认知栈 create_plan_node/finish_plan_node + before/after hooks
 * @ref src/flow/flow.ts — references — Flow 实例操作
 * @ref src/flow/parser.ts — references — extractPrograms, detectDirectives
 * @ref src/context/builder.ts — references — buildContext 构建上下文
 * @ref src/context/formatter.ts — references — formatContextAsSystem, formatContextAsMessages
 * @ref src/executable/executor.ts — references — CodeExecutor 沙箱执行
 * @ref src/process/tree.ts — references — 行为树节点操作
 * @ref src/process/focus.ts — references — getFocusNode, getPathToNode
 * @ref src/process/cognitive-stack.ts — references — computeScopeChain, collectFrameHooks
 * @ref src/trait/registry.ts — references — MethodRegistry 方法注册
 * @ref src/world/router.ts — references — CollaborationAPI 协作接口
 */

import { consola } from "consola";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import matter from "gray-matter";
import { Flow } from "./flow.js";
import { createLLMOutputStreamParser, parseLLMOutput } from "./parser.js";
import type { LLMOutputStreamEvent } from "./parser.js";
import type { ExtractedTalk, ExtractedAction } from "./parser.js";
import { emitSSE } from "../server/events.js";
import { buildContext } from "../context/builder.js";
import { loadFlowSummaries } from "../context/history.js";
import { formatContextAsSystem, formatContextAsMessages } from "../context/formatter.js";
import { CodeExecutor, executeShell } from "../executable/executor.js";
import { EffectTracker } from "../executable/effects.js";
import { MethodRegistry, type MethodContext } from "../trait/registry.js";
import {
  addNode, completeNode as completeProcessNode,
  moveFocus as moveProcessFocus, advanceFocus, isProcessComplete,
  removeNode as removeProcessNode, editNode as editProcessNode,
  getFocusNode, getPathToNode, findNode, getParentNode,
  addTodo as addProcessTodo, insertTodo as insertProcessTodo,
  removeTodo as removeProcessTodo, getTodo as getProcessTodo, popTodo,
  interruptForMessage,
  computeScopeChain, collectFrameHooks, collectFrameNodeHooks,
  compressActions, createFrameHook,
  createThread, goThread, sendSignal, ackSignal,
} from "../process/index.js";
import type { CollaborationAPI } from "../world/router.js";
import type { CronManager } from "../world/cron.js";
import { detectProtocolMarkers } from "../thinkable/client.js";
import type { LLMClient, LLMStreamEvent, Message, SimpleLLMOptions } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, TraitHookEvent, HookTime, HookType, ProcessNode, Action } from "../types/index.js";
import { getActiveTraits, traitId } from "../trait/activator.js";
import { loadTrait } from "../trait/loader.js";

/** ThinkLoop 配置 */
export interface ThinkLoopConfig {
  /** 最大思考轮次（防止无限循环） */
  maxIterations: number;
  /** 暂停检查回调（由 World 注入，检查对象是否被用户暂停） */
  isPaused?: () => boolean;
  /** 是否发射 flow:progress 事件（默认 true，Scheduler 模式下传 false 避免重复） */
  emitProgress?: boolean;
  /** 并发线程 ID — 指定后使用该线程的 focusId 而非 process.focusId */
  threadId?: string;
}

/** ThinkLoop 默认配置 */
const DEFAULT_CONFIG: ThinkLoopConfig = {
  maxIterations: 1000,
};

function previewDebugText(content: string, max = 80): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

/**
 * 检测文本是否疑似乱码（非中英文/代码字符占比超过阈值）
 *
 * LLM 在 context 过载时可能输出 token 乱码，需要及时检测并终止循环。
 */
function isGarbled(text: string, threshold = 0.3): boolean {
  if (!text || text.length < 20) return false;
  /* 匹配中文、英文、数字、常见标点、代码符号 */
  const validChars = text.match(/[\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9\s.,;:!?'"()\[\]{}<>\/\\@#$%^&*+=\-_`~|。，；：！？、""''（）【】《》\n\r\t]/g);
  const validRatio = (validChars?.length ?? 0) / text.length;
  return validRatio < (1 - threshold);
}

/**
 * 运行 ThinkLoop（增强版，集成 Trait + 协作 + 元编程系统）
 *
 * @param flow - 要执行的 Flow
 * @param stone - Flow 所属的 Stone 数据
 * @param stoneDir - Stone 的持久化目录路径
 * @param llm - LLM 客户端
 * @param directory - 系统通讯录
 * @param traits - 已加载的所有 Trait
 * @param config - 循环配置
 * @param collaboration - 跨对象协作 API（Phase 4，可选）
 */
export async function runThinkLoop(
  flow: Flow,
  stone: StoneData,
  stoneDir: string,
  llm: LLMClient,
  directory: DirectoryEntry[],
  traits: TraitDefinition[] = [],
  config: ThinkLoopConfig = DEFAULT_CONFIG,
  collaboration?: CollaborationAPI,
  cron?: CronManager,
  flowsDir?: string,
): Promise<Record<string, unknown>> {
  const executor = new CodeExecutor();
  let iteration = 0;
  /** 连续无有效指令的轮次计数（乱码/截断防护） */
  let consecutiveEmptyRounds = 0;
  /** 累积所有轮次的持久化数据（保留接口兼容，ReflectFlow 机制下普通 Flow 不再直接写 Stone） */
  const persistedData: Record<string, unknown> = {};
  /** 已触发的 hooks（从 flow.data 恢复，防止 Scheduler 多次调用时丢失） */
  const existingFired = (flow.toJSON().data._firedHooks as string[]) || [];
  const firedHooks = new Set<string>(existingFired);

  /* 注册所有 Trait 方法（全量，不受激活影响） */
  const methodRegistry = new MethodRegistry();
  methodRegistry.registerAll(traits);

  consola.info(`[ThinkLoop] 开始 — ${stone.name}/${flow.taskId}${config.threadId ? ` (thread: ${config.threadId})` : ""}`);

  /** 标记是否已有有效产出（message_out 或 program 执行成功），用于 catch 降级判断 */
  let hasDeliveredOutput = false;

  /**
   * 并发线程支持：
   * 当 threadId 指定时，每轮迭代开始前将 process.focusId 切换到该线程的 focusId，
   * 迭代结束后将 process.focusId 的变化同步回线程状态。
   * 这样所有读取 process.focusId 的现有代码无需修改。
   */
  const threadId = config.threadId;

  /** 在迭代开始前，将 process.focusId 切换到线程的 focusId */
  const syncThreadFocusIn = () => {
    if (!threadId) return;
    const thread = flow.process.threads?.[threadId];
    if (thread) {
      flow.process.focusId = thread.focusId;
    }
  };

  /** 在迭代结束后，将 process.focusId 的变化同步回线程状态 */
  const syncThreadFocusOut = () => {
    if (!threadId) return;
    const thread = flow.process.threads?.[threadId];
    if (thread) {
      thread.focusId = flow.process.focusId;
    }
  };

  while (flow.status === "running" && iteration < config.maxIterations) {
    iteration++;

    /* 并发线程：切换到线程的 focusId */
    syncThreadFocusIn();

    /* 发射进度事件（独立模式下，Scheduler 模式由 Scheduler 统一发射） */
    if (config.emitProgress !== false) {
      emitSSE({
        type: "flow:progress",
        objectName: stone.name,
        taskId: flow.taskId,
        iterations: iteration,
        maxIterations: config.maxIterations,
        totalIterations: iteration,
        maxTotalIterations: config.maxIterations,
      });
    }

    consola.info(`[ThinkLoop] 第 ${iteration} 轮思考`);

    /* 0. 检查并处理 pending messages（中断机制） */
    const pendingMsgs = flow.drainPendingMessages();
    if (pendingMsgs.length > 0) {
      for (const msg of pendingMsgs) {
        consola.info(`[ThinkLoop] 收到来自 ${msg.from} 的消息 (id: ${msg.id})，创建中断节点`);
        const interruptNodeId = interruptForMessage(flow.process, msg.from, msg.content);
        moveProcessFocus(flow.process, interruptNodeId);
        /* 记录到消息历史（唯一写入点） */
        flow.addMessage({ direction: "in", from: msg.from, to: stone.name, content: msg.content });
        /* 记录消息到 actions，暴露 message ID 以便 LLM 用 replyTo 引用 */
        const replyHint = msg.replyTo ? ` (回复 #${msg.replyTo})` : "";
        flow.recordAction({ type: "message_in", content: `[消息 #${msg.id} 来自 ${msg.from}${replyHint}] ${msg.content}` });
      }
      flow.setProcess({ ...flow.process });
    }

    /* 0.5 自动推进 focus：如果 todo 队列不为空且 focus 在根节点，自动移到第一个 todo 节点 */
    {
      const process = flow.process;
      const todo = process.todo ?? [];
      if (todo.length > 0 && process.focusId === process.root.id) {
        const firstTodo = todo[0]!;
        consola.info(`[ThinkLoop] 自动推进 focus 到第一个 todo 节点: ${firstTodo.title} (${firstTodo.nodeId})`);
        moveProcessFocus(process, firstTodo.nodeId);
        flow.setProcess({ ...process });
      }
    }

    /* ★ 恢复检查：是否有暂存的 LLM output 需要恢复执行 */
    const pendingOutput = flow.toJSON().data._pendingOutput as string | undefined;
    const pendingThinkingOutput = flow.toJSON().data._pendingThinkingOutput as string | undefined;
    let llmOutput: string;
    let providerThinkingOutput = "";
    let systemPrompt: string | undefined;
    let chatMessages: Message[] | undefined;

    if (pendingOutput) {
      /* 恢复模式：优先从文件读取（用户可能已修改），fallback 到内存缓存 */
      consola.info(`[ThinkLoop] 恢复执行暂存的 LLM output`);
      const flowDir = flow.dir;
      const outputFile = join(flowDir, "llm.output.txt");
      const thinkingFile = join(flowDir, "llm.thinking.txt");
      const inputFile = join(flowDir, "llm.input.txt");
      if (existsSync(outputFile)) {
        llmOutput = readFileSync(outputFile, "utf-8");
        unlinkSync(outputFile);
        if (existsSync(thinkingFile)) {
          providerThinkingOutput = readFileSync(thinkingFile, "utf-8");
          unlinkSync(thinkingFile);
        }
        if (existsSync(inputFile)) unlinkSync(inputFile);
      } else {
        llmOutput = pendingOutput;
        providerThinkingOutput = pendingThinkingOutput ?? "";
      }
      flow.setFlowData("_pendingOutput", undefined);
      flow.setFlowData("_pendingThinkingOutput", undefined);
      flow.setFlowData("_pausedContext", undefined);
      /* thought 在暂停时已经 recordAction 过，不再重复记录 */
    } else {
      /* 正常模式：构建 Context + 调用 LLM */

      /* 1. 构建 Context（集成 Trait 激活 + 历史摘要） */
      const recentHistory = flowsDir ? loadFlowSummaries(flowsDir, stone.name, flow.taskId) : null;
      const ctx = buildContext(stone, flow.toJSON(), directory, traits, [], stoneDir, recentHistory ?? undefined, flow.sessionDir, flow.dir);
      systemPrompt = formatContextAsSystem(ctx);
      chatMessages = formatContextAsMessages(ctx);

      /* 1.5 before hooks（G13 认知栈：进入新节点时的提示）
       *
       * 【设计变更】before hooks 不再在 Context 构建时注入。
       * 改为在 cognize_stack_frame_push 时创建 inline_before 内联节点触发。
       * 这样 hooks 会被记录为独立的思维步骤，可以被追踪和管理。
       *
       * 当 LLM 执行 [stack/push] 时：
       * 1. 检查是否有 before hooks
       * 2. 如果有，创建 inline_before 节点，记录 hook 内容
       * 3. 延迟执行原始的 addNode，直到 inline_before 完成
       */

      /* 2. 调用 LLM（优先使用流式） */
      const messages: Message[] = [
        { role: "system", content: systemPrompt },
        ...chatMessages,
      ];

      /* 如果没有 user 消息，添加一个继续提示 */
      if (chatMessages.length === 0 || chatMessages[chatMessages.length - 1]?.role === "assistant") {
        messages.push({ role: "user", content: "请继续执行你的任务。" });
      }

      try {
        const preferNonStreamingThinking = llm.preferNonStreamingThinking?.() === true;

        if (llm.chatEventStream && !preferNonStreamingThinking) {
          /* 流式双通道：provider thinking 直连 thought SSE，assistant 交给结构化解析器 */
          const streamed = await consumeEventStream(
            llm.chatEventStream(messages),
            stone.name,
            flow.taskId,
          );
          llmOutput = streamed.assistantContent;
          providerThinkingOutput = streamed.thinkingContent;
        } else if (llm.chatStream) {
          /* 兼容旧单通道流式接口：仅解析 assistant 文本 */
          llmOutput = await consumeAssistantStream(
            llm.chatStream(messages),
            stone.name,
            flow.taskId,
          );
        } else {
          /* 非流式 fallback */
          const response = await llm.chat(messages);
          llmOutput = response.assistantContent;
          providerThinkingOutput = response.thinkingContent;
          if (providerThinkingOutput.trim()) {
            emitSSE({ type: "stream:thought", objectName: stone.name, taskId: flow.taskId, chunk: providerThinkingOutput });
            emitSSE({ type: "stream:thought:end", objectName: stone.name, taskId: flow.taskId });
          }
          await consumeAssistantStream((async function* () {
            if (llmOutput) yield llmOutput;
          })(), stone.name, flow.taskId);
        }
      } catch (e) {
        consola.error(`[ThinkLoop] LLM 调用失败:`, (e as Error).message);
        flow.recordAction({ type: "thought", content: `[LLM 调用失败: ${(e as Error).message}]` });
        if (hasDeliveredOutput) {
          /* 已有有效产出（message_out 已送达），降级为 waiting 而非 failed */
          consola.info(`[ThinkLoop] 已有有效产出，降级为 waiting`);
          flow.setStatus("waiting");
        } else {
          flow.setStatus("failed");
        }
        flow.save();
        return persistedData;
      }

      if (providerThinkingOutput.trim()) {
        const markers = detectProtocolMarkers(providerThinkingOutput);
        consola.info(
          `[ThinkLoop][thought-source=provider] len=${providerThinkingOutput.length} markers=${markers.join(",") || "none"} preview=${JSON.stringify(previewDebugText(providerThinkingOutput))}`,
        );
        flow.recordAction({ type: "thought" as const, content: providerThinkingOutput });
      }

      /* ★ 暂停检查点：LLM 调用返回后、程序执行前 */
      if (config.isPaused?.()) {
        consola.info(`[ThinkLoop] 收到暂停信号，暂存 LLM output`);
        flow.setFlowData("_pendingOutput", llmOutput);
        flow.setFlowData("_pendingThinkingOutput", providerThinkingOutput);
        flow.setFlowData("_pausedContext", {
          systemPrompt,
          chatMessages: chatMessages.map(m => ({ role: m.role, content: m.content })),
        });
        flow.setStatus("pausing");

        /* 写出文件供人工查看/修改 */
        const flowDir = flow.dir;
        const inputContent = [systemPrompt, ...chatMessages.map(m => `--- ${m.role} ---\n${m.content}`)].join("\n\n");
        writeFileSync(join(flowDir, "llm.input.txt"), inputContent);
        writeFileSync(join(flowDir, "llm.output.txt"), llmOutput);
        if (providerThinkingOutput.trim()) {
          writeFileSync(join(flowDir, "llm.thinking.txt"), providerThinkingOutput);
        }

        flow.save();
        return persistedData;
      }
    }

    /* 3. 解析 LLM 输出（结构化段落 or legacy markdown 代码块） */
    const parsed = parseLLMOutput(llmOutput);
    const { programs, talks, actions, directives } = parsed;
    const hasStackFrameOperations = parsed.stackFrameOperations.length > 0;
    /* 结构化格式下，thought 就是 [thought] 段落内容；legacy 下是去掉代码块后的文本 */
    const replyContent = parsed.thought;
    const pendingWait = flow.toJSON().data._pendingWait === true;

    if (pendingWait && (programs.length > 0 || talks.length > 0 || actions.length > 0 || hasStackFrameOperations || directives.finish || directives.wait || directives.break_)) {
      flow.setFlowData("_pendingWait", undefined);
    }

    /* 3.5 执行栈帧操作 */
    for (const op of parsed.stackFrameOperations) {
      if (op.type === "cognize_stack_frame_push") {
        // 创建普通子栈帧（通过标准 addNode 流程，自动添加 hooks、深度检查）
        const process = flow.process;
        const parentId = process.focusId;
        const parent = findNode(process.root, parentId);

        if (!parent) {
          consola.warn(`[cognize_stack_frame_push] parent node not found, parentId=${parentId}`);
          flow.recordAction({ type: "inject", content: `[stack_push_failed] parent node not found` });
          continue;
        }

        // 【G13】检查是否有 before hooks 需要触发
        // 如果有，创建 inline_before 内联节点，延迟执行原始的 addNode
        const beforeHooks = collectHooksForInline(traits, flow, "before", firedHooks, true);

        if (beforeHooks) {
          // 有 before hooks，创建 inline_before 内联节点
          const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const inlineNode: ProcessNode = {
            id: nodeId,
            title: `[before] ${op.title}`,
            description: op.description,
            status: "doing",
            type: "inline_before",
            children: [],
            actions: [{ type: "inject", content: beforeHooks.injection, timestamp: Date.now() }],
            traits: op.traits,
            outputs: op.outputs,
            outputDescription: op.outputDescription,
            // 内联节点默认不设置 hooks
          };
          parent.children.push(inlineNode);

          // 保存原始的 cognize_stack_frame_push 参数，用于 inline_before 完成后执行
          flow.setFlowData("_pendingStackPush", {
            title: op.title,
            description: op.description,
            traits: op.traits,
            outputs: op.outputs,
            outputDescription: op.outputDescription,
          });

          // 移动 focus 到 inline_before 节点
          moveProcessFocus(process, nodeId);
          flow.setProcess({ ...process });

          // 记录 stack_push action（用于前端 Timeline 展示）
          const pushContent = [`title: ${JSON.stringify(op.title)}`];
          if (op.traits && op.traits.length > 0) pushContent.push(`traits: ${JSON.stringify(op.traits)}`);
          if (op.outputs && op.outputs.length > 0) pushContent.push(`outputs: ${JSON.stringify(op.outputs)}`);
          flow.recordAction({
            type: "stack_push",
            content: `[stack_push/cognize] ${pushContent.join(", ")}`,
          });

          consola.info(`[cognize_stack_frame_push] created inline_before node for before hooks`);
        } else {
          // 没有 before hooks，正常执行 addNode
          const nodeId = addNode(
            process,
            parentId,
            op.title,
            undefined,
            op.description,
            op.traits,
            op.outputs,
            op.outputDescription
          );
          if (nodeId) {
            addProcessTodo(process, nodeId, op.title, "plan");
            moveProcessFocus(process, nodeId);
            flow.setProcess({ ...process });

            // 记录 stack_push action（用于前端 Timeline 展示）
            const pushContent = [`title: ${JSON.stringify(op.title)}`];
            if (op.traits && op.traits.length > 0) pushContent.push(`traits: ${JSON.stringify(op.traits)}`);
            if (op.outputs && op.outputs.length > 0) pushContent.push(`outputs: ${JSON.stringify(op.outputs)}`);
            flow.recordAction({
              type: "stack_push",
              content: `[stack_push/cognize] ${pushContent.join(", ")}`,
            });
          } else {
            // addNode 可能失败：父节点不存在 或 深度超过 20 层
            consola.warn(`[cognize_stack_frame_push] addNode failed, parentId=${parentId}, title=${op.title}`);
            flow.recordAction({ type: "inject", content: `[stack_push_failed] cannot create node "${op.title}" (parent not found or depth limit)` });
          }
        }
      } else if (op.type === "reflect_stack_frame_push") {
        // 创建 reflect 内联子节点
        // 【设计说明】为什么绕过 addNode：
        // 1. inline_reflect 节点是内联的"思维记录"，不是独立的计划节点
        // 2. 不加入 todo 队列，不会被独立调度
        // 3. 不需要默认 hooks（when_stack_pop 会触发 summary 等，但内联节点不需要）
        // 4. 直接设置 status="doing"，跳过了 todo 状态
        //
        // 如果未来需要让内联节点也支持 hooks，可以：
        // - 调用 addNode 创建节点
        // - 然后设置 node.type = "inline_reflect"
        // - 不调用 addProcessTodo
        const process = flow.process;
        const parentId = process.focusId;
        const parent = findNode(process.root, parentId);
        if (parent) {
          const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const inlineNode: ProcessNode = {
            id: nodeId,
            title: op.title,
            description: op.description,
            status: "doing",
            type: "inline_reflect",
            children: [],
            actions: [],
            traits: op.traits,
            outputs: op.outputs,
            outputDescription: op.outputDescription,
            // 内联节点默认不设置 hooks。如果用户通过 create_hook 显式添加，会被触发。
          };
          parent.children.push(inlineNode);
          moveProcessFocus(process, nodeId);
          flow.setProcess({ ...process });

          // 记录 stack_push action（用于前端 Timeline 展示）
          const reflectPushContent = [`title: ${JSON.stringify(op.title)}`];
          if (op.traits && op.traits.length > 0) reflectPushContent.push(`traits: ${JSON.stringify(op.traits)}`);
          flow.recordAction({
            type: "stack_push",
            content: `[stack_push/reflect] ${reflectPushContent.join(", ")}`,
          });
        } else {
          consola.warn(`[reflect_stack_frame_push] parent node not found, parentId=${parentId}`);
          flow.recordAction({ type: "inject", content: `[stack_push_failed] parent node not found for inline_reflect` });
        }
      } else if (op.type === "cognize_stack_frame_pop" || op.type === "reflect_stack_frame_pop") {
        // 完成并弹出当前栈帧
        const process = flow.process;
        const currentId = process.focusId;
        const currentNode = findNode(process.root, currentId);

        if (currentNode && currentId !== process.root.id) {
          // 【重要】在 completeProcessNode 之前触发 when_stack_pop hooks (LIFO 顺序)
          // 必须在完成节点前执行，因为 recordAction 会写入当前 focus 节点
          const hooks = collectFrameNodeHooks(currentNode, "when_stack_pop");
          for (const hook of hooks) {
            try {
              if (hook.type === "inject_message") {
                flow.recordAction({ type: "inject", content: `[when_stack_pop] ${hook.handler}` });
              } else if (hook.type === "create_todo") {
                addProcessTodo(process, currentNode.id, hook.handler, "manual");
              }
            } catch (e) {
              flow.recordAction({ type: "inject", content: `[hook_error] ${hook.id}: ${String(e)}` });
            }
          }

          // 处理 artifacts
          if (op.artifacts && typeof op.artifacts === "object") {
            if (!currentNode.locals) currentNode.locals = {};
            Object.assign(currentNode.locals, op.artifacts);
            // 合并到父节点 locals
            const parent = getParentNode(process.root, currentId);
            if (parent) {
              if (!parent.locals) parent.locals = {};
              Object.assign(parent.locals, op.artifacts);
            }
          }

          // 完成节点
          const ok = completeProcessNode(process, currentId, op.summary ?? "");
          if (ok) {
            // 记录 stack_pop action（用于前端 Timeline 展示）
            const popType = op.type === "cognize_stack_frame_pop" ? "cognize" : "reflect";
            const popContent: string[] = [];
            if (op.summary) popContent.push(`summary: ${JSON.stringify(op.summary)}`);
            if (op.artifacts && Object.keys(op.artifacts).length > 0) {
              popContent.push(`artifacts: ${JSON.stringify(Object.keys(op.artifacts))}`);
            }
            flow.recordAction({
              type: "stack_pop",
              content: popContent.length > 0
                ? `[stack_pop/${popType}] ${popContent.join(", ")}`
                : `[stack_pop/${popType}]`,
            });

            // 检查是否是 inline_before 节点且有待执行的 stack push
            const pendingPush = flow.toJSON().data._pendingStackPush as {
              title: string;
              description?: string;
              traits?: string[];
              outputs?: string[];
              outputDescription?: string;
            } | undefined;

            if (currentNode.type === "inline_before" && pendingPush) {
              // inline_before 完成后，执行延迟的 cognize_stack_frame_push
              consola.info(`[stack_frame_pop] executing pending stack_push after inline_before`);

              // 先获取父节点（完成后 focus 还在当前节点，但需要在父节点下创建子节点）
              const parentNode = getParentNode(process.root, currentId);
              if (parentNode) {
                // 先 advanceFocus 让 focus 回到父节点
                advanceFocus(process);

                // 执行原始的 addNode
                const nodeId = addNode(
                  process,
                  parentNode.id,
                  pendingPush.title,
                  undefined,
                  pendingPush.description,
                  pendingPush.traits,
                  pendingPush.outputs,
                  pendingPush.outputDescription
                );

                if (nodeId) {
                  const pendingNode = findNode(process.root, nodeId);
                  if (pendingNode) {
                    const carriedActions = collectInlineBeforeCarryoverActions(currentNode.actions);
                    if (carriedActions.length > 0) {
                      pendingNode.actions.push(...carriedActions);
                    }
                    if (currentNode.locals && Object.keys(currentNode.locals).length > 0) {
                      pendingNode.locals = { ...(pendingNode.locals ?? {}), ...currentNode.locals };
                    }
                  }

                  addProcessTodo(process, nodeId, pendingPush.title, "plan");
                  moveProcessFocus(process, nodeId);
                  consola.info(`[stack_frame_pop] pending stack_push executed, nodeId=${nodeId}`);

                  // 记录 stack_push action（用于前端 Timeline 展示）
                  const pendingPushContent = [`title: ${JSON.stringify(pendingPush.title)}`];
                  if (pendingPush.traits && pendingPush.traits.length > 0) {
                    pendingPushContent.push(`traits: ${JSON.stringify(pendingPush.traits)}`);
                  }
                  if (pendingPush.outputs && pendingPush.outputs.length > 0) {
                    pendingPushContent.push(`outputs: ${JSON.stringify(pendingPush.outputs)}`);
                  }
                  flow.recordAction({
                    type: "stack_push",
                    content: `[stack_push/cognize] ${pendingPushContent.join(", ")}`,
                  });
                } else {
                  consola.warn(`[stack_frame_pop] pending stack_push failed`);
                  flow.recordAction({ type: "inject", content: `[stack_push_failed] cannot create node "${pendingPush.title}"` });
                }
              }

              // 清除延迟操作
              flow.setFlowData("_pendingStackPush", undefined);
            } else if (currentNode.type?.startsWith("inline_")) {
              // 其他内联节点（inline_reflect, inline_after）：正常推进 focus
              advanceFocus(process);
            } else {
              // 普通节点完成后：检查 after hooks，然后处理 todo 队列

              // 先处理 todo 队列（与原有逻辑一致）
              const todo = process.todo ?? [];
              const idx = todo.findIndex((t) => t.nodeId === currentId);
              if (idx >= 0) removeProcessTodo(process, idx);

              // 获取父节点
              const parentNode = getParentNode(process.root, currentId);

              if (parentNode) {
                // 【G13】检查是否有 after hooks 需要触发
                // after hooks 应该在父节点上下文中触发
                // 所以先移动 focus 到父节点
                moveProcessFocus(process, parentNode.id);

                // 现在检查 after hooks（在父节点上下文中）
                const afterHooks = collectHooksForInline(traits, flow, "after", firedHooks, true);

                if (afterHooks) {
                  // 有 after hooks，创建 inline_after 内联节点
                  const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const inlineNode: ProcessNode = {
                    id: nodeId,
                    title: `[after] ${currentNode.title}`,
                    status: "doing",
                    type: "inline_after",
                    children: [],
                    actions: [{ type: "inject", content: afterHooks.injection, timestamp: Date.now() }],
                  };
                  parentNode.children.push(inlineNode);

                  // 移动 focus 到 inline_after 节点
                  moveProcessFocus(process, nodeId);
                  consola.info(`[stack_frame_pop] created inline_after node for after hooks`);
                } else {
                  // 没有 after hooks，检查 nextTodo
                  const nextTodo = (process.todo ?? [])[0];
                  if (nextTodo) {
                    moveProcessFocus(process, nextTodo.nodeId);
                  }
                  // 如果没有 nextTodo，保持 focus 在父节点
                }
              } else {
                // 没有父节点（不应该发生），正常推进
                const nextTodo = (process.todo ?? [])[0];
                if (nextTodo) {
                  moveProcessFocus(process, nextTodo.nodeId);
                } else {
                  advanceFocus(process);
                }
              }
            }
            flow.setProcess({ ...process });
          } else {
            consola.warn(`[stack_frame_pop] completeProcessNode failed, nodeId=${currentId}`);
          }
        } else if (currentId === process.root.id) {
          flow.recordAction({ type: "inject", content: `[stack_pop_ignored] cannot pop root node` });
        } else {
          consola.warn(`[stack_frame_pop] current node not found, nodeId=${currentId}`);
          flow.recordAction({ type: "inject", content: `[stack_pop_failed] current node not found` });
        }
      } else if (op.type === "set_plan") {
        // 更新当前节点的 plan 字段
        const process = flow.process;
        const currentNode = findNode(process.root, process.focusId);
        if (currentNode) {
          currentNode.plan = op.content;
          flow.setProcess({ ...process });

          // 记录 set_plan action（用于前端 Timeline 展示）
          flow.recordAction({
            type: "set_plan",
            content: `[set_plan] ${op.content}`,
          });
        }
      }
    }

    /* 4. 记录思考（recordAction 自动写入 focus 节点，只记录 [thought] 段落） */
    if (replyContent) {
      const markers = detectProtocolMarkers(replyContent);
      consola.info(
        `[ThinkLoop][thought-source=parser] len=${replyContent.length} markers=${markers.join(",") || "none"} preview=${JSON.stringify(previewDebugText(replyContent))}`,
      );
      flow.recordAction({ type: "thought" as const, content: replyContent });
    }

    /* 4.5 处理 [talk/target] 段落：转化为 collaboration.talk() 调用 */
    if (talks.length > 0 && collaboration) {
      for (const t of talks) {
        collaboration.talk(t.message, t.target);
        flow.recordAction({ type: "message_out" as const, content: `[talk/${t.target}] ${t.message}` });
      }
      hasDeliveredOutput = true;
      consecutiveEmptyRounds = 0;
    }

    /* 4.6 处理 [action/toolName] 结构化工具调用 */
    if (actions.length > 0 && methodRegistry) {
      for (const act of actions) {
        let params: Record<string, unknown>;
        try {
          params = JSON.parse(act.params.trim());
        } catch (e: any) {
          /* JSON 解析失败，记录错误但不中断 */
          flow.recordAction({
            type: "action" as const,
            content: `[action/${act.toolName}] ${act.params}`,
            result: `JSON 解析失败: ${e.message}`,
            success: false,
          });
          continue;
        }

        /* 从 registry 查找方法 */
        const method = methodRegistry.get(act.toolName);
        if (!method) {
          flow.recordAction({
            type: "action" as const,
            content: `[action/${act.toolName}] ${act.params}`,
            result: `未找到工具方法: ${act.toolName}`,
            success: false,
          });
          continue;
        }

        /* 构建 methodCtx（与 buildExecutionContext 中一致） */
        const actionMethodCtx: MethodContext = Object.defineProperty(
          {
            setData: (key: string, value: unknown) => { flow.setFlowData(key, value); },
            getData: (key: string) => {
              const flowData = flow.toJSON().data;
              if (key in flowData) return flowData[key];
              return stone.data[key];
            },
            print: (...args: unknown[]) => { /* action 模式下 print 输出记录到 result */ },
            taskId: flow.taskId,
            filesDir: flow.filesDir,
            rootDir: resolve(stoneDir, "../.."),
            selfDir: stoneDir,
            stoneName: basename(stoneDir),
          } as MethodContext,
          "data",
          { get: () => ({ ...stone.data, ...flow.toJSON().data }), enumerable: true },
        );

        /* 执行方法 */
        try {
          const args = method.params.map(p => params[p.name]);
          const result = method.needsCtx
            ? await method.fn(actionMethodCtx, ...args)
            : await method.fn(...args);

          flow.recordAction({
            type: "action" as const,
            content: `[action/${act.toolName}] ${JSON.stringify(params)}`,
            result: JSON.stringify(result, null, 2),
            success: true,
          });
        } catch (e: any) {
          flow.recordAction({
            type: "action" as const,
            content: `[action/${act.toolName}] ${JSON.stringify(params)}`,
            result: `执行失败: ${e.message}`,
            success: false,
          });
        }
      }
      hasDeliveredOutput = true;
      consecutiveEmptyRounds = 0;
    }

    /* 5. 无程序且无 action 时，指令立即生效 */
    if (programs.length === 0 && actions.length === 0) {
      const userOnlyTalks = talks.length > 0 && talks.every((t) => t.target === "user");

      if (directives.break_) {
        flow.setStatus("pausing");
        flow.save();
        return persistedData;
      }
      if (directives.finish) {
        /* Hook: when_finish */
        const hookInjection = collectAndFireHooks(traits, flow, "when_finish", firedHooks);
        if (hookInjection) {
          consola.info(`[ThinkLoop] when_finish hook 触发，注入提示后继续`);
          flow.recordAction({ type: "inject", content: hookInjection });
          continue;
        }
        consola.info(`[ThinkLoop] 对象声明任务完成`);
        /* 自动触发 ReflectFlow：任务完成时发送摘要，确保经验沉淀（即使 LLM 没有主动 reflect） */
        if (collaboration && !flow.isSelfMeta) {
          const allActions = flow.actions;
          const actionCount = allActions.length;
          const errorCount = allActions.filter(a => a.success === false).length;
          const summary = flow.toJSON().data._flowSummary || "(无摘要)";
          collaboration.talkToSelf(`[自动反思] 任务完成。共 ${actionCount} 步，${errorCount} 个错误。摘要：${summary}`);
        }
        flow.setStatus("finished");
        flow.save();
        return persistedData;
      }
      if (directives.wait) {
        /* Hook: when_wait */
        const hookInjection = collectAndFireHooks(traits, flow, "when_wait", firedHooks);
        if (hookInjection) {
          consola.info(`[ThinkLoop] when_wait hook 触发，注入提示后继续`);
          flow.recordAction({ type: "inject", content: hookInjection });
          flow.setFlowData("_pendingWait", true);
          continue;
        }
        consola.info(`[ThinkLoop] 对象请求等待外部输入`);
        flow.setStatus("waiting");
        flow.save();
        return persistedData;
      }
      if (pendingWait && !directives.finish && !directives.wait && !directives.break_) {
        flow.setFlowData("_pendingWait", undefined);
        flow.setStatus("waiting");
        flow.save();
        return persistedData;
      }

      if (userOnlyTalks && !hasStackFrameOperations) {
        flow.setStatus("waiting");
        syncThreadFocusOut();
        flow.save();
        return persistedData;
      }

      if (hasStackFrameOperations || talks.length > 0) {
        consecutiveEmptyRounds = 0;
        syncThreadFocusOut();
        flow.save();
        continue;
      }

      /* 无程序、无指令 → 可能是 LLM 输出被截断（max_tokens）或乱码 */

      /* 防护层 1: 乱码检测 — LLM context 过载时可能输出 token 乱码 */
      if (replyContent && isGarbled(replyContent)) {
        consola.warn(`[ThinkLoop] 检测到 LLM 输出乱码，异常终止`);
        flow.recordAction({ type: "thought" as const, content: "[系统检测到输出异常，已终止]" });
        if (collaboration) {
          collaboration.talk(`[系统] 处理过程中出现异常（LLM 输出乱码），当前已执行 ${iteration}/${config.maxIterations} 轮。请重试。`, "user");
        }
        flow.setStatus("failed");
        flow.save();
        return persistedData;
      }

      /* 防护层 2: 连续空轮计数 — 防止截断/乱码循环消耗迭代次数 */
      if (replyContent && iteration < config.maxIterations) {
        consecutiveEmptyRounds++;
        if (consecutiveEmptyRounds >= 5) {
          consola.warn(`[ThinkLoop] 连续 ${consecutiveEmptyRounds} 轮无有效指令，异常终止`);
          if (collaboration && !hasDeliveredOutput) {
            collaboration.talk(`[系统] 连续 ${consecutiveEmptyRounds} 轮未能产生有效操作，当前已执行 ${iteration}/${config.maxIterations} 轮，任务已终止。请尝试简化你的请求。`, "user");
          }
          flow.setStatus("failed");
          flow.save();
          return persistedData;
        }
        consola.info(`[ThinkLoop] 纯思考输出（无指令，第 ${consecutiveEmptyRounds}/3 轮），可能被截断，继续下一轮`);
        continue;
      }

      /* 防护层 3: 迭代耗尽时通知用户 */
      if (!hasDeliveredOutput && collaboration) {
        collaboration.talk(`[系统] 任务处理超时，已执行 ${iteration}/${config.maxIterations} 轮仍未完成。请尝试简化你的请求。`, "user");
      }
      flow.setStatus(hasDeliveredOutput ? "finished" : "failed");
      flow.save();
      return persistedData;
    }

    /* 6. 执行程序：按语言分别执行 */
    consecutiveEmptyRounds = 0; /* 有 program 输出，重置空轮计数 */
    const hasShell = programs.some(p => p.lang === "shell");

    if (!hasShell) {
      /* 纯 JavaScript：保持原有合并执行逻辑 */
      const mergedCode = programs.map((p) => `${p.code}`).join("\n\n");
      consola.info(`[ThinkLoop] 执行 JS 程序 (${mergedCode.length} 字符, ${programs.length} 个代码块合并)`);

      const { context: execContext, getOutputs, getEffects, getPersistedData } = buildExecutionContext(stone, flow, stoneDir, methodRegistry, collaboration, traits, llm, cron);
      const result = await executor.execute(mergedCode, execContext);

      Object.assign(persistedData, getPersistedData());
      const printOutputs = getOutputs();
      const allOutputs = [...printOutputs];
      if (result.stdout) allOutputs.push(result.stdout);
      const combinedOutput = allOutputs.join("\n");

      const originalCode = programs.map((p) => p.code).join("\n\n");
      let output: string;
      if (result.success) {
        const effectLines = getEffects();
        /* 检查是否调用了 talk()/talkToSelf()，如果有则标记为有有效产出 */
        if (effectLines.some((e) => e.includes("消息已投递给"))) {
          hasDeliveredOutput = true;
        }
        const effectsSection = effectLines.length > 0
          ? `\n\n>>> effects:\n${effectLines.join("\n")}`
          : "";
        output = `>>> output:\n${combinedOutput || "(无输出)"}${effectsSection}`;
      } else if (result.isSyntaxError) {
        output = `>>> error:\n${result.error}\n[整个程序未执行，所有副作用均未生效]`;
      } else {
        const codeLines = mergedCode.split("\n");
        const errLine = result.errorLine;
        const annotated = codeLines.map((line, i) => {
          const lineNum = String(i + 1).padStart(3, " ");
          const marker = errLine !== null && i + 1 === errLine ? " ◄ ERROR" : "";
          return `${lineNum} | ${line}${marker}`;
        }).join("\n");
        output = `>>> error:\n${result.error}\n\n[出错位置（第 ${errLine ?? "?"} 行）]\n${annotated}`;
      }

      flow.recordAction({
        type: "program" as const,
        content: originalCode,
        result: output,
        success: result.success,
      });

      if (!result.success) {
        consola.warn(`[ThinkLoop] 程序执行失败: ${result.error}`);
        const errorHook = collectAndFireHooks(traits, flow, "when_error", firedHooks);
        if (errorHook) {
          consola.info(`[ThinkLoop] when_error hook 触发，注入调试提示`);
          flow.recordAction({ type: "inject", content: errorHook });
        }
      }
    } else {
      /* 混合语言或纯 Shell：逐个执行 */
      for (const prog of programs) {
        if (prog.lang === "shell") {
          consola.info(`[ThinkLoop] 执行 Shell 脚本 (${prog.code.length} 字符)`);
          const result = await executeShell(prog.code, stoneDir);

          let output: string;
          if (result.success) {
            output = `>>> output:\n${result.stdout || "(无输出)"}`;
          } else {
            output = `>>> error:\n${result.error}`;
          }

          flow.recordAction({
            type: "program" as const,
            content: `#!/bin/sh\n${prog.code}`,
            result: output,
            success: result.success,
          });

          if (!result.success) {
            consola.warn(`[ThinkLoop] Shell 执行失败: ${result.error}`);
            const errorHook = collectAndFireHooks(traits, flow, "when_error", firedHooks);
            if (errorHook) {
              consola.info(`[ThinkLoop] when_error hook 触发，注入调试提示`);
              flow.recordAction({ type: "inject", content: errorHook });
            }
          }
        } else {
          /* JavaScript 块单独执行 */
          consola.info(`[ThinkLoop] 执行 JS 程序 (${prog.code.length} 字符)`);
          const { context: execContext, getOutputs, getEffects, getPersistedData } = buildExecutionContext(stone, flow, stoneDir, methodRegistry, collaboration, traits, llm, cron);
          const result = await executor.execute(prog.code, execContext);

          Object.assign(persistedData, getPersistedData());
          const printOutputs = getOutputs();
          const allOutputs = [...printOutputs];
          if (result.stdout) allOutputs.push(result.stdout);
          const combinedOutput = allOutputs.join("\n");

          let output: string;
          if (result.success) {
            const effectLines = getEffects();
            /* 检查是否调用了 talk()/talkToSelf()，如果有则标记为有有效产出 */
            if (effectLines.some((e) => e.includes("消息已投递给"))) {
              hasDeliveredOutput = true;
            }
            const effectsSection = effectLines.length > 0
              ? `\n\n>>> effects:\n${effectLines.join("\n")}`
              : "";
            output = `>>> output:\n${combinedOutput || "(无输出)"}${effectsSection}`;
          } else {
            output = `>>> error:\n${result.error}`;
          }

          flow.recordAction({
            type: "program" as const,
            content: prog.code,
            result: output,
            success: result.success,
          });

          if (!result.success) {
            consola.warn(`[ThinkLoop] 程序执行失败: ${result.error}`);
            const errorHook = collectAndFireHooks(traits, flow, "when_error", firedHooks);
            if (errorHook) {
              consola.info(`[ThinkLoop] when_error hook 触发，注入调试提示`);
              flow.recordAction({ type: "inject", content: errorHook });
            }
          }
        }
      }
    }

    /* 7. 代码执行完毕后，检查 finish/wait/break 指令 */
    if (directives.break_) {
      flow.setStatus("pausing");
      flow.save();
      return persistedData;
    }
    if (directives.finish) {
      /* Hook: when_finish */
      const hookInjection = collectAndFireHooks(traits, flow, "when_finish", firedHooks);
      if (hookInjection) {
        consola.info(`[ThinkLoop] when_finish hook 触发，注入提示后继续`);
        flow.recordAction({ type: "inject", content: hookInjection });
        flow.save();
        continue;
      }
      consola.info(`[ThinkLoop] 代码执行完毕，对象声明任务完成`);
      /* 自动触发 ReflectFlow：任务完成时发送摘要，确保经验沉淀 */
      if (collaboration && !flow.isSelfMeta) {
        const allActions = flow.actions;
        const actionCount = allActions.length;
        const errorCount = allActions.filter(a => a.success === false).length;
        const summary = flow.toJSON().data._flowSummary || "(无摘要)";
        collaboration.talkToSelf(`[自动反思] 任务完成。共 ${actionCount} 步，${errorCount} 个错误。摘要：${summary}`);
      }
      flow.setStatus("finished");
      flow.save();
      return persistedData;
    }
    if (directives.wait) {
      /* Hook: when_wait */
      const hookInjection = collectAndFireHooks(traits, flow, "when_wait", firedHooks);
      if (hookInjection) {
        consola.info(`[ThinkLoop] when_wait hook 触发，注入提示后继续`);
        flow.recordAction({ type: "inject", content: hookInjection });
        flow.save();
        continue;
      }
      consola.info(`[ThinkLoop] 代码执行完毕，对象请求等待`);
      flow.setStatus("waiting");
      flow.save();
      return persistedData;
    }

    /* 6. 保存中间状态 */
    syncThreadFocusOut();
    flow.save();

    /* ★ 调试模式检查点：每轮执行完毕后自动暂停 */
    if (flow.toJSON().data.debugMode === true) {
      consola.info(`[ThinkLoop] 调试模式：本轮执行完毕，自动暂停`);
      flow.setStatus("pausing");
      flow.save();
      return persistedData;
    }
  }

  if (iteration >= config.maxIterations && config.maxIterations > 1) {
    consola.warn(`[ThinkLoop] 达到最大轮次 ${config.maxIterations}，强制结束`);
    flow.setStatus("finished");
    syncThreadFocusOut();
    flow.save();
  }

  syncThreadFocusOut();
  return persistedData;
}

/**
 * 消费旧单通道 LLM 流式输出，只从 assistant 文本中解析结构化协议并推送 SSE
 *
 * 状态机逐 token 扫描，遇到段落标记时切换状态并开始推送对应的 SSE 事件。
 * 返回完整的 assistant 输出文本（供后续 parseLLMOutput 解析）。
 */
async function consumeAssistantStream(
  stream: AsyncIterable<string>,
  objectName: string,
  taskId: string,
): Promise<string> {
  let fullOutput = "";
  const streamParser = createLLMOutputStreamParser();

  const emitStreamEvent = (event: LLMOutputStreamEvent) => {
    switch (event.type) {
      case "talk":
        emitSSE({ type: "stream:talk", objectName, taskId, target: event.target, chunk: event.chunk });
        break;
      case "talk:end":
        emitSSE({ type: "stream:talk:end", objectName, taskId, target: event.target });
        break;
      case "program":
        if (event.lang === "shell") {
          emitSSE({ type: "stream:program", objectName, taskId, lang: "shell", chunk: event.chunk });
        } else {
          emitSSE({ type: "stream:program", objectName, taskId, chunk: event.chunk });
        }
        break;
      case "program:end":
        emitSSE({ type: "stream:program:end", objectName, taskId });
        break;
      case "action":
        emitSSE({ type: "stream:action", objectName, taskId, toolName: event.toolName, chunk: event.chunk });
        break;
      case "action:end":
        emitSSE({ type: "stream:action:end", objectName, taskId, toolName: event.toolName });
        break;
      case "stack_push":
        emitSSE({ type: "stream:stack_push", objectName, taskId, opType: event.opType, attr: event.attr, chunk: event.chunk });
        break;
      case "stack_push:end":
        emitSSE({ type: "stream:stack_push:end", objectName, taskId, opType: event.opType, attr: event.attr });
        break;
      case "stack_pop":
        emitSSE({ type: "stream:stack_pop", objectName, taskId, opType: event.opType, attr: event.attr, chunk: event.chunk });
        break;
      case "stack_pop:end":
        emitSSE({ type: "stream:stack_pop:end", objectName, taskId, opType: event.opType, attr: event.attr });
        break;
      case "set_plan":
        emitSSE({ type: "stream:set_plan", objectName, taskId, chunk: event.chunk });
        break;
      case "set_plan:end":
        emitSSE({ type: "stream:set_plan:end", objectName, taskId });
        break;
    }
  };

  for await (const chunk of stream) {
    fullOutput += chunk;

    for (const event of streamParser.push(chunk)) {
      emitStreamEvent(event);
    }
  }

  for (const event of streamParser.done()) {
    emitStreamEvent(event);
  }

  return fullOutput;
}

/**
 * 消费双通道流式输出：thinking 直接映射为系统 thought SSE，assistant 进入结构化流式解析器。
 */
async function consumeEventStream(
  stream: AsyncIterable<LLMStreamEvent>,
  objectName: string,
  taskId: string,
): Promise<{ assistantContent: string; thinkingContent: string }> {
  let assistantContent = "";
  let thinkingContent = "";
  let sawThinking = false;
  const streamParser = createLLMOutputStreamParser();

  const emitStructuredEvent = (event: LLMOutputStreamEvent) => {
    switch (event.type) {
      case "talk":
        emitSSE({ type: "stream:talk", objectName, taskId, target: event.target, chunk: event.chunk });
        break;
      case "talk:end":
        emitSSE({ type: "stream:talk:end", objectName, taskId, target: event.target });
        break;
      case "program":
        if (event.lang === "shell") {
          emitSSE({ type: "stream:program", objectName, taskId, lang: "shell", chunk: event.chunk });
        } else {
          emitSSE({ type: "stream:program", objectName, taskId, chunk: event.chunk });
        }
        break;
      case "program:end":
        emitSSE({ type: "stream:program:end", objectName, taskId });
        break;
      case "action":
        emitSSE({ type: "stream:action", objectName, taskId, toolName: event.toolName, chunk: event.chunk });
        break;
      case "action:end":
        emitSSE({ type: "stream:action:end", objectName, taskId, toolName: event.toolName });
        break;
      case "stack_push":
        emitSSE({ type: "stream:stack_push", objectName, taskId, opType: event.opType, attr: event.attr, chunk: event.chunk });
        break;
      case "stack_push:end":
        emitSSE({ type: "stream:stack_push:end", objectName, taskId, opType: event.opType, attr: event.attr });
        break;
      case "stack_pop":
        emitSSE({ type: "stream:stack_pop", objectName, taskId, opType: event.opType, attr: event.attr, chunk: event.chunk });
        break;
      case "stack_pop:end":
        emitSSE({ type: "stream:stack_pop:end", objectName, taskId, opType: event.opType, attr: event.attr });
        break;
      case "set_plan":
        emitSSE({ type: "stream:set_plan", objectName, taskId, chunk: event.chunk });
        break;
      case "set_plan:end":
        emitSSE({ type: "stream:set_plan:end", objectName, taskId });
        break;
    }
  };

  for await (const event of stream) {
    switch (event.type) {
      case "thinking_chunk":
        thinkingContent += event.chunk;
        sawThinking = true;
        emitSSE({ type: "stream:thought", objectName, taskId, chunk: event.chunk });
        break;
      case "assistant_chunk":
        assistantContent += event.chunk;
        for (const parsedEvent of streamParser.push(event.chunk)) {
          emitStructuredEvent(parsedEvent);
        }
        break;
      case "done":
        break;
    }
  }

  for (const event of streamParser.done()) {
    emitStructuredEvent(event);
  }

  if (sawThinking) {
    emitSSE({ type: "stream:thought:end", objectName, taskId });
  }

  return { assistantContent, thinkingContent };
}

/**
 * 收集指定事件的 Trait Hooks（不标记已触发）
 *
 * 从当前激活的 traits 中收集指定事件的 hooks，
 * 跳过已在 firedHooks 中的 once hooks，返回注入文本和涉及的 hook IDs。
 *
 * 用于 inline_before/inline_after 节点创建时检查和收集 hooks。
 *
 * @param markFired - 如果为 true，会将收集到的 hooks 标记到 firedHooks 中
 * @returns 注入文本和 hook IDs，无 hook 时返回 null
 */
function collectHooksForInline(
  traits: TraitDefinition[],
  flow: Flow,
  event: "before" | "after",
  firedHooks: Set<string>,
  markFired: boolean = true,
): { injection: string; hookIds: string[] } | null {
  /* G13: 使用作用域链驱动 trait 激活 */
  const scopeChain = computeScopeChain(flow.process);
  const activeTraits = getActiveTraits(traits, scopeChain);

  const injections: string[] = [];
  const collectedTitles: string[] = [];
  const hookIds: string[] = [];
  const focusNodeId = flow.process.focusId;

  for (const trait of activeTraits) {
    if (!trait.hooks) continue;
    const hook = trait.hooks[event];
    if (!hook) continue;

    /* per-node key: 同一 hook 在不同节点上各触发一次 */
    const hookId = `${trait.name}:${event}:${focusNodeId}`;

    /* once: true 的 hook 只触发一次（per-node 粒度） */
    if (hook.once !== false && firedHooks.has(hookId)) continue;

    injections.push(hook.inject);
    if (hook.inject_title) {
      collectedTitles.push(hook.inject_title);
    }
    hookIds.push(hookId);
  }

  if (injections.length === 0) return null;

  /* 标记为已触发 */
  if (markFired) {
    for (const id of hookIds) {
      firedHooks.add(id);
    }
    flow.setFlowData("_firedHooks", Array.from(firedHooks));
  }

  /* 格式化返回内容 */
  const titlePart = injections.length === 1 && collectedTitles.length === 1
    ? ` | ${collectedTitles[0]}`
    : "";

  const injection = `>>> [系统提示 — ${event}${titlePart}]\n${injections.join("\n\n")}`;

  return { injection, hookIds };
}

function collectInlineBeforeCarryoverActions(actions: Action[]): Action[] {
  return actions
    .filter((action) => action.type === "thought" || action.type === "program" || action.type === "action" || action.type === "message_in" || action.type === "message_out")
    .map((action) => ({
      type: action.type,
      content: action.content,
      timestamp: action.timestamp,
      ...(action.result !== undefined ? { result: action.result } : {}),
      ...(action.success !== undefined ? { success: action.success } : {}),
    }));
}

/**
 * 收集并触发指定事件的 Trait Hooks
 *
 * 从当前激活的 traits 中收集指定事件的 hooks，
 * 跳过已触发的 once hooks（per-node 粒度），合并注入文本。
 *
 * @returns 合并后的注入文本，如果没有 hook 需要触发则返回 null
 */
function collectAndFireHooks(
  traits: TraitDefinition[],
  flow: Flow,
  event: TraitHookEvent,
  firedHooks: Set<string>,
): string | null {
  /* G13: 使用作用域链驱动 trait 激活 */
  const scopeChain = computeScopeChain(flow.process);
  const activeTraits = getActiveTraits(traits, scopeChain);

  const injections: string[] = [];
  const collectedTitles: string[] = [];
  const focusNodeId = flow.process.focusId;

  for (const trait of activeTraits) {
    if (!trait.hooks) continue;
    const hook = trait.hooks[event];
    if (!hook) continue;

    /* per-node key: 同一 hook 在不同节点上各触发一次 */
    const hookId = `${trait.name}:${event}:${focusNodeId}`;

    /* once: true 的 hook 只触发一次（per-node 粒度） */
    if (hook.once !== false && firedHooks.has(hookId)) continue;

    injections.push(hook.inject);
    if (hook.inject_title) {
      collectedTitles.push(hook.inject_title);
    }
    firedHooks.add(hookId);
  }

  if (injections.length === 0) return null;

  /* 持久化 firedHooks 到 flow.data，防止 Scheduler 多次调用时丢失 */
  flow.setFlowData("_firedHooks", Array.from(firedHooks));

  /* 格式化返回内容
   * - 如果只有一个 hook 且有 inject_title: ">>> [系统提示 — event | title]\n内容"
   * - 否则: ">>> [系统提示 — event]\n内容"
   */
  const titlePart = injections.length === 1 && collectedTitles.length === 1
    ? ` | ${collectedTitles[0]}`
    : "";

  return `>>> [系统提示 — ${event}${titlePart}]\n${injections.join("\n\n")}`;
}

/**
 * 构建程序执行上下文
 *
 * 向沙箱注入基础 API + Trait 方法 + 协作 API + 元编程 API + Window API。
 * 所有有副作用的 API 通过 EffectTracker 自动追踪，新增 API 只需声明 effect 格式化函数。
 */
function buildExecutionContext(
  stone: StoneData,
  flow: Flow,
  stoneDir: string,
  methodRegistry?: MethodRegistry,
  collaboration?: CollaborationAPI,
  traits?: TraitDefinition[],
  llm?: LLMClient,
  cron?: CronManager,
): { context: Record<string, unknown>; getOutputs: () => string[]; getEffects: () => string[]; getPersistedData: () => Record<string, unknown> } {
  const outputs: string[] = [];
  const tracker = new EffectTracker();

  const printFn = (...args: unknown[]) => {
    outputs.push(args.map(String).join(" "));
  };

  /** 获取合并后的数据视图：flow.data 优先，stone.data 兜底 */
  const getMergedData = (): Record<string, unknown> => {
    const flowData = flow.toJSON().data;
    return { ...stone.data, ...flowData };
  };

  /** Trait name 安全校验 */
  const TRAIT_NAME_RE = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/;

  const context: Record<string, unknown> = {
    /** 获取 files/ 目录路径 */
    filesDir: flow.filesDir,
    /** 获取任务 ID */
    taskId: flow.taskId,
    /** 文件系统路径（替代高层 API，直接用 Bun/Node 原生文件操作） */
    self_dir: stoneDir,
    self_traits_dir: join(stoneDir, "traits"),
    self_files_dir: join(stoneDir, "files"),
    world_dir: join(stoneDir, "..", ".."),
    task_dir: flow.dir,
    task_files_dir: flow.filesDir,
  };

  /* ── 基础 API ── */
  tracker.register(context, [
    { name: "print", fn: printFn },
    {
      name: "getData",
      fn: (key: string) => {
        /* flow.data 优先，fallback stone.data（只读） */
        const flowData = flow.toJSON().data;
        if (key in flowData) return flowData[key];
        return stone.data[key];
      },
    },
    { name: "getAllData", fn: () => getMergedData() },
    {
      name: "setData",
      fn: (key: string, value: unknown) => {
        /* 写入 flow.data（Session 工作记忆） */
        flow.setFlowData(key, value);
      },
      effect: (args) => `setData("${args[0]}", ...) → flow.data`,
    },
  ]);

  /* ── Memory API（记忆索引读写） ── */
  const flowDir = flow.dir;
  tracker.register(context, [
    {
      name: "getMemory",
      fn: () => {
        /* 只读：返回 stone 长期记忆 */
        const p = join(stoneDir, "memory.md");
        return existsSync(p) ? readFileSync(p, "utf-8") : "";
      },
    },
    {
      name: "getSessionMemory",
      fn: () => {
        const p = join(flowDir, "memory.md");
        return existsSync(p) ? readFileSync(p, "utf-8") : "";
      },
    },
    {
      name: "updateSessionMemory",
      fn: (content: string) => {
        if (!existsSync(flowDir)) mkdirSync(flowDir, { recursive: true });
        writeFileSync(join(flowDir, "memory.md"), content, "utf-8");
      },
      effect: () => `✓ session memory.md 已更新`,
    },
    {
      name: "updateFlowSummary",
      fn: (summary: string) => {
        flow.setSummary(summary);
      },
      effect: () => `✓ flow 摘要已更新`,
    },
    {
      name: "getFlowSummary",
      fn: () => {
        return flow.summary ?? "";
      },
    },
  ]);

  /* 注入 local 变量（行为树节点局部作用域） */
  const focusNode = getFocusNode(flow.process);
  if (focusNode) {
    if (!focusNode.locals) focusNode.locals = {};
    /* 构建作用域链：祖先 locals 只读，focus 节点 locals 可写 */
    const path = getPathToNode(flow.process.root, focusNode.id);
    const ancestorLocals: Record<string, unknown> = {};
    for (const node of path) {
      if (node.id !== focusNode.id && node.locals) {
        Object.assign(ancestorLocals, node.locals);
      }
    }
    context.local = new Proxy(focusNode.locals, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && prop in target) return target[prop];
        if (typeof prop === "string" && prop in ancestorLocals) return ancestorLocals[prop];
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value) {
        if (typeof prop === "string") { target[prop] = value; return true; }
        return Reflect.set(target, prop, value);
      },
    });
  }
  if (!context.local) {
    context.local = {};
  }

  /* 注入 Trait 方法（Phase 2） */
  if (methodRegistry && traits) {
    /* G3: 按作用域链计算已激活 trait，只注入对应方法 */
    const scopeChain = computeScopeChain(flow.process);
    const activeTraitNames = getActiveTraits(traits, scopeChain).map((t) => traitId(t));

    const methodCtx: MethodContext = Object.defineProperty(
      {
        setData: (key: string, value: unknown) => { flow.setFlowData(key, value); },
        getData: (key: string) => {
          const flowData = flow.toJSON().data;
          if (key in flowData) return flowData[key];
          return stone.data[key];
        },
        print: printFn,
        taskId: flow.taskId,
        filesDir: flow.filesDir,
        rootDir: resolve(stoneDir, "../.."),
        selfDir: stoneDir,
        stoneName: basename(stoneDir),
      } as MethodContext,
      "data",
      { get: () => getMergedData(), enumerable: true },
    );
    const sandboxMethods = methodRegistry.buildSandboxMethods(methodCtx, activeTraitNames);
    Object.assign(context, sandboxMethods);
  }

  /* ── 认知栈 API（G13） ── */
  tracker.register(context, [
    {
      name: "moveFocus",
      fn: (nodeId: string) => {
        const process = flow.process;
        if (!process) return false;
        const ok = moveProcessFocus(process, nodeId);
        if (ok) flow.setProcess({ ...process });
        return ok;
      },
    },
    {
      name: "stack_throw",
      fn: (error: string) => {
        const process = flow.process;
        if (!process) return false;
        const focusNode = getFocusNode(process);
        if (!focusNode) return false;

        focusNode.status = "done";
        focusNode.summary = `[ERROR] ${error}`;

        let current = focusNode;
        let caught = false;
        while (true) {
          const parent = getParentNode(process.root, current.id);
          if (!parent) break;

          const errorHooks = collectFrameNodeHooks(parent, "when_error");
          if (errorHooks.length > 0) {
            for (const hook of errorHooks) {
              try {
                if (hook.type === "inject_message") {
                  flow.recordAction({ type: "inject", content: `[when_error caught] ${hook.handler}: ${error}` });
                } else if (hook.type === "create_todo") {
                  addProcessTodo(process, parent.id, `[ERROR] ${hook.handler}: ${error}`, "manual");
                }
              } catch (e) {
                flow.recordAction({ type: "inject", content: `[hook_error] ${hook.id}: ${String(e)}` });
              }
            }
            process.focusId = parent.id;
            caught = true;
            break;
          }

          if (!parent.summary) {
            parent.summary = `[ERROR propagated] ${error}`;
          }
          current = parent;
        }

        if (!caught) {
          flow.recordAction({ type: "inject", content: `[uncaught_error] ${error}` });
          process.focusId = process.root.id;
        }

        flow.setProcess({ ...process });
        return true;
      },
      effect: (args) => `stack_throw("${args[0]}")`,
    },
    {
      name: "summary",
      fn: (text: string) => {
        const process = flow.process;
        if (!process) return false;
        const focusNode = getFocusNode(process);
        if (!focusNode) return false;
        focusNode.summary = text;
        flow.setProcess({ ...process });
        return true;
      },
      effect: (args) => `summary("${(args[0] as string).slice(0, 40)}...")`,
    },
    {
      name: "create_hook",
      fn: (when: string, type: string, handler: string) => {
        const process = flow.process;
        if (!process) return false;
        return createFrameHook(process, process.focusId, when as HookTime, type as HookType, handler);
      },
      effect: (args) => `create_hook("${args[0]}", "${args[1]}", "${(args[2] as string).slice(0, 30)}")`,
    },
    /* ── 多线程 API（G13 增强）── */
    {
      name: "create_thread",
      fn: (name: string, focusId?: string) => {
        const process = flow.process;
        if (!process) return false;
        const targetFocusId = focusId ?? process.focusId;
        const ok = createThread(process, name, targetFocusId);
        if (ok) flow.setProcess({ ...process });
        return ok;
      },
      effect: (args, result) => `create_thread("${args[0]}"${args[1] ? `, "${args[1]}"` : ""}) → ${result ? "OK" : "失败"}`,
    },
    {
      name: "go_thread",
      fn: (threadName: string, nodeId?: string) => {
        const process = flow.process;
        if (!process) return false;
        const result = goThread(process, threadName, nodeId);
        if (result.success && result.yieldedNodeId) {
          const yieldedNode = findNode(process.root, result.yieldedNodeId);
          if (yieldedNode) {
            const hooks = collectFrameNodeHooks(yieldedNode, "when_yield");
            for (const hook of hooks) {
              try {
                if (hook.type === "inject_message") {
                  flow.recordAction({ type: "inject", content: `[when_yield:thread_switch] ${hook.handler}` });
                } else if (hook.type === "create_todo") {
                  addProcessTodo(process, yieldedNode.id, hook.handler, "manual");
                }
              } catch (e) {
                flow.recordAction({ type: "inject", content: `[hook_error] ${String(e)}` });
              }
            }
          }
        }
        if (result.success) flow.setProcess({ ...process });
        return result.success;
      },
      effect: (args, result) => `go_thread("${args[0]}"${args[1] ? `, "${args[1]}"` : ""}) → ${result ? "OK" : "失败"}`,
    },
    {
      name: "send_signal",
      fn: (toThread: string, content: string) => {
        const process = flow.process;
        if (!process) return null;
        const currentThread = Object.values(process.threads ?? {}).find(t => t.status === "running");
        if (!currentThread) return null;
        const sigId = sendSignal(process, currentThread.name, toThread, content);
        if (sigId) flow.setProcess({ ...process });
        return sigId;
      },
      effect: (args, result) => `send_signal("${args[0]}", "${(args[1] as string).slice(0, 30)}") → ${result ?? "失败"}`,
    },
    {
      name: "ack_signal",
      fn: (signalId: string, memo?: string) => {
        const process = flow.process;
        if (!process) return false;
        const currentThread = Object.values(process.threads ?? {}).find(t => t.status === "running");
        if (!currentThread) return false;
        const ok = ackSignal(process, currentThread.name, signalId, memo);
        if (ok) flow.setProcess({ ...process });
        return ok;
      },
      effect: (args, result) => `ack_signal("${args[0]}"${args[1] ? `, "${args[1]}"` : ""}) → ${result ? "OK" : "失败"}`,
    },
    {
      /** 并发分叉：为指定的多个节点各创建一个线程，全部设为 running */
      name: "fork_threads",
      fn: (nodeIds: string[]) => {
        const process = flow.process;
        if (!process) return false;
        if (!Array.isArray(nodeIds) || nodeIds.length < 2) return false;

        if (!process.threads) process.threads = {};

        const created: string[] = [];
        for (const nodeId of nodeIds) {
          const node = findNode(process.root, nodeId);
          if (!node) continue;
          /* 线程名用节点 ID，保证唯一 */
          const threadName = `t_${nodeId}`;
          if (process.threads[threadName]) continue;
          process.threads[threadName] = {
            name: threadName,
            focusId: nodeId,
            status: "running",
            signals: [],
          };
          /* 将节点标记为 doing */
          if (node.status === "todo") node.status = "doing";
          created.push(threadName);
        }

        if (created.length > 0) flow.setProcess({ ...process });
        return created;
      },
      effect: (args, result) => `fork_threads([${(args[0] as string[]).join(", ")}]) → ${Array.isArray(result) ? result.length + " threads" : "失败"}`,
    },
    {
      /** 等待所有指定线程完成（检查线程状态是否都为 finished） */
      name: "join_threads",
      fn: (threadNames: string[]) => {
        const process = flow.process;
        if (!process || !process.threads) return false;
        if (!Array.isArray(threadNames)) return false;

        const allFinished = threadNames.every((name) => {
          const thread = process.threads?.[name];
          return thread?.status === "finished";
        });

        return allFinished;
      },
      effect: (args, result) => `join_threads([${(args[0] as string[]).join(", ")}]) → ${result ? "全部完成" : "仍在执行"}`,
    },
    {
      /** 标记当前线程为 finished */
      name: "finish_thread",
      fn: () => {
        const process = flow.process;
        if (!process || !process.threads) return false;
        const currentThread = Object.values(process.threads).find(t => t.status === "running");
        if (!currentThread) return false;
        currentThread.status = "finished";
        flow.setProcess({ ...process });
        return true;
      },
      effect: (_args, result) => `finish_thread() → ${result ? "OK" : "失败"}`,
    },
  ]);

  /* ── TodoList 管理 API ── */
  tracker.register(context, [
    {
      name: "addTodo",
      fn: (nodeId: string, title: string) => {
        const process = flow.process;
        if (!process) return;
        addProcessTodo(process, nodeId, title, "manual");
        flow.setProcess({ ...process });
      },
    },
    {
      name: "insertTodo",
      fn: (index: number, nodeId: string, title: string) => {
        const process = flow.process;
        if (!process) return;
        insertProcessTodo(process, index, nodeId, title, "manual");
        flow.setProcess({ ...process });
      },
    },
    {
      name: "removeTodo",
      fn: (index: number) => {
        const process = flow.process;
        if (!process) return false;
        const ok = removeProcessTodo(process, index);
        if (ok) flow.setProcess({ ...process });
        return ok;
      },
    },
    {
      name: "getTodo",
      fn: () => {
        const process = flow.process;
        if (!process) return [];
        return getProcessTodo(process);
      },
    },
  ]);

  /* ── 协作 API（Phase 4） ── */
  if (collaboration) {
    tracker.register(context, [
      {
        name: "talk",
        fn: (message: string, target: string, replyTo?: string) => collaboration.talk(message, target, replyTo),
        effect: (args) => `✓ 消息已投递给 ${args[1]}`,
      },
      {
        name: "talkToSelf",
        fn: (message: string) => collaboration.talkToSelf(message),
        effect: () => `✓ 消息已投递给 ReflectFlow`,
      },
      {
        name: "reflect",
        fn: (message: string) => collaboration.talkToSelf(message),
        effect: () => `✓ 消息已投递给 ReflectFlow`,
      },
    ]);

    /* SelfMeta 专用：replyToFlow（双向对话的反向通道） */
    if (flow.isSelfMeta) {
      tracker.register(context, [
        {
          name: "replyToFlow",
          fn: (taskId: string, message: string) => collaboration.replyToFlow(taskId, message),
          effect: (args) => `✓ 回复已投递给 Flow ${args[0]}`,
        },
      ]);
    }
  }

  /* ── Trait 元编程 API ── */
  const traitsDir = join(stoneDir, "traits");
  /* 从 stones/{name}/ 向上两级到根目录 */
  const rootDir = join(stoneDir, "..", "..");
  const libraryTraitsDir = join(rootDir, "library", "traits");
  const kernelTraitsDir = join(rootDir, "kernel", "traits");

  /**
   * 按优先级查找 trait 目录
   * 优先级：自身 traits/ → library/traits/ → kernel/traits/
   * 返回找到的目录路径，找不到返回 null
   */
  function findTraitDir(name: string): string | null {
    const selfDir = join(traitsDir, name);
    if (existsSync(selfDir)) return selfDir;

    const libDir = join(libraryTraitsDir, name);
    if (existsSync(libDir)) return libDir;

    const kernelDir = join(kernelTraitsDir, name);
    if (existsSync(kernelDir)) return kernelDir;

    return null;
  }

  function normalizeTraitLookup(name: string): string[] {
    const trimmed = name.trim();
    if (!trimmed) return [];
    const candidates = new Set<string>([trimmed]);
    if (trimmed.includes("/")) {
      candidates.add(trimmed.replaceAll("/", "-"));
      const parts = trimmed.split("/");
      const last = parts[parts.length - 1];
      if (last) candidates.add(last);
    }
    return Array.from(candidates);
  }

  function findLoadedTrait(name: string): TraitDefinition | null {
    const candidates = new Set(normalizeTraitLookup(name));
    for (const trait of traits) {
      const id = traitId(trait);
      if (candidates.has(id) || candidates.has(trait.name)) {
        return trait;
      }
    }
    return null;
  }

  /** 热加载：trait 文件变更后立即加载到当前任务（异步，下一轮思考生效） */
  const hotReloadTrait = (name: string) => {
    if (!traits || !methodRegistry) return;
    const traitDir = findTraitDir(name);
    if (!traitDir) {
      consola.warn(`[ThinkLoop] 热加载 trait "${name}" 失败：找不到该 trait`);
      return;
    }
    loadTrait(traitDir, name).then((loaded) => {
      if (!loaded) {
        consola.warn(`[ThinkLoop] 热加载 trait "${name}" 失败（可能存在语法错误）`);
        return;
      }
      const idx = traits.findIndex((t) => t.name === name);
      if (idx >= 0) traits[idx] = loaded;
      else traits.push(loaded);
      methodRegistry.registerAll(traits);
    }).catch((err) => {
      consola.warn(`[ThinkLoop] 热加载 trait "${name}" 异常: ${err?.message ?? err}`);
    });
  };

  tracker.register(context, [
    {
      name: "readTrait",
      fn: (name: string) => {
        if (!TRAIT_NAME_RE.test(name)) return `[错误] trait 名称无效: ${name}`;

        const loadedTrait = findLoadedTrait(name);
        if (loadedTrait) {
          return {
            name: traitId(loadedTrait),
            readme: loadedTrait.readme,
            when: loadedTrait.when,
            description: loadedTrait.description,
            source: loadedTrait.namespace === "kernel" ? "kernel" : loadedTrait.namespace ? "library" : "self",
          };
        }

        const traitDir = findTraitDir(name);
        if (!traitDir) return `[错误] trait "${name}" 不存在（已检查：自身 traits/、library/traits/、kernel/traits/）`;
        const r: Record<string, unknown> = { name };
        const traitDocPath = existsSync(join(traitDir, "TRAIT.md"))
          ? join(traitDir, "TRAIT.md")
          : existsSync(join(traitDir, "SKILL.md"))
            ? join(traitDir, "SKILL.md")
            : join(traitDir, "readme.md");
        if (existsSync(traitDocPath)) {
          const raw = readFileSync(traitDocPath, "utf-8");
          const { data, content } = matter(raw);
          r.readme = content.trim();
          r.when = data.when ?? "never";
          r.description = data.description ?? "";
        } else {
          r.readme = "";
          r.when = "never";
          r.description = "";
        }
        /* 记录来源位置（不返回 code，code 仅在 activateTrait 后由系统内部使用） */
        if (traitDir.startsWith(libraryTraitsDir)) {
          r.source = "library";
        } else if (traitDir.startsWith(kernelTraitsDir)) {
          r.source = "kernel";
        } else {
          r.source = "self";
        }
        return r;
      },
    },
    {
      name: "listTraits",
      fn: () => {
        const names = new Set<string>(traits.map((trait) => traitId(trait)));
        if (existsSync(traitsDir)) {
          for (const dir of readdirSync(traitsDir, { withFileTypes: true })) {
            if (dir.isDirectory()) names.add(dir.name);
          }
        }
        return Array.from(names).sort();
      },
    },
  ]);

  /* ── Trait 激活 API（G13: 写入当前 focus 节点的 activatedTraits） ── */
  tracker.register(context, [
    {
      name: "activateTrait",
      fn: (name: string) => {
        /* 校验 trait 是否存在（按优先级：自身 → library → kernel） */
        const loadedTrait = findLoadedTrait(name);
        const canonicalName = loadedTrait ? traitId(loadedTrait) : name;
        const traitDir = loadedTrait ? findTraitDir(canonicalName) ?? findTraitDir(name) : findTraitDir(name);
        if (!loadedTrait && !traitDir) return `[错误] trait "${name}" 不存在，无法激活（已检查：自身 traits/、library/traits/、kernel/traits/）`;

        const process = flow.process;
        if (!process) return `[错误] 无行为树`;
        const node = findNode(process.root, process.focusId);
        if (!node) return `[错误] focus 节点不存在`;
        if (!node.activatedTraits) node.activatedTraits = [];
        if (node.activatedTraits.includes(canonicalName)) return `trait "${canonicalName}" 已在当前栈帧激活`;
        node.activatedTraits.push(canonicalName);
        flow.setProcess({ ...process });
        return `trait "${canonicalName}" 已激活到当前栈帧，下次思考时将加载完整内容`;
      },
      effect: (args) => `activateTrait("${args[0]}") → OK`,
    },
  ]);

  /* ── 热加载 API（配合文件系统路径使用） ── */
  tracker.register(context, [
    {
      name: "reloadTrait",
      fn: (name: string) => {
        if (!TRAIT_NAME_RE.test(name)) return `[错误] trait 名称无效: ${name}`;
        hotReloadTrait(name);
        return `✓ trait "${name}" 已提交热加载（下一轮思考生效）`;
      },
      effect: (args) => `reloadTrait("${args[0]}")`,
    },
    {
      name: "reloadReadme",
      fn: () => {
        const readmePath = join(stoneDir, "readme.md");
        if (!existsSync(readmePath)) return "[错误] readme.md 不存在";
        return "✓ readme.md 已重新加载（下一轮思考生效）";
      },
      effect: () => "reloadReadme()",
    },
    {
      name: "reloadMemory",
      fn: () => {
        const memoryPath = join(stoneDir, "memory.md");
        if (!existsSync(memoryPath)) return "[错误] memory.md 不存在";
        return "✓ memory.md 已重新加载（下一轮思考生效）";
      },
      effect: () => "reloadMemory()",
    },
  ]);

  /* ── Context Window API ── */
  const getFlowWindows = (): Record<string, unknown> => {
    return (flow.toJSON().data._windows as Record<string, unknown>) ?? {};
  };
  const setFlowWindows = (windows: Record<string, unknown>) => {
    const data = { ...flow.toJSON().data, _windows: windows };
    for (const [k, v] of Object.entries(data)) {
      flow.setFlowData(k, v);
    }
  };

  tracker.register(context, [
    {
      name: "addWindow",
      fn: (name: string, contentOrConfig: unknown, _options?: unknown) => {
        const windows = getFlowWindows();
        if (typeof contentOrConfig === "string") {
          windows[name] = { name, type: "static", content: contentOrConfig };
        } else if (typeof contentOrConfig === "object" && contentOrConfig !== null) {
          const cfg = contentOrConfig as Record<string, unknown>;
          if (typeof cfg.file === "string") {
            windows[name] = { name, type: "file", filePath: cfg.file };
          } else if (typeof cfg.trait === "string" && typeof cfg.method === "string") {
            windows[name] = { name, type: "function", traitName: cfg.trait, methodName: cfg.method };
          }
        }
        setFlowWindows(windows);
        return `window "${name}" 已添加`;
      },
      effect: (args) => `addWindow("${args[0]}") → OK`,
    },
    {
      name: "getWindow",
      fn: (name: string) => {
        const windows = getFlowWindows();
        const cfg = windows[name] as Record<string, unknown> | undefined;
        if (!cfg) return null;
        if (cfg.type === "static") return cfg.content ?? null;
        if (cfg.type === "file") {
          const filePath = join(stoneDir, cfg.filePath as string);
          return existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
        }
        if (cfg.type === "function") return `[函数型 window: ${cfg.traitName}.${cfg.methodName}]`;
        return null;
      },
    },
    {
      name: "editWindow",
      fn: (name: string, content: string) => {
        const windows = getFlowWindows();
        const existing = windows[name] as Record<string, unknown> | undefined;
        if (!existing) return `[错误] window "${name}" 不存在`;
        windows[name] = { ...existing, type: "static", content };
        setFlowWindows(windows);
        return `window "${name}" 已更新`;
      },
      effect: (args) => `editWindow("${args[0]}") → OK`,
    },
    {
      name: "removeWindow",
      fn: (name: string) => {
        const windows = getFlowWindows();
        delete windows[name];
        setFlowWindows(windows);
        return `window "${name}" 已移除`;
      },
      effect: (args) => `removeWindow("${args[0]}") → OK`,
    },
    {
      name: "listWindows",
      fn: () => {
        const windows = getFlowWindows();
        return Object.keys(windows);
      },
    },
  ]);

  /* ── LLM API ── */
  if (llm && typeof llm.simpleCall === "function") {
    tracker.register(context, [
      {
        name: "callLLM",
        fn: async (prompt: string, options?: SimpleLLMOptions) => {
          try {
            return await llm.simpleCall!(prompt, options);
          } catch (e: unknown) {
            return `[错误] LLM 调用失败: ${e instanceof Error ? e.message : String(e)}`;
          }
        },
        effect: (args) => `callLLM("${String(args[0]).slice(0, 50)}...")`,
      },
    ]);
  }

  /* ── 定时任务 API ── */
  if (cron) {
    tracker.register(context, [
      {
        name: "schedule",
        fn: (targetObject: string, message: string, delayMs: number) => {
          const triggerAt = Date.now() + delayMs;
          const id = cron.schedule(targetObject, message, triggerAt, stone.name);
          return { id, triggerAt: new Date(triggerAt).toISOString() };
        },
        effect: (args) => `schedule("${args[0]}", delay=${args[2]}ms)`,
      },
      {
        name: "cancelSchedule",
        fn: (id: string) => cron.cancel(id),
        effect: (args) => `cancelSchedule("${args[0]}")`,
      },
      {
        name: "listSchedules",
        fn: () => cron.list(),
      },
    ]);
  }

  return {
    context,
    getOutputs: () => [...outputs],
    getEffects: () => tracker.getEffects(),
    getPersistedData: () => {
      /* persistData 已移除，普通 Flow 不再直接写 Stone。保留接口兼容。 */
      return {};
    },
  };
}
