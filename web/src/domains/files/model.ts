export type TreeScope = "world" | "flows" | "stones";

export type FileTreeNode = {
  name: string;
  type: "directory" | "file";
  path: string;
  size?: number;
  marker?: "flow" | "stone";
  children?: FileTreeNode[];
};

export type FileContent = {
  path: string;
  content: string;
  size: number;
};

