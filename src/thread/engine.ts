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

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { consola } from "consola";

import { ThreadsTree } from "./tree.js";
import { ThreadScheduler, type SchedulerCallbacks } from "./scheduler.js";
import { buildThreadContext, type ThreadContextInput } from "./context-builder.js";
import { runThreadIteration, type ThreadIterationInput } from "./thinkloop.js";
import { emitSSE } from "../server/events.js";
import { CodeExecutor, executeShell } from "../executable/executor.js";
import { MethodRegistry, type MethodContext } from "../trait/registry.js";
import { getActiveTraits, traitId } from "../trait/activator.js";

import type { LLMClient, Message } from "../thinkable/client.js";
import type { StoneData, DirectoryEntry, TraitDefinition, ContextWindow } from "../types/index.js";
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
   * @returns 目标对象的回复（summary）
   */
  onTalk?: (targetObject: string, message: string, fromObject: string, fromThreadId: string, sessionId: string) => Promise<string | null>;
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
}

/* ========== 辅助函数 ========== */

/** 生成 session ID */
function generateSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ========== Context → LLM Messages 转换 ========== */

/**
 * 将 ThreadContext 转换为 LLM Messages
 *
 * 构建 system + user 两条消息：
 * - system: whoAmI + instructions + knowledge
 * - user: parentExpectation + process + inbox + todos + childrenSummary + directory
 */
