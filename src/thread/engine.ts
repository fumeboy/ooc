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
    const inboxLines = ctx.inbox.map(m => `- [${m.from}] ${m.content}`).join("\n");
    userParts.push(`## 未读消息\n${inboxLines}`);
  }

  /* todos */
  if (ctx.todos.length > 0) {
    const todoLines = ctx.todos.map(t => `- [ ] ${t.content}`).join("\n");
    userParts.push(`## 待办\n${todoLines}`);
  }

  /* 子节点摘要 */
  if (ctx.childrenSummary) {
    userParts.push(`## 子线程\n${ctx.childrenSummary}`);
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

  /* 6. 写回线程数据 */
  tree.writeThreadData(threadId, threadData);

  /* 7. 创建子线程 */
  if (result.newChildNode) {
    const child = result.newChildNode;
    const childId = await tree.createSubThread(threadId, child.title, {
      traits: child.traits,
      description: child.description,
      creatorThreadId: threadId,
    });

    if (childId) {
      /* 设置子线程为 running */
      await tree.setNodeStatus(childId, "running");

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

  /* 8. 处理状态变更 */
  if (result.statusChange === "done" && result.returnResult) {
    await tree.returnThread(
      threadId,
      result.returnResult.summary,
      result.returnResult.artifacts,
    );
  } else if (result.statusChange === "waiting" && result.awaitingChildren) {
    await tree.awaitThreads(threadId, result.awaitingChildren);
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

      /* 发射 SSE 思考事件 */
      if (llmResult.thinkingContent) {
        emitSSE({
          type: "stream:thought",
          objectName,
          sessionId,
          chunk: llmResult.thinkingContent,
        });
      }

      /* 解析 LLM 输出 */
      const iterResult = runThreadIteration({
        tree: treeFile,
        threadId,
        threadData,
        llmOutput: llmResult.content,
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
