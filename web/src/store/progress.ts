/**
 * 迭代进度状态
 *
 * 存储当前活跃 session 的 ThinkLoop 迭代进度。
 * 仅跟踪入口 Flow（用户发起的对话），忽略子 Flow。
 */
import { atom } from "jotai";

/** Flow 迭代进度 */
export interface FlowProgress {
  objectName: string;
  sessionId: string;
  iterations: number;
  maxIterations: number;
  totalIterations: number;
  maxTotalIterations: number;
}

/** 当前活跃 Flow 的迭代进度（null = 无活跃 Flow） */
export const flowProgressAtom = atom<FlowProgress | null>(null);