function contextToMessages(ctx: ReturnType<typeof buildThreadContext>): Message[] {
  const systemParts: string[] = [];

  /* 身份 */
  systemParts.push(`# 你是 ${ctx.name}`);
  systemParts.push(ctx.whoAmI);

  /* 系统指令窗口 */
  for (const w of ctx.instructions) {
    systemParts.push(`\n## [指令] ${w.name}\n${w.content}`);
  }

  /* 知识窗口 */
  for (const w of ctx.knowledge) {
    systemParts.push(`\n## [知识] ${w.name}\n${w.content}`);
  }

  const userParts: string[] = [];

  /* 父线程期望 */
  if (ctx.parentExpectation) {
    userParts.push(`## 任务\n${ctx.parentExpectation}`);
  }

  /* 创建者信息 — 告诉 LLM 该向谁返回结果 */
  if (ctx.creationMode === "root") {
    userParts.push(`## 创建者\n你是根线程，由用户(human)发起。完成任务后必须用 [return] 返回最终结果。[talk] 只用于向其他对象发消息，不会结束线程。`);
  } else {
    userParts.push(`## 创建者\n你由 ${ctx.creator} 创建（${ctx.creationMode}）。完成任务后必须用 [return] 返回结果给创建者。[talk] 只用于向其他对象发消息，不会结束线程。`);
  }

  /* 当前计划 */
  if (ctx.plan) {
    userParts.push(`## 当前计划\n${ctx.plan}`);
  }

  /* 执行历史 */
  userParts.push(`## 执行历史\n${ctx.process}`);

  /* 局部变量 */
  if (Object.keys(ctx.locals).length > 0) {
    userParts.push(`## 局部变量\n${JSON.stringify(ctx.locals, null, 2)}`);
  }

  /* inbox */
  if (ctx.inbox.length > 0) {
    const inboxLines = ctx.inbox
      .map(m => `- #${m.id} [${m.from}] ${m.content}`)
      .join("\n");
    userParts.push(`## 未读消息\n${inboxLines}`);
  }

  /* todos */
  if (ctx.todos.length > 0) {
    const todoLines = ctx.todos.map(t => `- [ ] ${t.content}`).join("\n");
    userParts.push(`## 待办\n${todoLines}`);
  }

  /* 子节点摘要 */
  if (ctx.childrenSummary) {
    /* 检查是否所有子线程都已完成 */
    const allDone = ctx.childrenSummary.includes("[done]") && !ctx.childrenSummary.includes("[running]") && !ctx.childrenSummary.includes("[pending]") && !ctx.childrenSummary.includes("[waiting]");
    let hint = "";
    if (allDone) {
      hint = "\n\n所有子线程已完成。请汇总子线程的结果，然后用 [return] 返回最终结果。";
    }
    userParts.push(`## 子线程\n${ctx.childrenSummary}${hint}`);
  }

  /* 祖先摘要 */
  if (ctx.ancestorSummary) {
    userParts.push(`## 上级线程\n${ctx.ancestorSummary}`);
  }

  /* 兄弟摘要 */
  if (ctx.siblingSummary) {
    userParts.push(`## 兄弟线程\n${ctx.siblingSummary}`);
  }

  /* 通讯录 */
  if (ctx.directory.length > 0) {
    const dirLines = ctx.directory.map(d => `- ${d.name}: ${d.whoAmI}`).join("\n");
    userParts.push(`## 通讯录\n${dirLines}`);
  }

  /* 沙箱路径 */
  if (ctx.paths && Object.keys(ctx.paths).length > 0) {
    userParts.push(`## 路径\n${JSON.stringify(ctx.paths)}`);
  }

  /* 状态 */
  userParts.push(`## 状态: ${ctx.status}`);

  return [
    { role: "system", content: systemParts.join("\n\n") },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/* ========== 应用迭代结果 ========== */

/**
 * 将 ThinkLoop 迭代结果应用到线程树
 *
 * 纯副作用函数：更新 threadData、tree 状态、创建子线程。
 * 返回新创建的子线程 ID（如有），供 Scheduler 启动。
 */
async function applyIterationResult(
  tree: ThreadsTree,
  threadId: string,
  result: ReturnType<typeof runThreadIteration>,
  objectName: string,
  sessionId: string,
  scheduler: ThreadScheduler,
): Promise<void> {
  /* 1. 读取当前线程数据 */
  const threadData = tree.readThreadData(threadId);
  if (!threadData) return;

  /* 2. 追加新 actions */
  threadData.actions.push(...result.newActions);

  /* ID 映射表：thinkloop 假 ID → tree 真实 ID（当前轮次内） */
  const idMap = new Map<string, string>();

  /* 3. 更新计划 */
  if (result.planUpdate !== null) {
    threadData.plan = result.planUpdate;
  }

  /* 4. 处理 inbox 更新 */
  for (const update of result.inboxUpdates) {
    tree.markInbox(threadId, update.messageId, update.mark.type, update.mark.tip);
  }

  /* 5. 处理新待办 */
  for (const todo of result.newTodos) {
    tree.addTodo(threadId, todo.content, todo.sourceMessageId);
  }

  /* 6. 创建子线程（在写回 threadData 之前，因为需要替换假 ID） */
  if (result.newChildNode) {
    const child = result.newChildNode;
    /* deriveFrom 决定子线程挂在哪个节点下 */
    const parentForChild = child.deriveFrom ?? threadId;
    const childId = await tree.createSubThread(parentForChild, child.title, {
      traits: child.traits,
      description: child.description,
      creatorThreadId: threadId,
      creationMode: child.deriveFrom ? "sub_thread_on_node" : "sub_thread",
    });

    if (childId) {
      /* 将 action 日志中 thinkloop 生成的假 ID 替换为 tree 生成的真实 ID */
      const fakeId = child.id;
      if (fakeId !== childId) {
        idMap.set(fakeId, childId);
        for (const action of threadData.actions) {
          if (action.content?.includes(fakeId)) {
            action.content = action.content.replace(fakeId, childId);
          }
        }
      }

      /* 设置子线程为 running */
      await tree.setNodeStatus(childId, "running");

      /* deriveFrom 模式：将目标线程的 actions 注入子线程（让子线程看到目标线程的历史） */
      if (child.deriveFrom) {
        const targetData = tree.readThreadData(child.deriveFrom);
        if (targetData && targetData.actions.length > 0) {
          const childData = tree.readThreadData(childId);
          if (childData) {
            const summary = targetData.actions
              .filter(a => a.type === "thought" || a.type === "thread_return" || a.type === "program")
              .map(a => `[${a.type}] ${a.content?.slice(0, 200)}`)
              .join("\n");
            if (summary) {
              childData.actions.push({
                type: "inject",
                content: `[派生自线程 ${child.deriveFrom} 的历史]\n${summary}`,
                timestamp: Date.now(),
              });
              tree.writeThreadData(childId, childData);
            }
          }
        }
      }

      /* 注入 before hook */
      if (result.beforeHookInjection) {
        const childData = tree.readThreadData(childId);
        if (childData) {
          childData.actions.push({
            type: "inject",
            content: result.beforeHookInjection,
            timestamp: Date.now(),
          });
          tree.writeThreadData(childId, childData);
        }
      }

      /* 通知 Scheduler 启动新线程 */
      scheduler.onThreadCreated(childId, objectName);

      /* 发射 SSE 事件 */
      emitSSE({ type: "flow:action", objectName, sessionId, action: {
        type: "action",
        content: `[create_sub_thread] ${child.title}`,
        timestamp: Date.now(),
      } as any });
    }
  }

  /* 6b. 执行 continue_sub_thread（向已有子线程追加消息并唤醒） */
  if (result.continueSubThread) {
    const { threadId: targetId, message } = result.continueSubThread;
    const targetNode = tree.getNode(targetId);

    if (targetNode) {
      /* 写入目标线程的 inbox */
      tree.writeInbox(targetId, {
        from: objectName,
        content: message,
        source: "talk",
      });

      /* 如果目标线程已完成（done/failed），唤醒为 running */
      if (targetNode.status === "done" || targetNode.status === "failed") {
        await tree.setNodeStatus(targetId, "running");
        scheduler.onThreadCreated(targetId, objectName);
      }
      /* 如果目标线程正在 running，消息已写入 inbox，下一轮自然看到 */

      emitSSE({ type: "flow:action", objectName, sessionId, action: {
        type: "action",
        content: `[continue_sub_thread] → ${targetId}`,
        timestamp: Date.now(),
      } as any });
    }
  }

  /* 7. 写回线程数据（在子线程创建和 ID 替换之后） */
  tree.writeThreadData(threadId, threadData);

  /* 8. 处理状态变更 */
  if (result.statusChange === "done" && result.returnResult) {
    await tree.returnThread(
      threadId,
      result.returnResult.summary,
      result.returnResult.artifacts,
    );
  } else if (result.statusChange === "waiting" && result.awaitingChildren) {
    /* 翻译假 ID → 真实 ID（处理同一轮内 create + await 的情况） */
    const realIds = result.awaitingChildren.map(id => idMap.get(id) ?? id);
    await tree.awaitThreads(threadId, realIds);
  } else if (result.statusChange === "failed") {
    await tree.setNodeStatus(threadId, "failed");
  }

  /* 9. 处理 after hook 注入（return 时注入到创建者线程） */
  if (result.afterHookInjection) {
    const nodeMeta = tree.getNode(threadId);
    if (nodeMeta?.creatorThreadId) {
      const creatorData = tree.readThreadData(nodeMeta.creatorThreadId);
      if (creatorData) {
        creatorData.actions.push({
          type: "inject",
          content: result.afterHookInjection,
          timestamp: Date.now(),
        });
        tree.writeThreadData(nodeMeta.creatorThreadId, creatorData);
      }
    }
  }
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
 * @returns 执行结果
 */
export async function runWithThreadTree(
  objectName: string,
  message: string,
  from: string,
  config: EngineConfig,
): Promise<TalkResult> {
  const sessionId = generateSessionId();
  const sessionDir = join(config.flowsDir, sessionId);
  const objectFlowDir = join(sessionDir, "objects", objectName);
  mkdirSync(objectFlowDir, { recursive: true });

  consola.info(`[Engine] 开始执行 ${objectName}, session=${sessionId}`);

  /* 1. 创建 ThreadsTree + Root 线程 */
  const tree = await ThreadsTree.create(objectFlowDir, `${objectName} 主线程`, message);

  /* 2. 将初始消息写入 Root 线程的 inbox */
  tree.writeInbox(tree.rootId, {
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
    const printFn = (...args: unknown[]) => { outputs.push(args.map(String).join(" ")); };

    const stoneDir = config.paths?.stoneDir ?? "";
    const rootDir = config.paths?.rootDir ?? config.rootDir;

    const context: Record<string, unknown> = {
      /* 基础路径 */
      self_dir: stoneDir,
      self_files_dir: join(stoneDir, "files"),
      world_dir: rootDir,
      filesDir: join(objectFlowDir, "files"),

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

    /* 注入 Trait 方法 */
    const scopeChain = tree.getNode(threadId)?.traits ?? [];
    const activeTraitNames = getActiveTraits(config.traits, scopeChain).map(t => traitId(t));
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
    const sandboxMethods = methodRegistry.buildSandboxMethods(methodCtx, activeTraitNames);
    Object.assign(context, sandboxMethods);

    return { context, getOutputs: () => outputs };
  };

  /* 5. 创建 Scheduler */
  const scheduler = new ThreadScheduler({
    maxIterationsPerThread: config.schedulerConfig?.maxIterationsPerThread ?? 100,
    maxTotalIterations: config.schedulerConfig?.maxTotalIterations ?? 500,
    deadlockGracePeriodMs: config.schedulerConfig?.deadlockGracePeriodMs ?? 30_000,
  });

  /* 6. 检查暂停 */
  if (config.isPaused?.(objectName)) {
    scheduler.pauseObject(objectName);
  }

  /* 7. 创建 SchedulerCallbacks */
  const callbacks: SchedulerCallbacks = {
    runOneIteration: async (threadId: string, _objectName: string) => {
      totalIterations++;

      /* 读取线程数据 */
      const threadData = tree.readThreadData(threadId);
      if (!threadData) {
        throw new Error(`线程数据不存在: ${threadId}`);
      }

      /* 读取树的内部结构用于 Context 构建 */
      const treeFile = buildTreeFileSnapshot(tree);

      let llmOutput: string;
      let thinkingContent: string | undefined;

      /* 检查是否有缓存的 LLM 输出（resume 模式） */
      if (threadData._pendingOutput) {
        llmOutput = threadData._pendingOutput;
        thinkingContent = threadData._pendingThinkingOutput;

        /* 清除缓存 */
        delete threadData._pendingOutput;
        delete threadData._pendingThinkingOutput;
        tree.writeThreadData(threadId, threadData);

        consola.info(`[Engine] 使用缓存输出 (resume), thread=${threadId}`);
      } else {
        /* 构建 Context */
        const context = buildThreadContext({
          tree: treeFile,
          threadId,
          threadData,
          stone: config.stone,
          directory: config.directory,
          traits: config.traits,
          extraWindows: config.extraWindows,
          paths: config.paths,
        });

        /* 转换为 LLM Messages */
        const messages = contextToMessages(context);

        /* 调用 LLM */
        const llmResult = await config.llm.chat(messages);
        llmOutput = llmResult.content;
        thinkingContent = llmResult.thinkingContent;

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

          consola.info(`[Engine] 暂停 thread=${threadId}, 输出已缓存`);

          /* 通知 scheduler 暂停此对象 */
          scheduler.pauseObject(objectName);
          return;
        }
      }

      /* 发射 SSE 思考事件 */
      if (thinkingContent) {
        emitSSE({
          type: "stream:thought",
          objectName,
          sessionId,
          chunk: thinkingContent,
        });
      }

      /* 解析 LLM 输出 */
      const iterResult = runThreadIteration({
        tree: treeFile,
        threadId,
        threadData,
        llmOutput,
        stone: config.stone,
        traits: config.traits,
      });

      /* 应用结果到 tree */
      await applyIterationResult(tree, threadId, iterResult, objectName, sessionId, scheduler);

      /* 执行 program（如果有） */
      if (iterResult.program && iterResult.program.code) {
        const { context: execCtx, getOutputs } = buildExecContext(threadId);
        const lang = (iterResult.program as any).lang ?? "javascript";

        let execResult;
        if (lang === "shell") {
          execResult = await executeShell(iterResult.program.code, config.rootDir);
        } else {
          execResult = await executor.execute(iterResult.program.code, execCtx);
        }

        /* 收集输出 */
        const printOutputs = getOutputs();
        const allOutputs = [...printOutputs];
        if (execResult.stdout) allOutputs.push(execResult.stdout);
        if (execResult.returnValue !== null && execResult.returnValue !== undefined) {
          allOutputs.push(typeof execResult.returnValue === "string"
            ? execResult.returnValue
            : JSON.stringify(execResult.returnValue, null, 2));
        }
        const outputText = allOutputs.join("\n").trim();

        /* 记录 program action */
        const td = tree.readThreadData(threadId);
        if (td) {
          td.actions.push({
            type: "program",
            content: iterResult.program.code,
            success: execResult.success,
            result: execResult.success
              ? (outputText ? `>>> output:\n${outputText}` : ">>> output: (无输出)")
              : `>>> error: ${execResult.error}`,
            timestamp: Date.now(),
          });
          tree.writeThreadData(threadId, td);
        }

        consola.info(`[Engine] program ${execResult.success ? "成功" : "失败"}: ${outputText.slice(0, 200) || execResult.error?.slice(0, 200)}`);
      }

      /* 执行 talk（如果有） */
      if (iterResult.talks && config.onTalk) {
        const talk = iterResult.talks;
        const target = talk.target?.toLowerCase();

        /* talk 内联 mark（如果存在） */
        const explicitMarkIds = ((talk as any)?.mark?.message_ids as string[] | undefined) ?? [];

        /* 跳过 talk to self（当前 Object） */
        if (target !== objectName.toLowerCase()) {
          consola.info(`[Engine] talk ${objectName} → ${talk.target}: ${talk.message.slice(0, 100)}`);

          /* 记录 outbound message action */
          const td = tree.readThreadData(threadId);
          if (td) {
            td.actions.push({
              type: "message_out",
              content: `[talk] → ${talk.target}: ${talk.message}`,
              timestamp: Date.now(),
            });
            tree.writeThreadData(threadId, td);
          }

          /* 调用 World 路由 */
          try {
            const reply = await config.onTalk(talk.target, talk.message, objectName, threadId, sessionId);

            /*
             * 兜底：当且仅当满足以下条件时，自动 ack 已回复消息
             * - talk 没有显式 mark
             * - target 对应的未读消息只有 1 条
             * - 该未读消息是 target 发给我的最新一条消息
             */
            if (explicitMarkIds.length === 0) {
              const td = tree.readThreadData(threadId);
              const autoAckId = getAutoAckMessageId(td, talk.target);
              if (autoAckId) {
                tree.markInbox(threadId, autoAckId, "ack", "已回复");
              }
            }

            /* 将回复写入当前线程的 inbox */
            if (reply) {
              tree.writeInbox(threadId, {
                from: talk.target,
                content: reply,
                source: "talk",
              });
            }
          } catch (e) {
            consola.error(`[Engine] talk 失败: ${(e as Error).message}`);
            tree.writeInbox(threadId, {
              from: "system",
              content: `[talk 失败] ${talk.target}: ${(e as Error).message}`,
              source: "system",
            });
          }
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

  /* 9. 读取 Root 节点最终状态 */
  const rootNode = tree.getNode(tree.rootId);
  const finalStatus = rootNode?.status ?? "failed";

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
    summary: rootNode?.summary,
    totalIterations,
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
    const printFn = (...args: unknown[]) => { outputs.push(args.map(String).join(" ")); };
    const stoneDir = config.paths?.stoneDir ?? "";
    const rootDir = config.paths?.rootDir ?? config.rootDir;

    const context: Record<string, unknown> = {
      self_dir: stoneDir,
      self_files_dir: join(stoneDir, "files"),
      world_dir: rootDir,
      filesDir: join(objectFlowDir, "files"),
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

    const scopeChain = tree.getNode(threadId)?.traits ?? [];
    const activeTraitNames = getActiveTraits(config.traits, scopeChain).map(t => traitId(t));
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
    Object.assign(context, methodRegistry.buildSandboxMethods(methodCtx, activeTraitNames));
    return { context, getOutputs: () => outputs };
  };

  const scheduler = new ThreadScheduler({
    maxIterationsPerThread: config.schedulerConfig?.maxIterationsPerThread ?? 100,
    maxTotalIterations: config.schedulerConfig?.maxTotalIterations ?? 500,
    deadlockGracePeriodMs: config.schedulerConfig?.deadlockGracePeriodMs ?? 30_000,
  });

  const callbacks: SchedulerCallbacks = {
    runOneIteration: async (threadId: string, _objectName: string) => {
      totalIterations++;
      const threadData = tree.readThreadData(threadId);
      if (!threadData) throw new Error(`线程数据不存在: ${threadId}`);

      const treeFile = buildTreeFileSnapshot(tree);
      let llmOutput: string;
      let thinkingContent: string | undefined;

      if (threadData._pendingOutput) {
        llmOutput = threadData._pendingOutput;
        thinkingContent = threadData._pendingThinkingOutput;
        delete threadData._pendingOutput;
        delete threadData._pendingThinkingOutput;
        tree.writeThreadData(threadId, threadData);
        consola.info(`[Engine] 使用缓存输出 (resume), thread=${threadId}`);
      } else {
        const context = buildThreadContext({
          tree: treeFile, threadId, threadData,
          stone: config.stone, directory: config.directory,
          traits: config.traits, extraWindows: config.extraWindows, paths: config.paths,
        });
        const messages = contextToMessages(context);
        const llmResult = await config.llm.chat(messages);
        llmOutput = llmResult.content;
        thinkingContent = llmResult.thinkingContent;

        if (config.isPaused?.(objectName)) {
          threadData._pendingOutput = llmOutput;
          if (thinkingContent) threadData._pendingThinkingOutput = thinkingContent;
          tree.writeThreadData(threadId, threadData);
          scheduler.pauseObject(objectName);
          return;
        }
      }

      if (thinkingContent) {
        emitSSE({ type: "stream:thought", objectName, sessionId, chunk: thinkingContent });
      }

      const iterResult = runThreadIteration({
        tree: treeFile, threadId, threadData, llmOutput,
        stone: config.stone, traits: config.traits,
      });

      await applyIterationResult(tree, threadId, iterResult, objectName, sessionId, scheduler);

      if (iterResult.program?.code) {
        const { context: execCtx, getOutputs } = buildExecContext(threadId);
        const lang = (iterResult.program as any).lang ?? "javascript";
        const execResult = lang === "shell"
          ? await executeShell(iterResult.program.code, config.rootDir)
          : await executor.execute(iterResult.program.code, execCtx);

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
            type: "program", content: iterResult.program.code,
            success: execResult.success,
            result: execResult.success
              ? (outputText ? `>>> output:\n${outputText}` : ">>> output: (无输出)")
              : `>>> error: ${execResult.error}`,
            timestamp: Date.now(),
          });
          tree.writeThreadData(threadId, td);
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
  return { sessionId, status: finalStatus, summary: rootNode?.summary, totalIterations };
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
