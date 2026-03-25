/**
 * 多线程管理 — Process Tree 的多 focus cursor
 *
 * 每个线程是一个独立的 focus cursor，可以在行为树上独立推进。
 * 默认两个线程：frontend（对外沟通）、backend（内部工作）。
 *
 * @ref .ooc/docs/哲学文档/meta.md — implements — 多线程概念
 */

import type { Process, ThreadState, Signal } from "../types/index.js";
import { findNode } from "./tree.js";
import type { MoveFocusResult } from "./focus.js";

/**
 * 初始化默认线程（frontend + backend）
 *
 * 如果 process.threads 已存在且非空，不做任何操作。
 * 两个线程都指向 process.focusId（当前 focus 节点）。
 * frontend 默认为 running，backend 默认为 yielded。
 *
 * @param process 行为树
 * @returns 是否执行了初始化
 */
export function initDefaultThreads(process: Process): boolean {
  if (process.threads && Object.keys(process.threads).length > 0) return false;

  process.threads = {};
  const focusId = process.focusId;

  process.threads["frontend"] = {
    name: "frontend",
    focusId,
    status: "running",
    signals: [],
  };

  process.threads["backend"] = {
    name: "backend",
    focusId,
    status: "yielded",
    signals: [],
  };

  return true;
}

function generateSignalId(): string {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 创建新线程
 * @param process 行为树
 * @param name 线程名称（唯一）
 * @param focusId 初始 focus 节点 ID
 * @returns 是否创建成功
 */
export function createThread(
  process: Process,
  name: string,
  focusId: string,
): boolean {
  if (!process.threads) process.threads = {};
  if (process.threads[name]) return false; // 已存在
  const node = findNode(process.root, focusId);
  if (!node) return false;

  process.threads[name] = {
    name,
    focusId,
    status: "running",
    signals: [],
  };
  return true;
}

/**
 * 获取线程状态
 */
export function getThread(process: Process, name: string): ThreadState | null {
  return process.threads?.[name] ?? null;
}

/**
 * 列出所有线程
 */
export function listThreads(process: Process): ThreadState[] {
  if (!process.threads) return [];
  return Object.values(process.threads);
}

/**
 * 向目标线程发送 signal
 * @param process 行为树
 * @param fromThread 发送方线程名
 * @param toThread 接收方线程名
 * @param content 消息内容
 * @returns signal ID，失败返回 null
 */
export function sendSignal(
  process: Process,
  fromThread: string,
  toThread: string,
  content: string,
): string | null {
  const from = process.threads?.[fromThread];
  const to = process.threads?.[toThread];
  if (!from || !to) return null;

  const signal: Signal = {
    id: generateSignalId(),
    from: fromThread,
    content,
    timestamp: Date.now(),
    acked: false,
  };
  to.signals.push(signal);
  return signal.id;
}

/**
 * 确认收到 signal，附加 memo
 * @param process 行为树
 * @param threadName 当前线程名
 * @param signalId signal ID
 * @param memo 确认时附加的记忆信息
 * @returns 是否成功
 */
export function ackSignal(
  process: Process,
  threadName: string,
  signalId: string,
  memo?: string,
): boolean {
  const thread = process.threads?.[threadName];
  if (!thread) return false;
  const signal = thread.signals.find(s => s.id === signalId);
  if (!signal || signal.acked) return false;
  signal.acked = true;
  if (memo) signal.ackMemo = memo;
  return true;
}

/**
 * 线程级 focus 移动
 *
 * 1. 将目标线程设为 running
 * 2. 如果当前活跃线程不同，将其设为 yielded（触发 when_yield hooks）
 * 3. 更新 process.focusId 为目标线程的 focusId
 *
 * @param process 行为树
 * @param threadName 目标线程名
 * @param nodeId 可选：同时移动线程内 focus 到指定节点
 * @returns MoveFocusResult
 */
export function goThread(
  process: Process,
  threadName: string,
  nodeId?: string,
): MoveFocusResult {
  const thread = process.threads?.[threadName];
  if (!thread) return { success: false };
  if (thread.status === "finished") return { success: false };

  /* 找到当前 running 的线程 */
  const currentRunning = Object.values(process.threads ?? {}).find(t => t.status === "running");

  /* 切换线程时，yield 当前线程 */
  let yieldedNodeId: string | undefined;
  if (currentRunning && currentRunning.name !== threadName) {
    currentRunning.status = "yielded";
    const yieldedNode = findNode(process.root, currentRunning.focusId);
    if (yieldedNode && yieldedNode.status === "doing") {
      yieldedNodeId = yieldedNode.id;
    }
  }

  /* 激活目标线程 */
  thread.status = "running";

  /* 如果指定了 nodeId，移动线程内 focus */
  if (nodeId) {
    const node = findNode(process.root, nodeId);
    if (!node) return { success: false };
    thread.focusId = nodeId;
  }

  /* 同步 process.focusId */
  process.focusId = thread.focusId;

  return { success: true, yieldedNodeId };
}
