/**
 * runtime —— executable 维度（object method）。
 *
 * runtime 是 agent 组合持有的 **tool-object 成员**，向 Agent 提供系统级接口。
 *
 * **当前 create_object 已 stub**：依赖的 `createObjectInSession` / stone-feat-branch 通道在
 * 极简化重构期被退役；待 reflectable / feat-branch PR 通道重建后再恢复。
 */
import type { ExecutableModule, ObjectMethod } from "@ooc/core/types";
import type { Data } from "../types.js";

const createObjectMethod: ObjectMethod<Data> = {
  name: "create_object",
  description:
    "Scaffold a brand-new OOC Object in the session worktree (currently stubbed; pending reflectable channel rebuild).",
  schema: {
    objectId: { type: "string", required: true, description: "新对象 id" },
    selfMd: { type: "string", required: true, description: "新对象 self.md 全文" },
    readableMd: { type: "string", required: true, description: "新对象 readable.md 全文" },
    knowledge: { type: "object", required: false, description: "可选 seed knowledge" },
  },
  exec: async () => {
    return "[create_object] 尚未实现：reflectable feat-branch 通道重建中。";
  },
};

const executable: ExecutableModule<Data> = {
  methods: [createObjectMethod],
};

export default executable;
