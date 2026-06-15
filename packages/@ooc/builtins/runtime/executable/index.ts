/**
 * runtime —— executable 维度（object method）。
 *
 * runtime 是 agent 组合持有的 **tool-object 成员**，向 Agent 提供系统级接口。本维度落
 * `create_object`（建新对象骨架到 session worktree）。它从 root 迁来——root 不再承载对象世界机制。
 *
 * exec 直接调 `createObjectInSession`（persistable）；session/persistence 经 `ctx.thread`。
 *
 * 与 readable 维度（投影 + window method，在 ../readable/index.ts）物理分离。
 */
import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import { createObjectInSession } from "@ooc/core/persistable/index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { Data } from "../types.js";

const CREATE_OBJECT_TIP = `create_object 建一个全新对象的骨架（仅业务 session 可调）。
参数：objectId（必填，新对象 id）、selfMd（必填）、readableMd（必填）、knowledge（可选 {filename: content}）。
骨架落 session worktree，本 session 内即可用；session 永不合入 main——进 canonical 走独立 feat-branch PR。`;

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
 * Deferred hook（onFormChange）—— 旧契约的「填表就绪检查 + quick-exec」逻辑保留为本目录局部 helper。
 * 新契约（ObjectMethod）尚无 onFormChange 字段；Wave3 反推 core 时 re-home。
 * 参数缺失检查行为与旧 onFormChange 一致：objectId/selfMd/readableMd 三者就绪则可 quick-exec。
 */
export function createObjectFormReadiness(args: Record<string, unknown>): {
  ready: boolean;
  tip: string;
  missing: string[];
} {
  const missing: string[] = [];
  if (!asString(args.objectId)) missing.push("objectId");
  if (!asString(args.selfMd)) missing.push("selfMd");
  if (!asString(args.readableMd)) missing.push("readableMd");
  const ready = missing.length === 0;
  return {
    ready,
    missing,
    tip: ready ? "Creating object..." : CREATE_OBJECT_TIP + `\n\n还缺: ${missing.join(", ")}`,
  };
}

/**
 * create_object 的 exec：建对象骨架落 session worktree。session/persistence 经 ctx.thread。
 * 导出供测试直接驱动（runtime 是其唯一注册家）。
 */
export async function executeCreateObject(
  ctx: ExecutableContext,
  _self: Data,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[create_object] 缺少 thread context。";
  if (!thread.persistence) return "[create_object] thread 无 persistence。";
  const { baseDir, sessionId, objectId: authorObjectId } = thread.persistence;
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
    baseDir, sessionId, authorObjectId, newObjectId, selfMd, readableMd,
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
