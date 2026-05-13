import type { FileTreeNode, TreeScope } from "../domains/files";

export function scopeForNode(node: FileTreeNode): TreeScope | undefined {
  if (node.path === "flows") return "flows";
  if (node.path === "stones") return "stones";
  return undefined;
}

