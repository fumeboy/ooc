/**
 * 协作 API — 跨 Object 对话与线程内协作
 *
 * 实现 talk() 和 create_sub_thread_on_node() 两个核心协作原语。
 * 替代旧的 kernel/src/world/router.ts。
 *
 * 设计原则：
 * - talk 是复合操作：创建 W（等待节点）+ H（处理节点）+ 状态转换
 * - W 是纯占位节点（无 thread.json），H 是真正执行的线程
 * - 所有结果路由回调用方的 inbox + locals
 *
 * SuperFlow 转型（2026-04-22）：删除 talkToSelf / replyToFlow 原语。
 * 对象的反思通过通用 `talk(target="super")` 实现——world.onTalk 识别
 * super 特殊 target 后落盘到 `stones/{fromObject}/super/` 的独立 ThreadsTree。
 * 见 kernel/src/world/super.ts::handleOnTalkToSuper。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#4.2
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#9
 * @ref docs/工程管理/迭代/all/20260422_refactor_SuperFlow转型.md
 */

import { consola } from "consola";
import type {
  ThreadsTreeNodeMeta,
} from "./types.js";

/*
 * 注意：不再需要 import { enforceInboxLimits } from "./inbox.js"
 * ThreadsTree.writeInbox() 内置了溢出处理逻辑。
 * inbox.ts 的 enforceInboxLimits 仍然作为独立工具函数导出，
 * 供 Context 构建时兜底使用。
 */

/* ========== 类型定义 ========== */

/** Object 解析器 — 获取其他 Object 的线程树 */
export interface ObjectResolver {
  /** 获取指定 Object 的线程树（ThreadsTree 实例） */
  getTree(objectName: string): import("./tree.js").ThreadsTree;
  /** 检查 Object 是否存在 */
  objectExists(objectName: string): boolean;
}

/** 协作 API 的上下文（创建时注入） */
export interface CollaborationContext {
  /** 当前 Object 名称 */
  currentObjectName: string;
  /** 当前线程 ID */
  currentThreadId: string;
  /** Object 解析器 */
  resolver: ObjectResolver;
  /** Scheduler 引用（用于启动/唤醒线程） */
  scheduler: {
    startThread(objectName: string, nodeId: string): void;
    wakeThread(objectName: string, nodeId: string): void;
  };
  /** Session 目录（用于 Issue 操作） */
  sessionDir: string;
  /**
   * S2: talk 深度/轮次限制（防止无限对话循环）
   *
   * 共享轮次计数器，同一 Session 内所有 CollaborationAPI 共享。
   * 每次 talk() 调用递增，超过 maxTalkRounds 时拒绝发送。
   * 复用 Scheduler 的 maxTotalIterations 作为全局保护的上限参考。
   */
  talkRoundCounter?: SharedTalkRoundCounter;
}

/** S2: 共享 talk 轮次计数器 — 同一 Session 内所有 CollaborationAPI 共享 */
export interface SharedTalkRoundCounter {
  count: number;
}

/** S2: talk 轮次上限（防止无限对话） */
const MAX_TALK_ROUNDS = 100;

/** 协作 API 接口（注入到沙箱） */
export interface ThreadCollaborationAPI {
  /** 跨 Object 对话（async：内部调用 createSubThread） */
  talk(targetObject: string, message: string): Promise<string>;
  /** 在指定节点下创建子线程（同 Object 内，async） */
  createSubThreadOnNode(nodeId: string, message: string): Promise<string>;
}

/* ========== 核心实现 ========== */

/**
 * 创建协作 API
 *
 * 每个线程的 ThinkLoop 启动时调用一次，注入到沙箱环境。
 *
 * @param ctx - 协作上下文
 * @returns 协作 API 对象
 */
export function createCollaborationAPI(ctx: CollaborationContext): ThreadCollaborationAPI {
  return {
    async talk(targetObject: string, message: string): Promise<string> {
      return executeTalk(ctx, targetObject, message);
    },

    async createSubThreadOnNode(nodeId: string, message: string): Promise<string> {
      return executeCreateSubThreadOnNode(ctx, nodeId, message);
    },
  };
}

