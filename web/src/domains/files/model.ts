/** ooc-3 adaptation: pools scope is kept for compatibility but maps to world root. */
export type TreeScope = "world" | "flows" | "stones" | "pools";

export type FileTreeNode = {
  name: string;
  /** ooc-3 uses "file"|"dir"; ooc-2 used "file"|"directory". Both are normalized here. */
  type: "directory" | "file" | "dir";
  path: string;
  size?: number;
  marker?: "flow" | "stone" | "pool";
  children?: FileTreeNode[];
};

export type FileContent = {
  path: string;
  content: string;
  size: number;
};

export type AnyFileContent = {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
};
