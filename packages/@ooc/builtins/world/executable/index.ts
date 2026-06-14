/**
 * world —— executable 维度。
 *
 * world 是 agent 组合持有的 **tool-object 成员**，承载系统机制级操作。本 increment 落 `create_object`
 * （建新对象骨架到 session worktree）。它从 root 迁来——root 不再承载对象世界机制。
 *
 * 独立声明方法壳（不 import root 方法文件）断 root barrel 的 import 循环；exec 直接调
 * `createObjectInSession`（persistable，无循环），逻辑与原 root.create_object 一致。
 */
import type { MethodExecutionContext, ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { createObjectInSession } from "@ooc/core/persistable/index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import { readable } from "../readable.js";

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

const createObjectMethod: ObjectMethod = {
  description: "Scaffold a brand-new OOC Object (package.json + self.md + readable.md) in the session worktree.",
  intents: ["create_object"],
  schema: {
    args: {
      objectId: { type: "string", required: true, description: "新对象 id" },
      selfMd: { type: "string", required: true, description: "新对象 self.md 全文" },
      readableMd: { type: "string", required: true, description: "新对象 readable.md 全文" },
      knowledge: { type: "object", required: false, description: "可选 seed knowledge" },
    },
  },
  onFormChange(_change, { args }) {
    const missing: string[] = [];
    if (!asString(args.objectId)) missing.push("objectId");
    if (!asString(args.selfMd)) missing.push("selfMd");
    if (!asString(args.readableMd)) missing.push("readableMd");
    const ready = missing.length === 0;
    return {
      tip: ready ? "Creating object..." : CREATE_OBJECT_TIP + `\n\n还缺: ${missing.join(", ")}`,
      intents: [{ name: "create_object" }],
      quick_exec_submit: ready,
    };
  },
  exec: executeCreateObject,
};

// create_object 的 exec：建对象骨架落 session worktree。导出供测试直接驱动（world 是其唯一注册家）。
export async function executeCreateObject(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[create_object] 缺少 thread context。";
  if (!thread.persistence) return "[create_object] thread 无 persistence。";
  const { baseDir, sessionId, objectId: authorObjectId } = thread.persistence;
  if (isSuperSessionId(sessionId) || !sessionId || !sessionId.trim()) {
    return `[create_object] 仅业务 session 可建对象（当前 session='${sessionId ?? ""}'）。`;
  }
  const newObjectId = asString(ctx.args.objectId);
  if (!newObjectId) return "[create_object] 缺少 objectId 参数。";
  const selfMd = asString(ctx.args.selfMd);
  if (selfMd === undefined) return "[create_object] 缺少 selfMd 参数。";
  const readableMd = asString(ctx.args.readableMd);
  if (readableMd === undefined) return "[create_object] 缺少 readableMd 参数。";
  const knowledgeRaw = ctx.args.knowledge;
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

// world 类的单处声明：executable（methods）+ readable + 可见性 flag。tool-object 成员，parentClass:null。
builtinRegistry.registerWindowClass({
  type: "world",
  parentClass: null,
  methods: { create_object: createObjectMethod },
  readable,
  renderableVisible: true,
  builtinReadable: true,
});
