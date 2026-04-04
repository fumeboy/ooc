import { atom } from "jotai";
import type { FlowSummary, FlowData, FileTreeNode } from "../api/types";
import type { SSEEvent } from "../api/types";

/** 当前页面标签 */
export type AppTab = "flows" | "stones" | "world";
export const activeTabAtom = atom<AppTab>("flows");

/** 命令面板是否打开 */
export const commandPaletteOpenAtom = atom<boolean>(false);

/** user 的 effects 列表（会话列表） */
export const userSessionsAtom = atom<FlowSummary[]>([]);

/** 当前活跃会话的 sessionId */
export const activeSessionIdAtom = atom<string | null>(null);

/** 当前活跃会话的 Flow 详情 */
export const activeSessionFlowAtom = atom<FlowData | null>(null);

/** Effects 边栏是否打开 */
export const effectsSidebarOpenAtom = atom<boolean>(false);

/** SSE 连接状态 */
export const sseConnectedAtom = atom<boolean>(false);

/** 最新的 SSE flow 事件（用于组件订阅实时更新） */
export const lastFlowEventAtom = atom<SSEEvent | null>(null);

/** Chat 模式下，网站左边栏选中的参与对象（用于过滤消息/process） */
export const chatSelectedObjectAtom = atom<string | null>(null);

/** 流式 thought 内容（来自 provider 原生 thinking 通道，逐步累积） */
export const streamingThoughtAtom = atom<{ sessionId: string; content: string } | null>(null);

/** 流式 talk 内容（逐步累积） */
export const streamingTalkAtom = atom<{ sessionId: string; target: string; from: string; content: string } | null>(null);

/** 流式 program 内容（逐步累积） */
export const streamingProgramAtom = atom<{ sessionId: string; lang?: "javascript" | "shell"; content: string } | null>(null);

/** 流式 action 内容（逐步累积） */
export const streamingActionAtom = atom<{ sessionId: string; toolName: string; content: string } | null>(null);

/** 流式 stack_push 内容（逐步累积） */
export const streamingStackPushAtom = atom<{ sessionId: string; opType: "cognize" | "reflect"; attr: string; content: string } | null>(null);

/** 流式 stack_pop 内容（逐步累积） */
export const streamingStackPopAtom = atom<{ sessionId: string; opType: "cognize" | "reflect"; attr: string; content: string } | null>(null);

/** 流式 set_plan 内容（逐步累积） */
export const streamingSetPlanAtom = atom<{ sessionId: string; content: string } | null>(null);

/** Chat Ref 引用列表（用户通过 Ref 按钮收集的引用） */
export interface ChatRef {
  id: string;
  objectName: string;
}
export const chatRefsAtom = atom<ChatRef[]>([]);

/** 当前打开的文件 tabs（路径列表） */
export interface EditorTab {
  path: string;
  label: string;
}
export const editorTabsAtom = atom<EditorTab[]>([]);

/** 当前激活的 tab 路径 */
export const activeFilePathAtom = atom<string | null>(null);

/** 侧边栏文件树缓存 */
export const sidebarTreeAtom = atom<FileTreeNode | null>(null);

/** 刷新计数器：递增触发 ViewRouter 内容重新加载 */
export const refreshKeyAtom = atom(0);

/** 右侧消息侧边栏是否打开 */
export const messageSidebarOpenAtom = atom<boolean>(true);
