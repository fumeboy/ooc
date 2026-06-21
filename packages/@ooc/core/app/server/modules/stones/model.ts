import { t } from "elysia";

export const objectIdParams = t.Object({ objectId: t.String() });
export const createStoneBody = t.Object({
  objectId: t.Optional(t.String()),
  name: t.Optional(t.String()),
  self: t.Optional(t.String()),
  readable: t.Optional(t.String()),
  // ooc.class —— object 的继承父类（写入 package.json ooc.class）。仅 _builtin/agent 实例有 self.md。
  class: t.Optional(t.String()),
});
export const textBody = t.Object({ text: t.String() });
export const codeBody = t.Object({ code: t.String() });
export const knowledgeDirectoryBody = t.Object({ path: t.String() });
export const knowledgeFileBody = t.Object({
  path: t.String(),
  content: t.Optional(t.String()),
});
export const putFileBody = t.Object({ path: t.String(), content: t.String() });
