export type TreeScope = "world" | "flows" | "stones";

export type FileTreeNode = {
  name: string;
  type: "directory" | "file";
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

/** /api/file/read 的返回:可能被 maxBytes 截断,truncated 标记。 */
export type AnyFileContent = {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
};

