import type { FileContent, FileTreeNode, TreeScope } from "../domains/files";
import type { FlowSession } from "../domains/flows";
import type { Stone } from "../domains/stones";
import type { ThreadContext } from "../domains/chat";

export type SessionThread = { objectId: string; threadId: string };

export type AppState = {
  scope: TreeScope;
  flows: FlowSession[];
  stones: Stone[];
  tree?: FileTreeNode;
  activePath?: string;
  activeFile?: FileContent;
  activeStoneObjectId?: string;
  activeKnowledgePath?: string;
  fileDirty: boolean;
  savingFile: boolean;
  activeSessionId?: string;
  /** 当前正在 chat / 渲染 context 的 thread；switcher 改变它。 */
  activeObjectId?: string;
  activeThreadId?: string;
  thread?: ThreadContext;
  /** 当前 session 下所有 (objectId, threadId)；thread switcher 数据源。 */
  sessionThreads: SessionThread[];
  error?: string;
  loading: boolean;
};

export const initialState: AppState = {
  scope: "world",
  flows: [],
  stones: [],
  fileDirty: false,
  savingFile: false,
  sessionThreads: [],
  loading: true,
};