/**
 * talk() 实现 — 跨 Object 对话
 *
 * 完整生命周期（Spec Section 4.2）：
 * 1. 在 A（调用方）当前节点下创建子节点 W（等待占位）
 * 2. 在 B（目标方）Root 下创建子节点 H（处理节点）
 * 3. A 的当前线程进入 waiting
 * 4. H 独立执行，完成后通过 onTalkHandlerReturn 路由结果
 */
async function executeTalk(ctx: CollaborationContext, targetObject: string, message: string): Promise<string> {
  const { currentObjectName, currentThreadId, resolver, scheduler } = ctx;

  /* 校验 */
  if (targetObject === currentObjectName) {
    return "[错误] 不能向自己发消息，请使用 talk(target=\"super\") 向自己的反思分身投递";
  }
  if (!resolver.objectExists(targetObject)) {
    return `[错误] 对象 ${targetObject} 不存在`;
  }

  /* S2: talk 轮次限制检查 */
  const counter = ctx.talkRoundCounter ?? { count: 0 };
  counter.count++;
  if (counter.count > MAX_TALK_ROUNDS) {
    const errMsg = `[Collaboration] talk 轮次超限 (${counter.count}/${MAX_TALK_ROUNDS})，拒绝 ${currentObjectName} → ${targetObject}`;
    consola.warn(errMsg);
    return `[错误] 对话轮次过多（${MAX_TALK_ROUNDS}），无法继续。请检查是否存在对话循环。`;
  }

  const myTree = resolver.getTree(currentObjectName);
  const targetTree = resolver.getTree(targetObject);

  /* Step 1: 在 A 的当前节点下创建 W（等待占位节点） */
  const wId = await myTree.createSubThread(currentThreadId, `等待 ${targetObject} 回复`, {
    creatorThreadId: currentThreadId,
  });
  if (!wId) return "[错误] 创建等待节点失败（可能超过深度限制）";
  await myTree.setNodeStatus(wId, "waiting");

  /* Step 2: 在 B 的 Root 下创建 H（处理节点） */
  const targetRootId = targetTree.rootId;
  const hId = await targetTree.createSubThread(targetRootId, `处理 ${currentObjectName} 的请求`, {
    creatorThreadId: currentThreadId,
    creatorObjectName: currentObjectName,
    linkedWaitingNodeId: wId,
    linkedWaitingObjectName: currentObjectName,
    creationMode: "talk",
  });
  if (!hId) return "[错误] 创建处理节点失败";
  await targetTree.setNodeStatus(hId, "running");

  /* 将消息写入 H 的 inbox（使用 tree.writeInbox） */
  targetTree.writeInbox(hId, {
    from: currentObjectName,
    content: message,
    source: "talk",
  });

  /* Step 3: A 的当前线程进入 waiting（使用 tree.awaitThreads） */
  await myTree.awaitThreads(currentThreadId, [wId]);

  /* 记录 action（读取当前线程数据，追加 action，写回） */
  const myThreadData = myTree.readThreadData(currentThreadId);
  if (myThreadData) {
    myThreadData.actions.push({
      type: "message_out",
      content: `[talk → ${targetObject}] ${message}`,
      timestamp: Date.now(),
    });
    myTree.writeThreadData(currentThreadId, myThreadData);
  }

  /* 启动 H 的线程 */
  scheduler.startThread(targetObject, hId);

  consola.info(`[Collaboration] ${currentObjectName}:${currentThreadId} → talk(${targetObject}): W=${wId}, H=${hId}`);

  return `[消息已发送给 ${targetObject}，等待回复]`;
}

/**
 * create_sub_thread_on_node() 实现 — 在指定节点下创建子线程
 *
 * 仅限同一 Object 内。目标节点的完整 actions 历史会作为新线程的 Context。
 *
 * @ref Spec Section 4.1 — create_sub_thread_on_node
 */
