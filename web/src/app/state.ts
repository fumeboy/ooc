import type { FileContent, FileTreeNode, TreeScope } from "../domains/files";
import type { FlowSession } from "../domains/flows";
import type { Stone } from "../domains/stones";
import type { ThreadContext } from "../domains/chat";

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
  activeObjectId?: string;
  thread?: ThreadContext;
  error?: string;
  loading: boolean;
};

export const initialState: AppState = {
  scope: "world",
  flows: [],
  stones: [],
  fileDirty: false,
  savingFile: false,
  loading: true,
};
