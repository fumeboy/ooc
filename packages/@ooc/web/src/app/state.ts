import type { FileContent, FileTreeNode, TreeScope } from "../domains/files";
import type { FlowSession } from "../domains/flows";
import type { Stone } from "../domains/stones";
import type { ThreadContext } from "../domains/chat";

export type SessionThread = { objectId: string; threadId: string };

export type AppState = {
  scope: TreeScope;
  flows: FlowSession[];
  /** 服务端给 flows 列表算的内容 hash；polling / refresh 用它判断要不要更新 state。 */
  flowsHash?: string;
  stones: Stone[];
  tree?: FileTreeNode;
  activePath?: string;
  activeFile?: FileContent;
  activeStoneObjectId?: string;
  activeKnowledgePath?: string;
  /**
   * A1：当前文件是白名单 stone 源文件（self.md / readable.md / executable/index.ts /
   * visible/index.tsx）时，存其 stone 相对路径；save 走版本化 putStoneFile。与
   * activeKnowledgePath（走 pool 入口）互斥。
   */
  activeStoneFileRelPath?: string;
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