async function executeCreateSubThreadOnNode(ctx: CollaborationContext, nodeId: string, message: string): Promise<string> {
  const { currentObjectName, currentThreadId, resolver, scheduler } = ctx;

  const tree = resolver.getTree(currentObjectName);

  /* 校验目标节点存在 */
  const targetNode = tree.getNode(nodeId);
  if (!targetNode) {
    return `[错误] 节点 ${nodeId} 不存在`;
  }

  /* 读取目标节点的 thread.json，获取完整 actions 历史 */
  const targetThreadData = tree.readThreadData(nodeId);
  const targetActions = targetThreadData?.actions ?? [];

  /* 在目标节点下创建子线程 */
  const subId = await tree.createSubThread(nodeId, `回忆 ${targetNode.title}`, {
    creatorThreadId: currentThreadId,
    creatorObjectName: currentObjectName,
    creationMode: "sub_thread_on_node",
  });
  if (!subId) return `[错误] 创建子线程失败（可能超过深度限制）`;
  await tree.setNodeStatus(subId, "running");

  /*
   * I2: 将目标节点的完整 actions 作为 inject action 写入新子线程的 thread.json。
   * 这样子线程的 Context 中自然包含目标节点的历史（按需回忆）。
   */
  if (targetActions.length > 0) {
    const subData = tree.readThreadData(subId);
    if (subData) {
      const injectContent = targetActions
        .map((a: any) => `[${a.type}] ${a.content ?? ""}`)
        .join("\n");
      subData.actions.push({
        type: "inject",
        content: `=== 目标节点 ${targetNode.title} 的完整历史 ===\n${injectContent}`,
        timestamp: Date.now(),
      });
      tree.writeThreadData(subId, subData);
    }
  }

  /* 将消息写入子线程的 inbox */
  tree.writeInbox(subId, {
    from: currentObjectName,
    content: message,
    source: "talk",
  });

  /* 当前线程进入 waiting */
  const currentNode = tree.getNode(currentThreadId);
  const existingAwaiting = currentNode?.awaitingChildren ?? [];
  await tree.awaitThreads(currentThreadId, [...existingAwaiting, subId]);

  /* 记录 action */
  const myThreadData = tree.readThreadData(currentThreadId);
  if (myThreadData) {
    myThreadData.actions.push({
      type: "create_thread",
      content: `[create_sub_thread_on_node(${nodeId})] ${message}`,
      timestamp: Date.now(),
    });
    tree.writeThreadData(currentThreadId, myThreadData);
  }

  /* 启动子线程 */
  scheduler.startThread(currentObjectName, subId);

  consola.info(`[Collaboration] ${currentObjectName}:${currentThreadId} → create_sub_thread_on_node(${nodeId}): sub=${subId}`);

  return subId;
}

/* ========== 回复路由 ========== */

/**
 * talk 处理节点 return 后的回调
 *
 * 由 Scheduler 的 onThreadFinished 调用。当 H 节点 return 时：
 * 1. W.status → done，W.summary = H 的 summary
 * 2. H 的 summary → 调用方线程的 inbox
 * 3. H 的 artifacts → 调用方线程的 locals
 * 4. 检查调用方的 awaitingChildren 是否全部 done → 唤醒
 *
 * @param resolver - Object 解析器
 * @param scheduler - Scheduler 引用
 * @param handlerObjectName - H 所在的 Object 名称
 * @param handlerNodeId - H 的节点 ID
 * @param summary - H 的 return summary
 * @param artifacts - H 的 return artifacts
 */
