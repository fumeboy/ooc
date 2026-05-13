import { t } from "elysia";

export const treeQuery = t.Object({
  scope: t.Union([t.Literal("world"), t.Literal("flows"), t.Literal("stones")]),
  path: t.Optional(t.String()),
});

export const fileQuery = t.Object({
  path: t.String(),
});

export type TreeScope = "world" | "flows" | "stones";

export type UiTreeNode = {
  name: string;
  type: "directory" | "file";
  path: string;
  size?: number;
  marker?: "flow" | "stone";
  children?: UiTreeNode[];
};

