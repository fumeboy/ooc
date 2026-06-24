/**
 * runtime —— executable 维度（object method）。
 *
 * runtime 是 agent 组合持有的 **tool-object 成员**，向 Agent 提供系统级接口。本维度落
 * `create_object`（建新对象骨架到 session worktree）。它从 root 迁来——root 不再承载对象世界机制。
 *
 * exec 直接调 `createObjectInSession`（persistable）；session/persistence 经 `ctx.persistence`。
 *
 * 与 readable 维度（投影 + window method，在 ../readable/index.ts）物理分离。
 */
import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/types";
import { createObjectInSession } from "@ooc/core/persistable/index.js";
import { isSuperSessionId } from "@ooc/core/types/constants.js";
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

/**
 * create_object 的 exec：建对象骨架落 session worktree。session/persistence 经 ctx.persistence。
 * 导出供测试直接驱动（runtime 是其唯一注册家）。
 */
export async function executeCreateObject(
  ctx: ExecutableContext,
  _self: Data,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const sessionId = ctx.sessionId;
  const baseDir = ctx.worldDir;
  if (isSuperSessionId(sessionId) || !sessionId || !sessionId.trim()) {
    return `[create_object] 仅业务 session 可建对象（当前 session='${sessionId ?? ""}'）。`;
  }
  const newObjectId = asString(args.objectId);
  if (!newObjectId) return "[create_object] 缺少 objectId 参数。";
  const selfMd = asString(args.selfMd);
  if (selfMd === undefined) return "[create_object] 缺少 selfMd 参数。";
  const readableMd = asString(args.readableMd);
  if (readableMd === undefined) return "[create_object] 缺少 readableMd 参数。";
  const knowledgeRaw = args.knowledge;
  const knowledge = asKnowledge(knowledgeRaw);
  if (knowledgeRaw != null && knowledge === undefined) {
    return "[create_object] knowledge 必须是 { filename → string content } 形态。";
  }
  const r = await createObjectInSession({
    baseDir, sessionId, newObjectId, selfMd, readableMd,
    ...(knowledge ? { knowledge } : {}),
  });
  if (!r.ok) return `[create_object:${r.code}] ${r.message}`;
  return JSON.stringify({
    ok: true,
    objectId: r.objectId,
    note: "已落 session worktree，本 session 内即可用。session 永不合入 main——进 canonical 走独立 feat-branch PR。",
  });
}

const createObjectMethod: ObjectMethod<Data> = {
  name: "create_object",
  description:
    "Scaffold a brand-new OOC Object (package.json + self.md + readable.md) in the session worktree.",
  schema: {
    args: {
      objectId: { type: "string", required: true, description: "新对象 id" },
      selfMd: { type: "string", required: true, description: "新对象 self.md 全文" },
      readableMd: { type: "string", required: true, description: "新对象 readable.md 全文" },
      knowledge: { type: "object", required: false, description: "可选 seed knowledge" },
    },
  },
  exec: executeCreateObject,
};

const executable: ExecutableModule<Data> = {
  methods: [createObjectMethod],
};

export default executable;
