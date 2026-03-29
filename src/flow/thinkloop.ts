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
import { join } from "node:path";
import matter from "gray-matter";
import { Flow } from "./flow.js";
import { parseLLMOutput } from "./parser.js";
import type { ExtractedTalk } from "./parser.js";
import { emitSSE } from "../server/events.js";
import { buildContext } from "../context/builder.js";
import { loadFlowSummaries } from "../context/history.js";
import { formatContextAsSystem, formatContextAsMessages } from "../context/formatter.js";
import { CodeExecutor, executeShell } from "../executable/executor.js";
import { EffectTracker } from "../executable/effects.js";
import { MethodRegistry, type MethodContext } from "../trait/registry.js";
import {
  createProcess, addNode, completeNode as completeProcessNode,
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
import type { LLMClient, Message, SimpleLLMOptions } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, TraitHookEvent, HookTime, HookType } from "../types/index.js";
import { getActiveTraits } from "../trait/activator.js";
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
  maxIterations: 100,
};

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
    let llmOutput: string;
    let systemPrompt: string | undefined;
    let chatMessages: Message[] | undefined;

    if (pendingOutput) {
      /* 恢复模式：优先从文件读取（用户可能已修改），fallback 到内存缓存 */
      consola.info(`[ThinkLoop] 恢复执行暂存的 LLM output`);
      const flowDir = flow.dir;
      const outputFile = join(flowDir, "llm.output.txt");
      const inputFile = join(flowDir, "llm.input.txt");
      if (existsSync(outputFile)) {
        llmOutput = readFileSync(outputFile, "utf-8");
        unlinkSync(outputFile);
        if (existsSync(inputFile)) unlinkSync(inputFile);
      } else {
        llmOutput = pendingOutput;
      }
      flow.setFlowData("_pendingOutput", undefined);
      flow.setFlowData("_pausedContext", undefined);
      llmOutput = pendingOutput;
      /* thought 在暂停时已经 recordAction 过，不再重复记录 */
    } else {
      /* 正常模式：构建 Context + 调用 LLM */

      /* 1. 构建 Context（集成 Trait 激活 + 历史摘要） */
      const recentHistory = flowsDir ? loadFlowSummaries(flowsDir, stone.name, flow.taskId) : null;
      const ctx = buildContext(stone, flow.toJSON(), directory, traits, [], stoneDir, recentHistory ?? undefined, flow.sessionDir, flow.dir);
      systemPrompt = formatContextAsSystem(ctx);
      chatMessages = formatContextAsMessages(ctx);

      /* 1.5 注入 before hooks（G13 认知栈：进入新节点时的提示） */
      const beforeInjection = collectAndFireHooks(traits, flow, "before", firedHooks);
      if (beforeInjection) {
        chatMessages.push({ role: "user", content: beforeInjection });
      }

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
        if (llm.chatStream) {
          /* 流式模式：逐 token 接收，实时检测 [thought] 和 [talk/xxx] 并推送 SSE */
          llmOutput = await consumeStream(
            llm.chatStream(messages),
            stone.name,
            flow.taskId,
          );
        } else {
          /* 非流式 fallback */
          const response = await llm.chat(messages);
          llmOutput = response.content;
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

      /* ★ 暂停检查点：LLM 调用返回后、程序执行前 */
      if (config.isPaused?.()) {
        consola.info(`[ThinkLoop] 收到暂停信号，暂存 LLM output`);
        flow.setFlowData("_pendingOutput", llmOutput);
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

        flow.save();
        return persistedData;
      }
    }

    /* 3. 解析 LLM 输出（结构化段落 or legacy markdown 代码块） */
    const parsed = parseLLMOutput(llmOutput);
    const { programs, talks, directives } = parsed;
    /* 结构化格式下，thought 就是 [thought] 段落内容；legacy 下是去掉代码块后的文本 */
    const replyContent = parsed.thought;

    /* 4. 记录思考（recordAction 自动写入 focus 节点，只记录 [thought] 段落） */
    if (replyContent) {
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

    /* 5. 无程序时，指令立即生效 */
    if (programs.length === 0) {
      if (directives.finish) {
        /* Hook: when_finish */
        const hookInjection = collectAndFireHooks(traits, flow, "when_finish", firedHooks);
        if (hookInjection) {
          consola.info(`[ThinkLoop] when_finish hook 触发，注入提示后继续`);
          flow.recordAction({ type: "inject", content: hookInjection });
          continue;
        }
        consola.info(`[ThinkLoop] 对象声明任务完成`);
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
          continue;
        }
        consola.info(`[ThinkLoop] 对象请求等待外部输入`);
        flow.setStatus("waiting");
        flow.save();
        return persistedData;
      }
      /* 无程序、无指令 → 可能是 LLM 输出被截断（max_tokens）或乱码 */

      /* 防护层 1: 乱码检测 — LLM context 过载时可能输出 token 乱码 */
      if (replyContent && isGarbled(replyContent)) {
        consola.warn(`[ThinkLoop] 检测到 LLM 输出乱码，异常终止`);
        flow.recordAction({ type: "thought" as const, content: "[系统检测到输出异常，已终止]" });
        if (collaboration) {
          collaboration.talk("[系统] 处理过程中出现异常（LLM 输出乱码），请重试。", "user");
        }
        flow.setStatus("failed");
        flow.save();
        return persistedData;
      }

      /* 防护层 2: 连续空轮计数 — 防止截断/乱码循环消耗迭代次数 */
      if (replyContent && iteration < config.maxIterations) {
        consecutiveEmptyRounds++;
        if (consecutiveEmptyRounds >= 3) {
          consola.warn(`[ThinkLoop] 连续 ${consecutiveEmptyRounds} 轮无有效指令，异常终止`);
          if (collaboration && !hasDeliveredOutput) {
            collaboration.talk("[系统] 连续多轮未能产生有效操作，任务已终止。请尝试简化你的请求。", "user");
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
        collaboration.talk("[系统] 任务处理超时，未能完成。请尝试简化你的请求。", "user");
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
      const mergedCode = programs.map((p) => `{\n${p.code}\n}`).join("\n\n");
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
 * 消费 LLM 流式输出，实时检测 [thought] 和 [talk/xxx] 段落并推送 SSE
 *
 * 状态机逐 token 扫描，遇到段落标记时切换状态并开始推送对应的 SSE 事件。
 * 返回完整的 LLM 输出文本（供后续 parseLLMOutput 解析）。
 */
async function consumeStream(
  stream: AsyncIterable<string>,
  objectName: string,
  taskId: string,
): Promise<string> {
  let fullOutput = "";
  /** 当前正在流式推送的段落类型 */
  let streamingSection: "thought" | "talk" | null = null;
  /** 当前 talk 的目标对象名 */
  let streamingTalkTarget: string | null = null;
  /** 行缓冲区：用于检测段落标记（标记必须独占一行） */
  let lineBuffer = "";

  /** 检查行缓冲区是否匹配段落标记，返回匹配类型 */
  const checkLineTag = (line: string): { type: "thought" | "program" | "finish" | "wait" | "break" | "talk_open" | "talk_close" | null; target?: string } => {
    const trimmed = line.trim();
    if (/^\[(thought|program|finish|wait|break)\]$/.test(trimmed)) {
      return { type: trimmed.slice(1, -1) as "thought" | "program" | "finish" | "wait" | "break" };
    }
    const talkMatch = /^\[talk\/([a-zA-Z0-9_-]+)\]$/.exec(trimmed);
    if (talkMatch) {
      return { type: "talk_open", target: talkMatch[1]! };
    }
    if (/^\[\/talk\]$/.test(trimmed)) {
      return { type: "talk_close" };
    }
    return { type: null };
  };

  /** 结束当前流式段落，发送 end 事件 */
  const endCurrentSection = () => {
    if (streamingSection === "thought") {
      emitSSE({ type: "stream:thought:end", objectName, taskId });
    } else if (streamingSection === "talk" && streamingTalkTarget) {
      emitSSE({ type: "stream:talk:end", objectName, taskId, target: streamingTalkTarget });
    }
    streamingSection = null;
    streamingTalkTarget = null;
  };

  for await (const chunk of stream) {
    fullOutput += chunk;

    /* 逐字符处理，按换行符分割成行 */
    for (const char of chunk) {
      if (char === "\n") {
        /* 一行结束，检查是否是段落标记 */
        const tag = checkLineTag(lineBuffer);

        if (tag.type === "thought") {
          endCurrentSection();
          streamingSection = "thought";
        } else if (tag.type === "talk_open") {
          endCurrentSection();
          streamingSection = "talk";
          streamingTalkTarget = tag.target!;
        } else if (tag.type === "talk_close") {
          endCurrentSection();
        } else if (tag.type === "program" || tag.type === "finish" || tag.type === "wait" || tag.type === "break") {
          endCurrentSection();
        } else {
          /* 普通内容行：如果在流式段落中，推送内容（含换行） */
          if (streamingSection === "thought") {
            emitSSE({ type: "stream:thought", objectName, taskId, chunk: lineBuffer + "\n" });
          } else if (streamingSection === "talk" && streamingTalkTarget) {
            emitSSE({ type: "stream:talk", objectName, taskId, target: streamingTalkTarget, chunk: lineBuffer + "\n" });
          }
        }

        lineBuffer = "";
      } else {
        lineBuffer += char;
      }
    }
  }

  /* 处理最后一行（没有换行符结尾的情况） */
  if (lineBuffer.length > 0) {
    const tag = checkLineTag(lineBuffer);
    if (tag.type === "talk_close" || tag.type === "program" || tag.type === "finish" || tag.type === "wait" || tag.type === "break") {
      endCurrentSection();
    } else if (tag.type === null) {
      if (streamingSection === "thought") {
        emitSSE({ type: "stream:thought", objectName, taskId, chunk: lineBuffer });
      } else if (streamingSection === "talk" && streamingTalkTarget) {
        emitSSE({ type: "stream:talk", objectName, taskId, target: streamingTalkTarget, chunk: lineBuffer });
      }
    }
  }

  /* 确保流结束时关闭所有打开的段落 */
  endCurrentSection();

  return fullOutput;
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
    firedHooks.add(hookId);
  }

  if (injections.length === 0) return null;

  /* 持久化 firedHooks 到 flow.data，防止 Scheduler 多次调用时丢失 */
  flow.setFlowData("_firedHooks", Array.from(firedHooks));

  return `>>> [系统提示 — ${event}]\n${injections.join("\n\n")}`;
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
  const TRAIT_NAME_RE = /^[a-z0-9_-]+$/;

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
  if (methodRegistry) {
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
      } as MethodContext,
      "data",
      { get: () => getMergedData(), enumerable: true },
    );
    const sandboxMethods = methodRegistry.buildSandboxMethods(methodCtx);
    Object.assign(context, sandboxMethods);
  }

  /* ── 认知栈 API（G13） ── */
  tracker.register(context, [
    {
      name: "createPlan",
      fn: (title: string, description?: string) => {
        const process = createProcess(title, description);
        flow.setProcess(process);
        return process.root.id;
      },
      effect: (args, result) => `createPlan("${args[0]}") → process 已挂载 (root: ${result})`,
    },
    {
      name: "create_plan_node",
      fn: (parentId: string, title: string, description?: string, traits?: string[]) => {
        const process = flow.process;
        if (!process) return null;
        const id = addNode(process, parentId, title, undefined, description, traits);
        if (!id) return null;
        addProcessTodo(process, id, title, "plan");
        flow.setProcess({ ...process });
        return id;
      },
      effect: (args, result) => result ? `create_plan_node("${args[1]}", parent=${args[0]}) → ${result}` : `create_plan_node("${args[1]}") → 失败`,
    },
    {
      name: "finish_plan_node",
      fn: (summary: string) => {
        const process = flow.process;
        if (!process) return false;
        const currentId = process.focusId;
        /* 不能完成根节点 */
        if (currentId === process.root.id) return false;
        const ok = completeProcessNode(process, currentId, summary);
        if (ok) {
          const todo = process.todo ?? [];
          const idx = todo.findIndex((t) => t.nodeId === currentId);
          if (idx >= 0) removeProcessTodo(process, idx);
          const nextTodo = (process.todo ?? [])[0];
          if (nextTodo) {
            moveProcessFocus(process, nextTodo.nodeId);
          } else {
            advanceFocus(process);
          }
          flow.setProcess({ ...process });
        }
        return ok;
      },
      effect: (args, result) => `finish_plan_node("${args[0]}") → ${result ? "OK" : "失败"}`,
    },
    {
      name: "addStep",
      fn: (parentId: string, title: string, deps?: string[], description?: string) => {
        const process = flow.process;
        if (!process) return null;
        const id = addNode(process, parentId, title, deps, description);
        if (id) addProcessTodo(process, id, title, "plan");
        flow.setProcess({ ...process });
        return id;
      },
      effect: (args, result) => result ? `addStep("${args[1]}") → ${result}` : `addStep("${args[1]}") → 失败`,
    },
    {
      name: "completeStep",
      fn: (nodeId: string, summary: string) => {
        const process = flow.process;
        if (!process) return false;
        const ok = completeProcessNode(process, nodeId, summary);
        if (ok) {
          const todo = process.todo ?? [];
          const idx = todo.findIndex((t) => t.nodeId === nodeId);
          if (idx >= 0) removeProcessTodo(process, idx);
          const nextTodo = (process.todo ?? [])[0];
          if (nextTodo) {
            moveProcessFocus(process, nextTodo.nodeId);
          } else {
            advanceFocus(process);
          }
          flow.setProcess({ ...process });
        }
        return ok;
      },
      effect: (args, result) => `completeStep("${args[0]}") → ${result ? "OK" : "失败"}`,
    },
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
      name: "isPlanComplete",
      fn: () => {
        const process = flow.process;
        if (!process) return true;
        return isProcessComplete(process);
      },
    },
    {
      name: "removeStep",
      fn: (nodeId: string) => {
        const process = flow.process;
        if (!process) return false;
        const ok = removeProcessNode(process, nodeId);
        if (ok) {
          const todo = process.todo ?? [];
          const idx = todo.findIndex((t) => t.nodeId === nodeId);
          if (idx >= 0) removeProcessTodo(process, idx);
          flow.setProcess({ ...process });
        }
        return ok;
      },
      effect: (args, result) => `removeStep("${args[0]}") → ${result ? "OK" : "失败"}`,
    },
    {
      name: "editStep",
      fn: (nodeId: string, title: string) => {
        const process = flow.process;
        if (!process) return false;
        const ok = editProcessNode(process, nodeId, title);
        if (ok) {
          const item = (process.todo ?? []).find((t) => t.nodeId === nodeId);
          if (item) item.title = title;
          flow.setProcess({ ...process });
        }
        return ok;
      },
      effect: (args, result) => `editStep("${args[0]}", "${args[1]}") → ${result ? "OK" : "失败"}`,
    },
    /* ── 栈帧语义 API（G13 增强）── */
    {
      name: "add_stack_frame",
      fn: (parentId: string, title: string, description?: string, traits?: string[]) => {
        const process = flow.process;
        if (!process) return null;
        const id = addNode(process, parentId, title, undefined, description, traits);
        if (!id) return null;
        addProcessTodo(process, id, title, "plan");
        flow.setProcess({ ...process });
        return id;
      },
      effect: (args, result) => result ? `add_stack_frame("${args[1]}", parent=${args[0]}) → ${result}` : `add_stack_frame("${args[1]}") → 失败`,
    },
    {
      name: "stack_return",
      fn: (summary?: string, artifacts?: Record<string, unknown>) => {
        const process = flow.process;
        if (!process) return false;
        const focusNode = getFocusNode(process);
        if (!focusNode) return false;

        // Execute when_stack_pop hooks (LIFO)
        const hooks = collectFrameNodeHooks(focusNode, "when_stack_pop");
        for (const hook of hooks) {
          try {
            if (hook.type === "inject_message") {
              flow.recordAction({ type: "inject", content: `[when_stack_pop] ${hook.handler}` });
            } else if (hook.type === "create_todo") {
              addProcessTodo(process, focusNode.id, hook.handler, "manual");
            }
          } catch (e) {
            flow.recordAction({ type: "inject", content: `[hook_error] ${hook.id}: ${String(e)}` });
          }
        }

        /* 将 artifacts 写入父节点 locals（pop 后父帧可直接通过 local.key 访问） */
        if (artifacts && typeof artifacts === "object") {
          const parent = getParentNode(process.root, focusNode.id);
          if (parent) {
            if (!parent.locals) parent.locals = {};
            Object.assign(parent.locals, artifacts);
          }
        }

        const ok = completeProcessNode(process, process.focusId, summary ?? "");
        if (ok) {
          advanceFocus(process);
          flow.setProcess({ ...process });
        }
        return ok;
      },
      effect: (args, result) => {
        const artifactKeys = args[1] && typeof args[1] === "object" ? Object.keys(args[1] as object) : [];
        const artifactHint = artifactKeys.length > 0 ? ` [artifacts: ${artifactKeys.join(", ")}]` : "";
        return `stack_return("${args[0] ?? ""}")${artifactHint} → ${result ? "OK" : "失败"}`;
      },
    },
    {
      name: "go",
      fn: (nodeId: string) => {
        const process = flow.process;
        if (!process) return false;
        const result = moveProcessFocus(process, nodeId);
        if (result.success && result.yieldedNodeId) {
          const yieldedNode = findNode(process.root, result.yieldedNodeId);
          if (yieldedNode) {
            const hooks = collectFrameNodeHooks(yieldedNode, "when_yield");
            for (const hook of hooks) {
              try {
                if (hook.type === "inject_message") {
                  flow.recordAction({ type: "inject", content: `[when_yield] ${hook.handler}` });
                } else if (hook.type === "create_todo") {
                  addProcessTodo(process, yieldedNode.id, hook.handler, "manual");
                }
              } catch (e) {
                flow.recordAction({ type: "inject", content: `[hook_error] ${hook.id}: ${String(e)}` });
              }
            }
          }
        }
        flow.setProcess({ ...process });
        return result.success;
      },
      effect: (args, result) => `go("${args[0]}") → ${result ? "OK" : "失败"}`,
    },
    {
      name: "compress",
      fn: (actionIds: string[]) => {
        const process = flow.process;
        if (!process) return null;
        const childId = compressActions(process, process.focusId, actionIds);
        if (childId) flow.setProcess({ ...process });
        return childId;
      },
      effect: (args, result) => `compress(${(args[0] as string[]).length} actions) → ${result ?? "失败"}`,
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
      name: "stack_catch",
      fn: (handler: string) => {
        const process = flow.process;
        if (!process) return false;
        return createFrameHook(process, process.focusId, "when_error", "inject_message", handler);
      },
      effect: (args) => `stack_catch("${args[0]}")`,
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

  /** 热加载：trait 文件变更后立即加载到当前任务（异步，下一轮思考生效） */
  const hotReloadTrait = (name: string) => {
    if (!traits || !methodRegistry) return;
    const traitDir = join(traitsDir, name);
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
        const traitDir = join(traitsDir, name);
        if (!existsSync(traitDir)) return `[错误] trait "${name}" 不存在`;
        const r: Record<string, unknown> = { name };
        const readmePath = join(traitDir, "readme.md");
        if (existsSync(readmePath)) {
          const raw = readFileSync(readmePath, "utf-8");
          const { data, content } = matter(raw);
          r.readme = content.trim();
          r.when = data.when ?? "never";
        } else {
          r.readme = "";
          r.when = "never";
        }
        const indexPath = join(traitDir, "index.ts");
        r.code = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : null;
        return r;
      },
    },
    {
      name: "listTraits",
      fn: () => {
        if (!existsSync(traitsDir)) return [];
        return readdirSync(traitsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      },
    },
  ]);

  /* ── Trait 激活 API（G13: 写入当前 focus 节点的 activatedTraits） ── */
  tracker.register(context, [
    {
      name: "activateTrait",
      fn: (name: string) => {
        /* 校验 trait 是否存在（对象自身 traits 或 kernel traits） */
        const traitDir = join(traitsDir, name);
        const kernelDir = join(stoneDir, "..", "..", "kernel", "traits", name);
        if (!existsSync(traitDir) && !existsSync(kernelDir)) return `[错误] trait "${name}" 不存在，无法激活`;

        const process = flow.process;
        if (!process) return `[错误] 无行为树`;
        const node = findNode(process.root, process.focusId);
        if (!node) return `[错误] focus 节点不存在`;
        if (!node.activatedTraits) node.activatedTraits = [];
        if (node.activatedTraits.includes(name)) return `trait "${name}" 已在当前栈帧激活`;
        node.activatedTraits.push(name);
        flow.setProcess({ ...process });
        return `trait "${name}" 已激活到当前栈帧，下次思考时将加载完整内容`;
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
