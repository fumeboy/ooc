/**
 * Issue 摘要(与后端 `IssueIndexEntry` 同形 — 见 `src/persistable/issue.ts`)。
 *
 * sidebar 的 FLOW TREE 在展开 `flows/<sid>/issues` 节点时用这里的 API 数据
 * 替换 file tree 列表,使 `index.json` 等持久化细节不再泄漏 (issue-4 B4/B5 fix)。
 */
export type IssueSummary = {
  id: number;
  title: string;
  status: "open" | "closed";
  commentCount: number;
  createdByObjectId: string;
  createdAt: number;
  lastUpdatedAt: number;
};

/**
 * Issue 评论(与后端 `IssueComment` 同形 — 见 `src/persistable/issue.ts`)。
 */
export type IssueComment = {
  id: number;
  text: string;
  authorObjectId: string;
  authorKind: string;
  mentions: string[];
  createdAt: number;
};

/**
 * 完整 Issue(与后端 `Issue` 同形)。`useIssue` 取回的对象形状。
 */
export type Issue = {
  id: number;
  title: string;
  description: string;
  status: "open" | "closed";
  createdByObjectId: string;
  createdAt: number;
  lastUpdatedAt: number;
  comments: IssueComment[];
};
