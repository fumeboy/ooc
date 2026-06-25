/**
 * runtime —— executable 维度（object method）。
 *
 * runtime 是 agent 组合持有的 **tool-object 成员**，向 Agent 提供系统级接口。
 *
 * `create_object` 经 reflectable 通道把新对象骨架写到 stones/main——是 agent 自我迭代
 * （元编程：runtime 为新对象写 self.md / readable.md / knowledge/）的入口。
 */
import type { ExecutableContext, ExecutableModule, ObjectMethod } from "@ooc/core/types/index.js";
import { isSuperSessionId } from "@ooc/core/types/constants.js";
import { createObjectSkeleton } from "@ooc/core/persistable/reflectable.js";
import type { Data } from "../types.js";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asKnowledge(v: unknown): Record<string, string> | undefined {
  if (v == null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "string") return undefined;
    out[k] = val;
  }
  return out;
}

const createObjectMethod: ObjectMethod<Data> = {
  name: "create_object",
  description:
    "Scaffold a brand-new OOC Object (package.json + self.md + readable.md + knowledge/*.md) under stones/main.",
  schema: {
    objectId: { type: "string", required: true, description: "新对象 id (如 my_agent)" },
    selfMd: { type: "string", required: true, description: "新对象 self.md 全文" },
    readableMd: { type: "string", required: false, description: "新对象 readable.md（缺省 = self.md 副本）" },
    knowledge: { type: "object", required: false, description: "可选 seed knowledge: { filename → body }" },
    parentClass: { type: "string", required: false, description: "继承父 class id（如 _builtin/agent）" },
  },
  exec: async (ctx: ExecutableContext, _self, args: Record<string, unknown>) => {
    const sessionId = ctx.sessionId;
    const baseDir = ctx.worldDir;
    if (!baseDir) return { err: "[create_object] worldDir 缺失" };
    if (isSuperSessionId(sessionId) || !sessionId) {
      return { err: `[create_object] 仅业务 session 可建对象（当前 session='${sessionId ?? ""}'）` };
    }
    const objectId = asString(args.objectId);
    if (!objectId) return { err: "[create_object] 缺少 objectId" };
    const selfMd = asString(args.selfMd);
    if (selfMd === undefined) return { err: "[create_object] 缺少 selfMd" };
    const readableMd = asString(args.readableMd);
    const knowledge = asKnowledge(args.knowledge);
    const parentClass = asString(args.parentClass);

    const result = await createObjectSkeleton({
      baseDir,
      objectId,
      selfMd,
      readableMd: readableMd ?? selfMd,
      knowledge,
      parentClass,
    });
    return {
      message: `[create_object] ${result.objectId} written to ${result.dir}`,
    };
  },
};

const executable: ExecutableModule<Data> = {
  methods: [createObjectMethod],
};

export default executable;
