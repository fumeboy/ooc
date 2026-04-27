// kernel/src/collaborable/kanban/types.ts
// Session Kanban 数据类型定义

export type IssueStatus =
  | "discussing" | "designing" | "reviewing"
  | "executing" | "confirming" | "done" | "closed";

export type TaskStatus = "running" | "done" | "closed";

export type SubTaskStatus = "pending" | "running" | "done";

export interface Comment {
  id: string;
  author: string;
  content: string;
  mentions?: string[];
  createdAt: string;
}

export interface Issue {
  id: string;
  title: string;
  status: IssueStatus;
  description?: string;
  participants: string[];
  taskRefs: string[];
  reportPages: string[];
  hasNewInfo: boolean;
  comments: Comment[];
  createdAt: string;
  updatedAt: string;
}

export interface SubTask {
  id: string;
  title: string;
  assignee?: string;
  status: SubTaskStatus;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  description?: string;
  issueRefs: string[];
  reportPages: string[];
  subtasks: SubTask[];
  hasNewInfo: boolean;
  createdAt: string;
  updatedAt: string;
}
