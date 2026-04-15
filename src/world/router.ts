/**
 * 消息路由器 (G8 — 对象协作)
 *
 * 管理对象间的消息路由，支持 A→B 对话。
 * talk() 是同步消息投递（fire-and-forget），立即返回状态字符串。
 *
 * @ref docs/哲学文档/gene.md#G8 — implements — 对象间消息协作
 * @ref src/flow/flow.ts — references — Flow.deliverMessage 消息投递
 */

import { consola } from "consola";

/** 协作 API —— 注入到沙箱的跨对象能力 */
export interface CollaborationAPI {
  /** 向另一个对象发消息（同步投递，fire-and-forget） */
  talk: (message: string, target: string, replyTo?: string) => string;
  /** 向自己的 SelfMeta Flow 发消息（自我对话，双向） */
  talkToSelf: (message: string) => string;
  /** SelfMeta 专用：回复发起对话的 Flow（双向对话的反向通道） */
  replyToFlow: (taskId: string, message: string) => string;
}

/** Router 所需的 World 接口（避免循环依赖） */
export interface Routable {
  /**
   * 投递消息到目标对象（异步，不运行 ThinkLoop）
   * @param sessionId - 所属 session 的 ID（支持并发 session）
   */
  deliverMessage: (targetName: string, message: string, from: string, replyTo?: string, sessionId?: string) => void;
  /** 获取对象目录路径 */
  getObjectDir: (name: string) => string | null;
  /** 向对象的 SelfMeta Flow 投递消息 */
  deliverToSelfMeta: (stoneName: string, message: string, fromTaskId: string) => string;
  /** SelfMeta 回复发起对话的 Flow
   * @param sessionId - 所属 session 的 ID（支持并发 session）
   */
  deliverFromSelfMeta: (stoneName: string, targetTaskId: string, message: string, sessionId?: string) => string;
}

/** 最大对话轮次（防止无限对话） */
const MAX_ROUNDS = 100;

/** 共享轮次计数器 —— 同一 Session 内所有 CollaborationAPI 共享 */
export interface SharedRoundCounter {
  count: number;
}

/** 创建一个新的共享轮次计数器 */
export function createSharedRoundCounter(): SharedRoundCounter {
  return { count: 0 };
}

/**
 * 创建协作 API
 *
 * @param roundCounter - 可选的共享轮次计数器。同一 Session 内的所有 Flow 应共享同一个计数器，
 *                       防止 sub-flow 创建时计数器重置导致轮次限制失效。
 * @param currentFlowSessionId - 当前 Flow 的 sessionId（用于 talkToSelf 标识发起方）
 * @param sessionId - 所属 session 的 ID（支持并发 session）
 */
export function createCollaborationAPI(
  world: Routable,
  currentObjectName: string,
  _currentObjectDir: string,
  roundCounter?: SharedRoundCounter,
  currentFlowSessionId?: string,
  sessionId?: string,
): CollaborationAPI {
  /** 对话轮次计数器 —— 优先使用共享计数器，否则创建局部计数器（兼容测试场景） */
  const counter = roundCounter ?? { count: 0 };

  return {
    talk: (message: string, target: string, replyTo?: string): string => {
      counter.count++;
      if (counter.count > MAX_ROUNDS) {
        const errMsg = `[Router] 对话轮次超限 (${counter.count}/${MAX_ROUNDS})，拒绝 ${currentObjectName} → ${target}`;
        consola.warn(errMsg);
        return `[错误] 对话轮次过多，无法继续。`;
      }

      if (target === currentObjectName) {
        return "[错误] 不能向自己发消息，请使用 talkToSelf()";
      }

      consola.info(`[Router] ${currentObjectName} → ${target} (round: ${counter.count})`);

      try {
        world.deliverMessage(target, message, currentObjectName, replyTo, sessionId);
        return `[消息已发送给 ${target}]`;
      } catch (e) {
        const errMsg = `[Router] 对话失败: ${(e as Error).message}`;
        consola.error(errMsg);
        return `[错误] ${(e as Error).message}`;
      }
    },

    talkToSelf: (message: string): string => {
      if (!currentFlowSessionId) {
        return "[错误] 无法确定当前 Flow，talkToSelf 不可用";
      }
      try {
        return world.deliverToSelfMeta(currentObjectName, message, currentFlowSessionId);
      } catch (e) {
        const errMsg = `[Router] talkToSelf 失败: ${(e as Error).message}`;
        consola.error(errMsg);
        return `[错误] ${(e as Error).message}`;
      }
    },

    replyToFlow: (taskId: string, message: string): string => {
      try {
        return world.deliverFromSelfMeta(currentObjectName, taskId, message, sessionId);
      } catch (e) {
        const errMsg = `[Router] replyToFlow 失败: ${(e as Error).message}`;
        consola.error(errMsg);
        return `[错误] ${(e as Error).message}`;
      }
    },
  };
}