export function onTalkHandlerReturn(
  resolver: ObjectResolver,
  scheduler: { wakeThread(objectName: string, nodeId: string): void },
  handlerObjectName: string,
  handlerNodeId: string,
  summary: string,
  artifacts?: Record<string, unknown>,
): void {
  const handlerTree = resolver.getTree(handlerObjectName);
  const handlerNode = handlerTree.getNode(handlerNodeId);

  if (!handlerNode?.linkedWaitingNodeId || !handlerNode?.linkedWaitingObjectName) {
    consola.warn(`[Collaboration] onTalkHandlerReturn: H=${handlerNodeId} 没有 linked 信息，跳过`);
    return;
  }

  const callerObjectName = handlerNode.linkedWaitingObjectName;
  const waitingNodeId = handlerNode.linkedWaitingNodeId;
  const callerTree = resolver.getTree(callerObjectName);

  /* Step 1: W.status → done + summary */
  callerTree.setNodeStatus(waitingNodeId, "done");
  callerTree.updateNodeMeta(waitingNodeId, { summary });

  /* Step 2: 找到调用方线程（W 的 creatorThreadId） */
  const wNode = callerTree.getNode(waitingNodeId);
  const callerThreadId = wNode?.creatorThreadId;
  if (!callerThreadId) {
    consola.warn(`[Collaboration] onTalkHandlerReturn: W=${waitingNodeId} 没有 creatorThreadId`);
    return;
  }

  /* 写入调用方线程的 inbox（使用 tree.writeInbox） */
  callerTree.writeInbox(callerThreadId, {
    from: handlerObjectName,
    content: `[${handlerObjectName} 回复] ${summary}`,
    source: "talk",
  });

  /* Step 3: artifacts → 调用方线程的 locals */
  if (artifacts && Object.keys(artifacts).length > 0) {
    const callerThreadData = callerTree.readThreadData(callerThreadId);
    if (callerThreadData) {
      callerThreadData.locals = { ...(callerThreadData.locals ?? {}), ...artifacts };
      callerTree.writeThreadData(callerThreadId, callerThreadData);
    }
  }

  /* Step 4: 检查 awaitingChildren 是否全部 done → 唤醒 */
  callerTree.checkAndWake(callerThreadId).then((woken) => {
    if (woken) {
      scheduler.wakeThread(callerObjectName, callerThreadId);
      consola.info(`[Collaboration] 唤醒 ${callerObjectName}:${callerThreadId}（awaitingChildren 全部完成）`);
    }
  });
}

/* ========== Issue 协作 ========== */

import * as discussion from "../kanban/discussion.js";

/**
 * commentOnIssue + 自动通知被 @的对象
 *
 * 当 commentOnIssue 时 @某人：
 * 1. 调用现有 kanban/discussion.commentOnIssue 发表评论
 * 2. 对每个被 @的对象，检查其 Root 下是否已有该 Issue 的 thread
 * 3. 如果没有 → 创建 issue thread + inbox 通知 + 启动线程
 * 4. 如果已有 → 仅追加 inbox 通知
 *
 * Issue thread 的去重标记：description 包含 "[issue:{issueId}]"
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#9.2
 */
export async function commentOnIssueWithNotify(
  sessionDir: string,
  resolver: ObjectResolver,
  scheduler: { startThread(objectName: string, nodeId: string): void },
  issueId: string,
  author: string,
  content: string,
  mentions?: string[],
): Promise<void> {
  /* Step 1: 发表评论（复用现有 kanban 逻辑） */
  const { comment, mentionTargets } = await discussion.commentOnIssue(
    sessionDir, issueId, author, content, mentions,
  );

  /* Step 2: 对每个被 @的对象，创建或追加 issue thread */
  for (const targetName of mentionTargets) {
    if (!resolver.objectExists(targetName)) continue;

    const targetTree = resolver.getTree(targetName);
    const targetRootId = targetTree.rootId;

    /* 检查是否已有该 Issue 的 thread（去重） */
    const issueTag = `[issue:${issueId}]`;
    const existingChildren = targetTree.getChildren(targetRootId);
    let issueThread = existingChildren.find(
      (n) => n.description?.includes(issueTag),
    );

    if (!issueThread) {
      /* 创建新的 issue thread（使用 createSubThread，ID 由内部生成） */
      const threadId = await targetTree.createSubThread(targetRootId, `Issue ${issueId} 讨论`, {
        description: `${issueTag} 来自 ${author} 的讨论邀请`,
      });
      if (!threadId) continue;
      await targetTree.setNodeStatus(threadId, "running");
      issueThread = targetTree.getNode(threadId)!;

      /* 启动线程 */
      scheduler.startThread(targetName, threadId);
    }

    /* 追加 inbox 通知（使用 tree.writeInbox，内置溢出处理） */
    targetTree.writeInbox(issueThread.id, {
      from: author,
      content: `[Issue ${issueId}] ${author}: ${content}`,
      source: "issue",
      issueId,
    });
  }
}
